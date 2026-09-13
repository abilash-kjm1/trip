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
