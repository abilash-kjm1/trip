/* ---------------------------------------------------------------------------
   Activity notifications: "somebody added an expense to your group".

   The browser cannot send email - the mail key never leaves the server - so
   the app leaves a note at mail/queue instead and this drains it on the next
   pass. That keeps the rule the brief set: users may not trigger mail. They
   can only record that something happened in a group they belong to.

   The note deliberately does NOT say who to tell. Recipients are worked out
   here, from the group's own membership, so a tampered-with note can reach
   nobody its author could not already reach.
   --------------------------------------------------------------------------- */
import { money } from "./ledger.js";
import { activityEmail } from "./template.js";

/* What each kind of note is, and which switch on the Account screen governs
   it. The keys match the rows the app shows, so what somebody turns off is
   exactly what stops arriving. */
export const KINDS = {
  "expense.add":  { pref: "newExpense", verb: "added",    noun: "expense" },
  "expense.edit": { pref: "updates",    verb: "changed",  noun: "expense" },
  "expense.del":  { pref: "updates",    verb: "deleted",  noun: "expense" },
  "payment.add":  { pref: "payments",   verb: "recorded", noun: "payment" },
  "payment.edit": { pref: "payments",   verb: "changed",  noun: "payment" },
  "payment.del":  { pref: "payments",   verb: "deleted",  noun: "payment" }
};

const MAX_AGE_MS   = 48 * 3600 * 1000;   // older than this and it is not news
const MAX_AHEAD_MS =  2 * 3600 * 1000;   // a clock that is wrong, not a note
export const MAX_ENTRIES = 300;          // per run, so a flood cannot stall it
export const MAX_ITEMS   = 40;           // per email, so one cannot be endless
export const MAX_EMAILS  = 120;          // per run, a hard ceiling on fan-out

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

const looksLikeEmail = (s) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length < 320;

