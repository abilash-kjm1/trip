/* ===========================================================================
   POST /api/notify

   Phone notifications straight away. The app calls this the moment somebody
   saves a payment, an answer or an expense, instead of waiting up to five
   minutes for the scheduler.

   What stops it being a way to bother people:
   * Only a signed-in, approved account can call it - the Firebase ID token is
     checked here, not trusted.
   * It sends nothing it is told to send. It reads the caller's OWN notes from
     the outbox and hands them to the same checks the scheduler uses: every
     payment and expense is looked up in the database, and only people in
     that group are ever told.
   * Each note is claimed before it is sent, so this and the scheduler never
     both send one.
   * One account can cause at most MAX_PER_WINDOW notifications in ten minutes.
   * Never email - mail stays with the scheduler, gathered up.
   =========================================================================== */
import { getAuth } from "firebase-admin/auth";
import { readPath, removePath, database, claimNote } from "../lib/firebase.js";
import { notesFor, runPush } from "../lib/activity.js";
import { isApproved } from "../lib/access.js";
import { pushSender } from "../lib/sender.js";

const APP_URL = process.env.APP_URL || "https://abilash-kjm1.github.io/trip/";
// Only the app's own site may call this from a browser.
const ORIGINS = String(process.env.APP_ORIGINS || "https://abilash-kjm1.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 120;

export default async function handler(req, res) {
  const origin = String(req.headers.origin || "");
  if (ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ""));
  if (!m) return res.status(401).json({ ok: false, error: "Sign in first" });

  let who;
  try {
    database();                                   // brings up the admin app the token is checked with
    who = await getAuth().verifyIdToken(m[1]);
  } catch (err) {
    return res.status(401).json({ ok: false, error: "Sign in again" });
  }
  const uid = who.uid;
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const isAdmin = !!adminEmail && who.email_verified === true &&
                  String(who.email || "").toLowerCase() === adminEmail;

  try {
    if (!isAdmin && !isApproved(await readPath("access/" + uid))) {
      return res.status(403).json({ ok: false, error: "Not let in yet" });
    }

    const push = pushSender();
    if (!push) return res.status(200).json({ ok: true, pushed: 0, note: "phone notifications are not configured" });

    const now = Date.now();
    const rate = await readPath("pushRate/" + uid);
    let start = Number(rate.start) || 0, count = Number(rate.n) || 0;
    if (now - start > WINDOW_MS) { start = now; count = 0; }
    if (count >= MAX_PER_WINDOW) {
      return res.status(429).json({ ok: false, error: "Too many notifications at once - the next pass will catch up" });
    }

    const entries = notesFor(await readPath("mail/queue"), uid, now);
    if (!entries.length) return res.status(200).json({ ok: true, pushed: 0 });

    const users = await readPath("users");
    const log = { pushed: 0, pushGone: 0, pushFailed: 0, errors: [], pushSkipped: [] };
    await runPush({
      entries, users, dry: false, push, log, appUrl: APP_URL,
      db: { read: readPath, remove: removePath, claim: (e) => claimNote(e.key) }
    });

    if (log.pushed) await database().ref("pushRate/" + uid).set({ start, n: count + log.pushed });
    console.log("[notify] " + uid + " " + JSON.stringify({ pushed: log.pushed, skipped: log.pushSkipped,
                                                            failed: log.pushFailed }));
    return res.status(200).json({ ok: true, pushed: log.pushed, skipped: log.pushSkipped });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error("[notify] failed for", uid, msg);
    return res.status(500).json({ ok: false, error: "Could not send just now - the next pass will" });
  }
}
