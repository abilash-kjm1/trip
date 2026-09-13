/* ===========================================================================
   GET /api/weekly-expense-reminder

   One cron for the whole application. It runs, works out who is due a
   reminder right now in their own timezone, and sends them one.

   Protected by CRON_SECRET: Vercel Cron sends it as a bearer token, and
   without it the endpoint answers 401. Nobody can use this to fan out mail.
   =========================================================================== */
import { readPath, database } from "../lib/firebase.js";
import { sendEmail } from "../lib/email.js";
import { reminderEmail } from "../lib/template.js";
import { groupSummary, cents } from "../lib/ledger.js";

const DEFAULT_TZ = "America/Toronto";
const WEEK_GUARD_MS = 6 * 24 * 3600 * 1000;

/* A window rather than one exact hour, because the cron is scheduled in UTC
   and the clocks move. `0 21 * * 0` is 17:00 in Toronto on EDT but 16:00 once
   EST starts, so an exact-hour test would go quiet from November to March.
   The window covers both, and the once-a-week stamp means a wider window
   cannot turn into more than one email. */
const WINDOW_FROM = Number(process.env.SEND_HOUR_FROM || 16);
const WINDOW_TO   = Number(process.env.SEND_HOUR_TO   || 20);

/** Weekday and hour as they read on a wall clock in `tz`. */
function localNow(tz, at) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "numeric", hour12: false
    }).formatToParts(at);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return { weekday: get("weekday"), hour: parseInt(get("hour"), 10) };
  } catch {
    return null;                    // unknown timezone
  }
}

const isValidTz = (tz) => !!localNow(tz, new Date());

/** Does this account want the Sunday reminder, right now? */
function isDue(prefs, at, force) {
  const tz = (prefs && typeof prefs.tz === "string" && isValidTz(prefs.tz)) ? prefs.tz : DEFAULT_TZ;
  if (force) return { due: true, tz };

  const now = localNow(tz, at);
  if (!now) return { due: false, tz };
  if (now.weekday !== "Sun") return { due: false, tz };
  if (now.hour < WINDOW_FROM || now.hour > WINDOW_TO) return { due: false, tz };

  // Guard against a double send if the schedule is ever run more than once.
  const last = Number(prefs && prefs.lastWeekly) || 0;
  if (last && at.getTime() - last < WEEK_GUARD_MS) return { due: false, tz };

  return { due: true, tz };
}

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

  const log = { considered: 0, due: 0, skippedNothingOwing: 0, sent: 0, failed: 0, errors: [] };

  try {
    const [users, trips] = await Promise.all([readPath("users"), readPath("trips")]);

    for (const uid of Object.keys(users)) {
      log.considered++;
      const u = users[uid] || {};
      const profile = u.profile || {};
      const prefs = u.prefs || {};

      try {
        // ---- wants it, and can receive it ---------------------------------
        if (prefs.weekly === false) continue;
        const email = String(profile.email || "").trim().toLowerCase();
        if (!looksLikeEmail(email)) continue;

        const { due, tz } = isDue(prefs, at, force);
        if (!due) continue;
        log.due++;

        // ---- what do they actually owe ------------------------------------
        const gids = Object.keys(u.groups || {});
        const groups = [];
        let owe = 0, owed = 0;

        for (const gid of gids) {
          const g = trips[gid];
          if (!g || typeof g !== "object") continue;          // deleted group
          const name = (g.meta && g.meta.name) || gid;
          const s = groupSummary(g, name, uid);
          if (!s) continue;                                   // never claimed a name here
          if (Math.abs(s.net) < 0.005 && !s.owes.length && !s.lent.length) continue;
          groups.push(s);
          if (s.net < -0.004) owe += -s.net;
          else if (s.net > 0.004) owed += s.net;
        }

        owe = cents(owe); owed = cents(owed);

        // Nothing outstanding anywhere: say nothing.
        if (!groups.length || (Math.abs(owe) < 0.005 && Math.abs(owed) < 0.005)) {
          log.skippedNothingOwing++;
          continue;
        }

        const { subject, html, text } = reminderEmail({
          name: String(profile.name || email.split("@")[0]),
          owe, owed, groups,
          appUrl: process.env.APP_URL || "https://abilash-kjm1.github.io/trip/"
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
        log.errors.push({ uid, error: msg.slice(0, 200) });
        console.error("[reminder] failed for", uid, msg);
      }
    }

    const ms = Date.now() - started;
    console.log("[reminder] done in " + ms + "ms", JSON.stringify(log));
    return res.status(200).json({ ok: true, ms, ...log });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error("[reminder] aborted:", msg);
    return res.status(500).json({ ok: false, error: msg, ...log });
  }
}
