/* ---------------------------------------------------------------------------
   The Web Push sender, shared by the scheduler and /api/notify.

   Notifications are signed with a key pair made once for this app. The public
   half is in the app; the private half lives only in this server's
   environment. Without both, nothing is pushed and everything else carries on.
   --------------------------------------------------------------------------- */
import webpush from "web-push";

const subject = () => process.env.VAPID_SUBJECT ||
  ("mailto:" + (process.env.ADMIN_EMAIL || "abilashkjm01@gmail.com"));

/** A function that sends one notification, or null if the keys are missing or unusable. */
export function pushSender() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  try {
    webpush.setVapidDetails(subject(), pub, priv);
  } catch (err) {
    console.error("[push] the VAPID keys are not usable:", (err && err.message) || err);
    return null;
  }
  return (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
}

/** For the dry run: whether the keys actually work, never what they are. The
    start of the public key is not secret - it is in the app - and lets the
    two be compared. */
export function vapidReport() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    return "NOT SET - missing " + [!pub && "VAPID_PUBLIC_KEY", !priv && "VAPID_PRIVATE_KEY"].filter(Boolean).join(" and ");
  }
  try {
    webpush.setVapidDetails(subject(), pub, priv);
  } catch (err) {
    return "set but NOT USABLE - " + ((err && err.message) || err);
  }
  return "ready - public key starts " + pub.slice(0, 10);
}
