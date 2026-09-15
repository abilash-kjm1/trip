/* ---------------------------------------------------------------------------
   Phone notifications (Web Push).

   A phone that has said yes leaves its subscription at
   users/{uid}/push/{id}: an endpoint belonging to Google, Apple, Mozilla or
   Microsoft, and two public keys. This file checks those records before
   believing them, words the notifications, and hands them to the sender.

   The browser never sends a notification to anybody. It can only record that
   something happened - a payment, an answer - and this server decides who,
   if anyone, hears about it, from what is actually in the database. The key
   that signs every notification (VAPID_PRIVATE_KEY) never leaves the server.
   --------------------------------------------------------------------------- */
import { money } from "./ledger.js";

export const MAX_PUSHES = 200;            // per run, a ceiling on fan-out
export const MAX_DEVICES = 10;            // per account
const TTL_SECONDS = 24 * 3600;            // a day old and it is not news

// Only the push services browsers actually use. A subscription pointing
// anywhere else is not a phone - and posting to it would let a tampered
// record make this server call an address of somebody's choosing.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                // Chrome, Edge and most Android browsers
  /^(web\.)?push\.apple\.com$/,            // Safari, including iPhone home-screen apps
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,   // Firefox
  /(^|\.)notify\.windows\.com$/            // older Edge
];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const clip = (s, n) => {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** A subscription as a browser saved it, or null if it cannot be used. */
export function cleanSubscription(raw) {
  if (!raw || typeof raw !== "object") return null;
  const endpoint = typeof raw.endpoint === "string" ? raw.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 1000) return null;
  let u;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!PUSH_HOSTS.some((h) => h.test(u.hostname))) return null;

  const k = (raw.keys && typeof raw.keys === "object") ? raw.keys : {};
  const p256dh = typeof k.p256dh === "string" ? k.p256dh : "";
  const auth = typeof k.auth === "string" ? k.auth : "";
  // 65 bytes and 16 bytes, written as base64url, with or without padding.
  if (!B64URL.test(p256dh) || p256dh.length < 86 || p256dh.length > 90) return null;
  if (!B64URL.test(auth) || auth.length < 21 || auth.length > 26) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Every usable device on an account. */
export function subscriptionsOf(user) {
  const raw = user && user.push;
  if (!raw || typeof raw !== "object") return [];
  return Object.keys(raw).filter((id) => ID.test(id)).slice(0, MAX_DEVICES)
    .map((id) => ({ id, sub: cleanSubscription(raw[id]) }))
    .filter((x) => x.sub);
}

/* ---- what the notifications say ----
   Short, because a lock screen cuts them off. The title carries the news;
   the body says what to do about it. */

/** To the person a payment went to: did it arrive? */
/* Every amount is written in the group's own currency (`cur`, CAD when absent). */

/** To the person a payment went to: did it arrive? */
export function askMessage({ from, amount, group, url, tag, cur }) {
  return {
    title: "Did " + money(amount, cur) + " arrive?",
    body: clip(from, 40) + " says they sent it to you · " + clip(group, 40) +
          ". Check your " + (cur === "INR" ? "UPI app" : "bank") + ", then tap to answer.",
    url, tag, sticky: true
  };
}

/** To whoever recorded the payment: the answer. */
export function answerMessage({ to, amount, ok, group, url, tag, cur }) {
  return ok
    ? { title: clip(to, 40) + " got your " + money(amount, cur),
        body: "Confirmed in " + clip(group, 40) + ".", url, tag }
    : { title: clip(to, 40) + " can’t see your " + money(amount, cur),
        body: "Check where it went in " + clip(group, 40) + ", then ask them to look again.",
        url, tag, sticky: true };
}

/** Somebody added, changed or deleted an expense the reader is in. */
export function expenseMessage({ kind, actor, desc, amount, group, share, paidByYou, url, tag, cur }) {
  const verb = kind === "expense.add" ? "added" : kind === "expense.edit" ? "changed" : "deleted";
  const where = clip(group, 40);
  let body;
  if (kind === "expense.del") body = "Removed from " + where + ". Your balance has been updated.";
  else if (paidByYou) body = "You paid · " + where;
  else if (share != null && share > 0.004) body = "Your share " + money(share, cur) + " · " + where;
  else body = where;
  return {
    title: clip(actor, 30) + " " + verb + " " + clip(desc || "an expense", 40) +
           (amount ? " · " + money(amount, cur) : ""),
    body, url, tag
  };
}

/** A reminder to pay somebody back. */
export function nudgeMessage({ from, amount, group, url, tag, cur }) {
  return {
    title: clip(from, 40) + " sent you a reminder",
    body: (amount ? "You owe " + money(amount, cur) + " in " : "About ") + clip(group, 40) + ". Tap to settle up.",
    url, tag
  };
}

/**
 * Send one message to every device on one account.
 *
 * `push(subscription, payload, options)` is injected (web-push in
 * production) so this can be tested without a push service. A device the
 * service says is gone (404 or 410) has its subscription removed, so a phone
 * that uninstalled the app stops being tried.
 */
export async function deliver({ uid, users, message, dry, push, db, log }) {
  const subs = subscriptionsOf(users && users[uid]);
  let n = 0;
  for (const { id, sub } of subs) {
    if (log.pushed + log.pushFailed >= MAX_PUSHES) break;
    if (dry) { log.pushed++; n++; continue; }
    if (!push) return n;
    try {
      await push(sub, JSON.stringify(message), { TTL: TTL_SECONDS, urgency: "high" });
      log.pushed++; n++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        log.pushGone++;
        if (db && db.remove) await db.remove("users/" + uid + "/push/" + id);
      } else {
        log.pushFailed++;
        log.errors.push({ uid, error: ("push: " + ((err && (err.body || err.message)) || String(err))).slice(0, 300) });
      }
    }
  }
  return n;
}
