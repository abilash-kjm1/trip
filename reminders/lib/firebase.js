/* ---------------------------------------------------------------------------
   Read-mostly access to the app's existing Realtime Database.

   The Admin SDK authenticates with a service account and bypasses the security
   rules, which is exactly what a cron needs and exactly why the key must never
   leave the server. It lives in FIREBASE_SERVICE_ACCOUNT as JSON.
   --------------------------------------------------------------------------- */
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

let cached = null;

export function database() {
  if (cached) return cached;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  if (!url) throw new Error("FIREBASE_DATABASE_URL is not set");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON: " + e.message);
  }
  // Pasting a key into a dashboard turns the newlines into a literal \n.
  if (typeof creds.private_key === "string") {
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }
  if (!creds.project_id || !creds.client_email || !creds.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key");
  }

  const app = getApps().length
    ? getApp()
    : initializeApp({ credential: cert(creds), databaseURL: url });

  cached = getDatabase(app);
  return cached;
}

/** One read of a path, returning a plain object. */
export async function readPath(path) {
  const snap = await database().ref(path).get();
  const v = snap.val();
  return (v && typeof v === "object") ? v : {};
}

/** Mark one outbox note as pushed, unless somebody already has. True only for
    the one caller that got it - so /api/notify and the scheduler, running at
    the same moment, never both send the same notification. */
export async function claimNote(key) {
  const token = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const r = await database().ref("mail/queue/" + key).transaction((cur) => {
    if (cur === null) return null;          // not cached yet, or already cleared
    if (cur.pushed) return;                 // somebody else has it: abort
    return { ...cur, pushed: token };
  });
  const v = r.snapshot && r.snapshot.val();
  return !!(r.committed && v && v.pushed === token);
}

/** Take the one reminder for a payment put off with "Not yet". Kept under
    mail/, which the app cannot read or write. True only when this chosen time
    has not been reminded about, and the last reminder for this payment was at
    least `gapMs` ago. */
export async function claimLater(gid, k, until, now, gapMs) {
  const r = await database().ref("mail/later/" + gid + "~" + k).transaction((cur) => {
    if (cur && Number(cur.until) === until) return;          // this time already reminded
    if (cur && now - Number(cur.at) < gapMs) return;         // too soon after the last one
    return { until, at: now };
  });
  const v = r.snapshot && r.snapshot.val();
  return !!(r.committed && v && Number(v.until) === until && Number(v.at) === now);
}

/** Delete one path. Used to clear notes the mailer has already acted on. */
export async function removePath(path) {
  await database().ref(path).remove();
}