/** A queue entry as written by a browser, or null if it is not usable. */
export function normaliseEntry(key, raw, now) {
  if (!raw || typeof raw !== "object") return null;

  const kind = str(raw.kind, 40);
  if (!KINDS[kind]) return null;

  // A group id is a database key. Anything that could climb out of the path
  // is not one.
  const gid = str(raw.gid, 200);
  if (!gid || /[.#$/[\]]/.test(gid)) return null;

  const actorUid = str(raw.actorUid, 128);
  if (!actorUid) return null;

  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  if (now - at > MAX_AGE_MS) return null;
  if (at - now > MAX_AHEAD_MS) return null;

  // Number(null) and Number("") are both 0, which would put "$0.00" into
  // somebody's inbox for a note that simply carried no amount. Nothing the
  // app records is worth nothing, so absent and zero are the same thing here.
  let amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) amount = null;

  return {
    key, kind, gid, actorUid, at, amount,
    actor: str(raw.actor, 80) || "Someone",
    desc:  str(raw.desc, 120)
  };
}

/** Everyone in the group with an account, except whoever did the thing. */
export function recipientUids(group, actorUid) {
  const people = (group && group.people) || {};
  const out = [];
  Object.keys(people).forEach((k) => {
    const uid = people[k] && people[k].uid;
    if (typeof uid === "string" && uid && uid !== actorUid && out.indexOf(uid) < 0) {
      out.push(uid);
    }
  });
  return out;
}

/** Did this account ask for this sort of note? Off unless switched on. */
export function wants(prefs, kind) {
  const k = KINDS[kind];
  if (!k) return false;
  return (prefs || {})[k.pref] === true;
}

/** Is the author of a note actually in the group it is about? */
export function isMember(group, uid) {
  const people = (group && group.people) || {};
  return Object.keys(people).some((k) => people[k] && people[k].uid === uid);
}

/** One line of an email, in plain words. */
export function lineFor(e) {
  const k = KINDS[e.kind];
  const amt = e.amount != null ? " - " + money(e.amount) : "";

  if (k.noun === "payment") {
    const what = e.desc || "a payment";
    // "Kelvin recorded Kelvin paid Abilash" says the name twice. A new
    // payment already names who paid whom, so let it speak for itself; only
    // a change or a deletion needs to say who did it.
    return (e.kind === "payment.add" ? what
                                     : e.actor + " " + k.verb + " a payment: " + what) + amt;
  }
  return e.actor + " " + k.verb + " " + (e.desc || "an expense") + amt;
}

/**
 * Read the queue, tell the right people, empty it.
 *
 * `db` and `send` are injected so this can be tested without a database or a
 * mail account.
 *
 * @param {object}   p
 * @param {object}   p.users   everything under users/
 * @param {Date}     p.at
 * @param {boolean}  p.dry     work it all out, send nothing
 * @param {string}   p.appUrl
 * @param {object}   p.db      { read(path), remove(path) }
 * @param {function} p.send    ({to, subject, html, text}) => Promise
 */
export async function runActivity({ users, at, dry, appUrl, db, send }) {
  const now = at.getTime();
  const log = { queued: 0, dropped: 0, sent: 0, failed: 0, errors: [] };

  const raw = await db.read("mail/queue");
  const keys = Object.keys(raw || {});
  if (!keys.length) return log;

  // Oldest first, so a flood loses the newest rather than the news.
  const entries = [];
  for (const key of keys) {
    const e = normaliseEntry(key, raw[key], now);
    if (e) entries.push(e); else log.dropped++;
  }
  entries.sort((a, b) => a.at - b.at);
  const batch = entries.slice(0, MAX_ENTRIES);
  log.queued = batch.length;

  // A group is read once however many notes mention it.
  const groups = {};
  for (const gid of [...new Set(batch.map((e) => e.gid))]) {
    groups[gid] = await db.read("trips/" + gid);
  }

  // Fold the notes into one bundle per person.
  const bundles = new Map();
  for (const e of batch) {
    const g = groups[e.gid];
    if (!g || !g.people) { log.dropped++; continue; }

    // Whoever wrote the note has to belong to the group it is about.
    // Without this, any signed-in account could post into any group.
    if (!isMember(g, e.actorUid)) { log.dropped++; continue; }

    const gname = (g.meta && g.meta.name) || e.gid;

    for (const uid of recipientUids(g, e.actorUid)) {
      const u = users[uid];
      if (!u || !u.profile) continue;
      if (!wants(u.prefs, e.kind)) continue;
      if (!looksLikeEmail(String(u.profile.email || ""))) continue;

      if (!bundles.has(uid)) bundles.set(uid, { uid, user: u, groups: new Map() });
      const bundle = bundles.get(uid);
      if (!bundle.groups.has(e.gid)) bundle.groups.set(e.gid, { group: gname, lines: [] });
      const slot = bundle.groups.get(e.gid);
      if (slot.lines.length < MAX_ITEMS) slot.lines.push(lineFor(e));
    }
  }

  for (const bundle of [...bundles.values()].slice(0, MAX_EMAILS)) {
    const email = String(bundle.user.profile.email).trim().toLowerCase();
    try {
      const groupList = [...bundle.groups.values()];
      const { subject, html, text } = activityEmail({
        name: String(bundle.user.profile.name || email.split("@")[0]),
        groups: groupList,
        appUrl
      });
      if (!dry) await send({ to: email, subject, html, text });
      log.sent++;
      console.log("[activity] " + (dry ? "DRY " : "") + "told " + email + " about " +
                  groupList.reduce((n, g) => n + g.lines.length, 0) + " thing(s)");
    } catch (err) {
      log.failed++;
      log.errors.push({ uid: bundle.uid, error: ((err && err.message) || String(err)).slice(0, 600) });
      console.error("[activity] failed for", bundle.uid, err);
    }
  }

  // Cleared whether or not the mail got through. These notes describe
  // something that has already happened and is visible in the app; keeping
  // them to retry would risk repeating the same failure every quarter of an
  // hour forever, which is worse than one missed notice.
  if (!dry) {
    for (const e of batch) await db.remove("mail/queue/" + e.key);
  }
  return log;
}
