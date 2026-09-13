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

  const log = { provider: provider() || "none",
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

    // ---- activity notices ------------------------------------------------
    // Drained on every pass, whatever the weekly schedule says: these are
    // individually opted into, default to off, and are about something that
    // has just happened rather than something on a timetable. A failure here
    // must not cost anybody their weekly round-up, hence its own try.
    try {
      log.activity = await runActivity({
        users, at, dry, appUrl: APP_URL,
        db: { read: readPath, remove: removePath },
        send: sendEmail
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
        if (dry) detail.push({ uid, email, tz, groupsListed: gids.length, groups: why });

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
