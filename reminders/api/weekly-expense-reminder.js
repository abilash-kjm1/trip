/* ===========================================================================
   GET /api/weekly-expense-reminder

   One cron for the whole application. It runs, works out who is due a
   reminder right now in their own timezone, and sends them one.

   Protected by CRON_SECRET: Vercel Cron sends it as a bearer token, and
   without it the endpoint answers 401. Nobody can use this to fan out mail.
   =========================================================================== */
import { readPath, removePath, database } from "../lib/firebase.js";
import { sendEmail, provider } from "../lib/email.js";
import { reminderEmail } from "../lib/template.js";
import { groupSummary, cents } from "../lib/ledger.js";
import { normalise, isDue, isValidTz, describe } from "../lib/schedule.js";
import { runActivity } from "../lib/activity.js";

const DEFAULT_TZ = process.env.DEFAULT_TZ || "America/Toronto";
const APP_URL = process.env.APP_URL || "https://abilash-kjm1.github.io/trip/";

const tzOf = (prefs) =>
  (prefs && typeof prefs.tz === "string" && isValidTz(prefs.tz)) ? prefs.tz : DEFAULT_TZ;

const looksLikeEmail = (s) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length < 320;

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ---- authorisation -----------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[reminder] CRON_SECRET is not set; refusing to run");
    return res.status(500).json({ ok: false, error: "Server not configured" });
  }
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer " + secret) {
    console.warn("[reminder] rejected an unauthorised request");
    return res.status(401).json({ ok: false, error: "Unauthorised" });
  }

  // force=1 ignores the day/hour gate. Still behind CRON_SECRET, so it is a
  // maintenance switch, not a way in.
  const force = String((req.query && req.query.force) || "") === "1";
  const dry = String((req.query && req.query.dry) || "") === "1";
  const at = new Date();

  // What this running build can actually see. A variable added in the Vercel
  // dashboard does not reach a deployment that is already running, so "I added
  // it" and "it is there" are different claims - and the difference is silent.
  // Presence only: never the values.
  const config = dry ? {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || "NOT SET - nobody can be let in",
    CRON_SECRET: process.env.CRON_SECRET ? "set" : "NOT SET",
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT ? "set" : "NOT SET",
    BREVO_API_KEY: process.env.BREVO_API_KEY ? "set" : "not set",
    RESEND_API_KEY: process.env.RESEND_API_KEY ? "set" : "not set",
    REMINDER_FROM: process.env.REMINDER_FROM || "NOT SET - the sender falls back",
    APP_URL: process.env.APP_URL || "not set - using the default"
  } : undefined;

  const log = { provider: provider() || "none",
                ...(dry ? { config } : {}),
                considered: 0, due: 0, skippedNothingOwing: 0, sent: 0, failed: 0, errors: [] };
  // A dry run explains itself. "Nothing owing" has several causes and the
  // summary alone cannot tell them apart, which makes setup guesswork.
  const detail = [];

  try {
    // Cheapest first. When this runs hourly, nearly every run should stop on
    // one of the next two checks without ever reading the expenses.
    const cfg = normalise(await readPath("config/reminders"));
    log.schedule = describe(cfg);

    const users = await readPath("users");

    // Who is allowed in. Only wanted for a dry run's report: turning the
    // approval gate on without checking this first is how somebody gets
    // locked out of an app that was working a minute ago.
    const access = await readPath("access");

    // A heartbeat, so "how often is this actually being called" stops being a
    // matter of inference. Nothing in here can see cron-job.org's settings;
    // it can see when it was last woken, and the gap between the last two
    // wakings is the interval, measured rather than believed.
    // Keep the directory in step with who is actually allowed in. It used to be
    // written only when somebody opened the app, so an approved person stayed
    // invisible - and unpickable when adding members - until they happened to
    // sign in again. Everything needed is already here, so fill it in for them.
    const directory = await readPath("directory");
    if (!dry) {
      const fixes = {};
      for (const uid of Object.keys(access)) {
        const status = (access[uid] || {}).status;
        const has = directory[uid] && directory[uid].name;
        if (status === "approved" && !has) {
          const profile = ((users[uid] || {}).profile) || {};
          const name = String(profile.name || access[uid].name || "").trim();
          if (!name) continue;
          fixes[uid] = {
            name,
            email: String(profile.email || access[uid].email || "").trim().toLowerCase(),
            photo: profile.photo || null,
            at: Number(access[uid].decidedAt) || Date.now()
          };
        }
        // Somebody turned away should not stay in a list people pick from.
        // Only an explicit refusal removes an entry: a missing record might
        // just be the administrator, who never needed one.
        if (status === "declined" && directory[uid]) fixes[uid] = null;
      }
      const uids = Object.keys(fixes).slice(0, 50);
      if (uids.length) {
        const patch = {};
        uids.forEach((u) => { patch[u] = fixes[u]; });
        await database().ref("directory").update(patch);
        console.log("[directory] brought " + uids.length + " entr(ies) up to date");
      }
    }

    // Keep groups, invited seats and everybody's pointers to groups in step.
    //
    // Membership: the rules read trips/{gid}/uids to decide who may open a
    // group, because a rule cannot scan a list of people for an account.
    //
    // Invited seats: somebody invited by email has a seat with their address
    // on it and no account. Under the membership rules they cannot read the
    // group to claim that seat themselves - they are not on the list - so an
    // email invitation could never complete. Once they have signed in and been
    // approved, their seat is linked here and the group put on their list.
    //
    // Stale pointers: leaving or deleting a group left entries behind in
    // people's lists and in the invites index, and the app put the group back
    // from them every time it loaded. Pointers to groups that no longer exist
    // are removed.
    //
    // A dry run reports what it would do and changes nothing.
    {
      const trips = await readPath("trips");
      const invites = await readPath("invites");
      const byEmail = {};
      Object.keys(users).forEach((uid) => {
        const e = String(((users[uid] || {}).profile || {}).email || "").trim().toLowerCase();
        if (e && (access[uid] || {}).status === "approved") byEmail[e] = uid;
      });
      const report = { linked: [], membership: 0, stale: [] };
      const writes = {};

      for (const gid of Object.keys(trips)) {
        const g = trips[gid] || {};
        const gname = (g.meta && g.meta.name) || gid;
        const people = g.people || {};
        const want = {};
        Object.keys(people).forEach((k) => {
          const uid = people[k] && people[k].uid;
          if (typeof uid === "string" && uid) want[uid] = true;
        });
        Object.keys(people).forEach((k) => {
          const p = people[k] || {};
          const mail = String(p.invite || "").trim().toLowerCase();
          const uid = mail && !p.uid ? byEmail[mail] : null;
          if (!uid || want[uid]) return;          // nobody to link, or already seated
          want[uid] = true;
          writes["trips/" + gid + "/people/" + k + "/uid"] = uid;
          writes["trips/" + gid + "/people/" + k + "/email"] = mail;
          writes["users/" + uid + "/groups/" + gid] = { name: gname, at: Date.now() };
          report.linked.push(gname + ": " + (p.n || mail) + " <- " + mail);
        });
        const have = g.uids || {};
        Object.keys(want).forEach((u) => { if (!have[u]) { writes["trips/" + gid + "/uids/" + u] = true; report.membership++; } });
        Object.keys(have).forEach((u) => { if (!want[u]) { writes["trips/" + gid + "/uids/" + u] = null; report.membership++; } });
      }

      Object.keys(users).forEach((uid) => {
        const who = (((users[uid] || {}).profile) || {}).email || uid;
        Object.keys(((users[uid] || {}).groups) || {}).forEach((gid) => {
          if (trips[gid]) return;
          writes["users/" + uid + "/groups/" + gid] = null;
          const nm = ((users[uid].groups[gid] || {}).name) || gid;
          report.stale.push(who + " still lists deleted group \"" + nm + "\"");
        });
      });
      Object.keys(invites).forEach((key) => {
        Object.keys(invites[key] || {}).forEach((gid) => {
          if (trips[gid]) return;
          writes["invites/" + key + "/" + gid] = null;
          const nm = ((invites[key][gid] || {}).name) || gid;
          report.stale.push("invite for " + key.replace(/,/g, ".") + " to deleted group \"" + nm + "\"");
        });
      });

      if (dry) {
        log.housekeeping = report;
      } else if (Object.keys(writes).length) {
        await database().ref().update(writes);
        console.log("[housekeeping] " + Object.keys(writes).length + " write(s) " + JSON.stringify(report));
      }
    }

    const beat = await readPath("config/heartbeat");
    if (!dry) {
      await database().ref("config/heartbeat")
        .set({ at: at.getTime(), prevAt: Number(beat.at) || 0 });
    } else {
      const last = Number(beat.at) || 0;
      const gapMins = last && beat.prevAt ? Math.round((last - Number(beat.prevAt)) / 60000) : null;
      // Publishing the membership rules before this index is filled in would
      // shut people out of their own ledger, so show it before it matters.
      const allTrips = await readPath("trips");
      log.members = Object.keys(allTrips).map((gid) => {
        const g = allTrips[gid] || {};
        const named = Object.keys(g.people || {})
          .filter((k) => g.people[k] && g.people[k].uid).length;
        return ((g.meta && g.meta.name) || gid) + ": " +
               Object.keys(g.uids || {}).length + " on the index, " +
               named + " with an account";
      });
      log.directory = Object.keys(directory).length + " listed: " +
        (Object.keys(directory).map((u) => (directory[u] || {}).name).filter(Boolean).join(", ")
         || "nobody yet");
      // Which rules are live. Everything else here reads with admin rights,
      // which pass straight through the rules, so nothing else can tell
      // whether a paste into the console actually took effect.
      try {
        const live = await database().getRules();
        log.rules = /child\('uids'\)/.test(live)
          ? "membership required - only people in a group can open it"
          : /root\.child\('access'\)/.test(live)
            ? "approval gate, but any approved account can open any group"
            : "no approval gate on groups";
      } catch (err) {
        log.rules = "could not read: " + ((err && err.message) || String(err)).slice(0, 200);
      }
      log.heartbeat = {
        lastRun: last ? new Date(last).toISOString() : "never",
        agoMins: last ? Math.round((at.getTime() - last) / 60000) : null,
        measuredIntervalMins: gapMins
      };
    }

    // ---- activity notices ------------------------------------------------
    // Drained on every pass, whatever the weekly schedule says: these are
    // individually opted into, default to off, and are about something that
    // has just happened rather than something on a timetable. A failure here
    // must not cost anybody their weekly round-up, hence its own try.
    try {
      log.activity = await runActivity({
        users, at, dry, appUrl: APP_URL,
        db: { read: readPath, remove: removePath,
              set: (path, v) => database().ref(path).set(v) },
        send: sendEmail,
        adminEmail: process.env.ADMIN_EMAIL || "",
        secret,
        // Where this deployment actually answers, so the approve link points
        // back here rather than at a hard-coded guess.
        apiBase: process.env.API_BASE_URL ||
                 ((req.headers["x-forwarded-proto"] || "https") + "://" +
                  (req.headers["x-forwarded-host"] || req.headers.host || ""))
      });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      log.activity = { error: msg.slice(0, 600) };
      console.error("[activity] aborted:", msg);
    }

    if (!cfg.enabled && !force) {
      console.log("[reminder] schedule is switched off");
      return res.status(200).json({ ok: true, ms: Date.now() - started, ...log });
    }

    // Is anybody due at all? Deciding this needs only preferences and a
    // timezone, never the ledger.
    const dueNow = Object.keys(users).filter((uid) => {
      const u = users[uid] || {};
      const prefs = u.prefs || {};
      if (prefs.weekly === false) return false;
      if (!looksLikeEmail(String((u.profile || {}).email || "").trim().toLowerCase())) return false;
      return force ? true : isDue(cfg, tzOf(prefs), prefs, at).due;
    });

    if (!dueNow.length) {
      log.considered = Object.keys(users).length;
      console.log("[reminder] nobody due; skipped reading the expenses");
      // "Nothing sent" is the same answer whether the scheduler is working
      // perfectly or is not being called at all. Saying when each account was
      // last written to tells the two apart without waiting for the window to
      // come round again.
      const detail = dry ? Object.keys(users).map((uid) => {
        const prefs = (users[uid] || {}).prefs || {};
        const last = Number(prefs.lastWeekly) || 0;
        return {
          uid,
          email: String(((users[uid] || {}).profile || {}).email || ""),
          access: (access[uid] && access[uid].status) || "no record - would be locked out",
          lastSent: last ? new Date(last).toISOString() : "never",
          why: isDue(cfg, tzOf(prefs), prefs, at).why
        };
      }) : undefined;
      return res.status(200).json({ ok: true, ms: Date.now() - started, ...log,
                                    ...(dry ? { detail } : {}) });
    }

    const trips = await readPath("trips");

    for (const uid of Object.keys(users)) {
      log.considered++;
      const u = users[uid] || {};
      const profile = u.profile || {};
      const prefs = u.prefs || {};

      try {
        // ---- wants it, and can receive it ---------------------------------
        if (prefs.weekly === false) {
          if (dry) detail.push({ uid, skipped: "weekly reminder switched off" });
          continue;
        }
        const email = String(profile.email || "").trim().toLowerCase();
        if (!looksLikeEmail(email)) {
          if (dry) detail.push({ uid, skipped: "no usable email on the profile" });
          continue;
        }

        const tz = tzOf(prefs);
        const verdict = force ? { due: true, why: "forced" } : isDue(cfg, tz, prefs, at);
        if (!verdict.due) {
          if (dry) detail.push({ uid, email, tz, skipped: verdict.why });
          continue;
        }
        log.due++;

        // ---- what do they actually owe ------------------------------------
        const gids = Object.keys(u.groups || {});
        const groups = [];
        let owe = 0, owed = 0;

        const why = [];
        for (const gid of gids) {
          const g = trips[gid];
          if (!g || typeof g !== "object") {
            why.push({ gid, skipped: "group no longer exists" });
            continue;
          }
          const name = (g.meta && g.meta.name) || gid;
          const s = groupSummary(g, name, uid);
          if (!s) {
            why.push({ gid, group: name, skipped: "this account has not claimed a name in it" });
            continue;
          }
          if (Math.abs(s.net) < 0.005 && !s.owes.length && !s.lent.length) {
            why.push({ gid, group: name, person: s.me, skipped: "settled, nothing outstanding" });
            continue;
          }
          why.push({ gid, group: name, person: s.me, net: s.net, owesLines: s.owes.length, lentLines: s.lent.length });
          groups.push(s);
          if (s.net < -0.004) owe += -s.net;
          else if (s.net > 0.004) owed += s.net;
        }
        if (dry) detail.push({ uid, email, tz,
                              access: (access[uid] && access[uid].status) || "no record - would be locked out",
                              groupsListed: gids.length, groups: why });

        owe = cents(owe); owed = cents(owed);

        // Nothing outstanding anywhere: say nothing.
        if (!groups.length || (Math.abs(owe) < 0.005 && Math.abs(owed) < 0.005)) {
          log.skippedNothingOwing++;
          continue;
        }

        const { subject, html, text } = reminderEmail({
          name: String(profile.name || email.split("@")[0]),
          owe, owed, groups, appUrl: APP_URL
        });

        if (dry) {
          log.sent++;
          console.log("[reminder] DRY would send to", email, "|", subject);
          continue;
        }

        const sentRes = await sendEmail({ to: email, subject, html, text });
        log.sent++;
        console.log("[reminder] sent to", email, "id", sentRes && sentRes.id, "tz", tz);

        // Stamp it so a re-run inside the week cannot send twice.
        await database().ref("users/" + uid + "/prefs/lastWeekly").set(at.getTime());
      } catch (err) {
        // One person's failure must not stop the rest.
        log.failed++;
        const msg = (err && err.message) || String(err);
        // Setup errors carry the instruction for fixing them, so do not clip
        // them mid-sentence.
        log.errors.push({ uid, error: msg.slice(0, 600) });
        console.error("[reminder] failed for", uid, msg);
      }
    }

    const ms = Date.now() - started;
    console.log("[reminder] done in " + ms + "ms", JSON.stringify(log));
    return res.status(200).json({ ok: true, ms, ...log, ...(dry ? { detail } : {}) });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error("[reminder] aborted:", msg);
    return res.status(500).json({ ok: false, error: msg, ...log });
  }
}
