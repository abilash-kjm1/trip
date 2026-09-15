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
import { money, sharesOf, cents, currencyOf } from "./ledger.js";
import { activityEmail, accessRequestEmail, groupInviteEmail, nudgeEmail } from "./template.js";
import { makeToken, normaliseAccess } from "./access.js";
import { deliver, subscriptionsOf, askMessage, answerMessage, nudgeMessage, expenseMessage } from "./push.js";

/* Asking to join is not activity in a group - there is no group yet - so it
   travels through the same queue but down its own path, to the administrator
   rather than to members. */
export const JOIN_KIND = "access.request";
export const INVITE_KIND = "group.invite";
export const NUDGE_KIND = "nudge";
// Somebody answered whether a payment reached them. Never emailed: it only
// tells the payer's phone, and only what the payment record itself says.
export const GOT_KIND = "payment.got";
// The payer asks again after being told it had not arrived. Push only too.
export const ASK_KIND = "payment.ask";
// What reaches a phone. Everything else is email only.
export const PUSH_KINDS = { "payment.add": 1, "payment.ask": 1, "payment.got": 1,
                            "expense.add": 1, "expense.edit": 1, "expense.del": 1 };
export const MAX_JOINS = 20;             // per run; a ceiling on invitation spam
export const MAX_INVITES = 20;
export const MAX_NUDGES = 20;
export const NUDGE_GUARD_MS = 20 * 3600 * 1000;  // one a day, per person, per group

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
  if (!KINDS[kind] && kind !== JOIN_KIND && kind !== INVITE_KIND && kind !== NUDGE_KIND &&
      kind !== GOT_KIND && kind !== ASK_KIND) return null;

  // A group id is a database key. Anything that could climb out of the path
  // is not one. A request to join names no group.
  const gid = str(raw.gid, 200);
  if (kind !== JOIN_KIND && (!gid || /[.#$/[\]]/.test(gid))) return null;

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

  // Which payment a note is about: a database key, nothing more. Only ever
  // used to look the payment up - whatever the note claims, the record decides.
  const ref = str(raw.ref, 64);

  return {
    key, kind, gid, actorUid, at, amount,
    actor: str(raw.actor, 80) || "Someone",
    desc:  str(raw.desc, 120),
    ref:   /^[A-Za-z0-9_-]+$/.test(ref) ? ref : null,
    // Already sent to phones - by /api/notify, usually. Emailed and cleared
    // as normal; just not pushed again.
    pushed: raw.pushed != null && raw.pushed !== false
  };
}

/** The notes one account wrote that no phone has heard about yet, oldest
    first. What /api/notify works through: only the caller's own. */
export function notesFor(raw, uid, now, max = 20) {
  return Object.keys(raw || {}).map((k) => normaliseEntry(k, raw[k], now))
    .filter((e) => e && e.actorUid === uid && !e.pushed && PUSH_KINDS[e.kind])
    .sort((a, b) => a.at - b.at)
    .slice(0, max);
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

/** Does this account want this sort of note? On unless they switched it off -
    so somebody who joins tomorrow hears about their group without having to
    find a settings screen first, and somebody who turned it off stays off. */
export function wants(prefs, kind) {
  const k = KINDS[kind];
  if (!k) return false;
  return (prefs || {})[k.pref] !== false;
}

/** Is the author of a note actually in the group it is about? */
export function isMember(group, uid) {
  const people = (group && group.people) || {};
  return Object.keys(people).some((k) => people[k] && people[k].uid === uid);
}

/** One line of an email, in plain words, in the group's currency. */
export function lineFor(e, cur) {
  const k = KINDS[e.kind];
  const amt = e.amount != null ? " - " + money(e.amount, cur) : "";

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
export async function runActivity({ users, at, dry, appUrl, db, send, push,
                                    adminEmail, secret, apiBase }) {
  const now = at.getTime();
  const log = { queued: 0, dropped: 0, sent: 0, failed: 0, joins: 0, invites: 0, nudges: 0,
                pushed: 0, pushGone: 0, pushFailed: 0, errors: [] };
  // Where a notification opens: the app, at the group it is about.
  const openAt = (gid) => String(appUrl || "").replace(/#.*$/, "") + "#g=" + encodeURIComponent(gid);

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

  // ---- requests to join -------------------------------------------------
  // One per person, to the administrator, with a link that opens the decision
  // page. The database is the authority on whether somebody is really waiting:
  // a note claiming otherwise is dropped.
  const joins = batch.filter((e) => e.kind === JOIN_KIND);
  for (const e of joins.slice(0, MAX_JOINS)) {
    try {
      const record = normaliseAccess(await db.read("access/" + e.actorUid));
      if (record.status !== "pending") { log.dropped++; continue; }
      if (!adminEmail || !secret || !apiBase) {
        throw new Error("ADMIN_EMAIL, CRON_SECRET and the site address are all needed " +
                        "before a request to join can be sent");
      }
      const profile = ((users[e.actorUid] || {}).profile) || {};
      const mail = accessRequestEmail({
        name: record.name || String(profile.name || ""),
        email: record.email || String(profile.email || ""),
        decideUrl: apiBase.replace(/\/+$/, "") + "/api/access?t=" +
                   encodeURIComponent(makeToken(e.actorUid, secret, now))
      });
      if (!dry) await send({ to: adminEmail, ...mail });
      log.joins++;
      console.log("[access] " + (dry ? "DRY " : "") + "asked the administrator about " + e.actorUid);
    } catch (err) {
      log.failed++;
      log.errors.push({ uid: e.actorUid, error: ((err && err.message) || String(err)).slice(0, 600) });
      console.error("[access] could not pass on the request from", e.actorUid, err);
    }
  }

  // ---- invitations to somebody not in Settle yet ------------------------
  // The note names the address, but it is only sent if that same address is
  // already written against a seat in that group. So this can reach nobody the
  // sender had not already recorded as a member - it is not a way to address
  // mail to anyone at all.
  const invites = batch.filter((e) => e.kind === INVITE_KIND);
  for (const e of invites.slice(0, MAX_INVITES)) {
    try {
      const g = await db.read("trips/" + e.gid);
      if (!g || !isMember(g, e.actorUid)) { log.dropped++; continue; }

      const to = String(e.desc || "").trim().toLowerCase();
      const seat = Object.keys(g.people || {}).map((k) => g.people[k])
        .find((p) => p && String(p.invite || "").trim().toLowerCase() === to && !p.uid);
      if (!to || !looksLikeEmail(to) || !seat) { log.dropped++; continue; }

      const mail = groupInviteEmail({
        name: String(seat.n || ""),
        inviter: e.actor,
        group: (g.meta && g.meta.name) || e.gid,
        appUrl
      });
      if (!dry) await send({ to, ...mail });
      log.invites++;
      console.log("[invite] " + (dry ? "DRY " : "") + "asked " + to + " to join " + e.gid);
    } catch (err) {
      log.failed++;
      log.errors.push({ gid: e.gid, error: ((err && err.message) || String(err)).slice(0, 600) });
      console.error("[invite] could not invite for", e.gid, err);
    }
  }

  // ---- a nudge: pay me back ---------------------------------------------
  // The note names a person by the name the group calls them; who that is
  // gets looked up here, from the group's own people list. So a nudge can
  // reach nobody but a member of a group the sender is also in.
  const nudges = batch.filter((e) => e.kind === NUDGE_KIND);
  for (const e of nudges.slice(0, MAX_NUDGES)) {
    try {
      const g = await db.read("trips/" + e.gid);
      if (!g || !isMember(g, e.actorUid)) { log.dropped++; continue; }

      const who = String(e.desc || "").trim();
      const seat = Object.keys(g.people || {}).map((k) => g.people[k])
        .find((p) => p && String(p.n || "").trim() === who && p.uid);
      if (!who || !seat) { log.dropped++; continue; }

      const them = users[seat.uid];
      const to = String(((them || {}).profile || {}).email || "").trim().toLowerCase();
      if (!looksLikeEmail(to)) { log.dropped++; continue; }

      // Being owed money is not a reason to be written to every five minutes.
      const last = Number(((g.nudges || {})[seat.uid]) || 0);
      if (last && now - last < NUDGE_GUARD_MS) { log.dropped++; continue; }

      const mail = nudgeEmail({
        name: String((them.profile || {}).name || who),
        from: e.actor,
        group: (g.meta && g.meta.name) || e.gid,
        amount: e.amount != null ? e.amount : 0,
        cur: currencyOf(g),
        appUrl
      });
      if (!dry) {
        await send({ to, ...mail });
        await db.set("trips/" + e.gid + "/nudges/" + seat.uid, now);
      }
      log.nudges++;
      await deliver({ uid: seat.uid, users, dry, push, db, log,
        message: nudgeMessage({ from: e.actor, amount: e.amount, cur: currencyOf(g),
                                group: (g.meta && g.meta.name) || e.gid,
                                url: openAt(e.gid), tag: "nudge-" + e.gid }) });
      console.log("[nudge] " + (dry ? "DRY " : "") + e.actor + " nudged " + to);
    } catch (err) {
      log.failed++;
      log.errors.push({ gid: e.gid, error: ((err && err.message) || String(err)).slice(0, 600) });
      console.error("[nudge] could not nudge for", e.gid, err);
    }
  }

  // ---- notices about a group --------------------------------------------
  const notes = batch.filter((e) => e.kind !== JOIN_KIND && e.kind !== INVITE_KIND
                                 && e.kind !== NUDGE_KIND && e.kind !== GOT_KIND
                                 && e.kind !== ASK_KIND);

  // A group is read once however many notes mention it.
  const groups = {};
  for (const gid of [...new Set(notes.map((e) => e.gid))]) {
    groups[gid] = await db.read("trips/" + gid);
  }

  // Fold the notes into one bundle per person.
  const bundles = new Map();
  for (const e of notes) {
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
      if (slot.lines.length < MAX_ITEMS) slot.lines.push(lineFor(e, currencyOf(g)));
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

  // ---- phone notifications ----------------------------------------------
  // Usually sent already, the moment it happened, by /api/notify. This pass
  // catches whatever that missed - an old copy of the app, a dropped
  // connection - and claims each note first, so nothing goes out twice.
  await runPush({ entries: batch.filter((e) => !e.pushed), users, dry, push, db, log, appUrl, groups });

  // Cleared whether or not the mail got through. These notes describe
  // something that has already happened and is visible in the app; keeping
  // them to retry would risk repeating the same failure every quarter of an
  // hour forever, which is worse than one missed notice.
  if (!dry) {
    for (const e of batch) await db.remove("mail/queue/" + e.key);
  }
  return log;
}

/**
 * Phone notifications for a set of outbox notes. Shared by the scheduler's
 * pass and /api/notify, which runs it the moment somebody saves.
 *
 * Every note is checked against the database: it only says which payment or
 * expense to look at. So nobody can be told about a payment, an answer or an
 * expense that the group's own records do not show - and only people in that
 * group are ever told. Each one that reaches nobody says why, in the log.
 *
 * `db.claim(entry)`, when given, marks a note as pushed and says whether this
 * caller got it; it is asked just before sending.
 */
export async function runPush({ entries, users, dry, push, db, log, appUrl, groups = {} }) {
  if (!log.pushSkipped) log.pushSkipped = [];
  const openAt = (gid) => String(appUrl || "").replace(/#.*$/, "") + "#g=" + encodeURIComponent(gid);
  const skip = (e, why) => {
    if (log.pushSkipped.length < 30) log.pushSkipped.push(e.kind + " " + (e.ref || "-") + ": " + why);
    console.log("[push] skipped " + e.kind + " " + (e.ref || "-") + " - " + why);
  };
  const claim = async (e) => (dry || !db || !db.claim) ? true : db.claim(e);
  const nameOf = (g, uid) => {
    const s = Object.values(g.people || {}).find((p) => p && p.uid === uid);
    return s ? String(s.n || "") : "";
  };
  const todo = (entries || []).filter((x) => PUSH_KINDS[x.kind]);

  if (!push && !dry) {
    todo.forEach((e) => skip(e, "phone notifications are not configured on the server (VAPID keys missing or unusable)"));
    return log;
  }

  for (const e of todo) {
    try {
      if (!e.ref && e.kind !== "expense.del") {
        skip(e, "the note names no record - it came from an old copy of the app"); continue;
      }
      if (groups[e.gid] === undefined) groups[e.gid] = await db.read("trips/" + e.gid);
      const g = groups[e.gid];
      if (!g || !isMember(g, e.actorUid)) { skip(e, "whoever wrote it is not in that group"); continue; }
      const gname = (g.meta && g.meta.name) || e.gid;

      if (e.kind.startsWith("expense.")) { await expense(e, g, gname); continue; }

      // ---- a payment, and whether it arrived ----
      const p = (g.payments || {})[e.ref];
      if (!p || typeof p !== "object") { skip(e, "that payment no longer exists"); continue; }
      if (p.netted) { skip(e, "netted across groups - no money moved"); continue; }
      const seat = Object.values(g.people || {}).find((s) =>
        s && s.n === p.to && typeof s.uid === "string" && s.uid);
      if (!seat) { skip(e, "\"" + p.to + "\" has no Settle account linked in this group"); continue; }
      const amount = Number(p.amount) || 0;

      if (e.kind !== GOT_KIND) {
        // Recorded by this author, still waiting, and not to themselves.
        if (p.byUid !== e.actorUid) { skip(e, "the payment was recorded by somebody else"); continue; }
        if (p.ask !== true) { skip(e, "the payment is not asking - it was saved by an old copy of the app"); continue; }
        if (p.got) { skip(e, "already answered in the app"); continue; }
        if (seat.uid === e.actorUid) { skip(e, "paid to themselves"); continue; }
        if (!subscriptionsOf(users[seat.uid]).length) {
          skip(e, p.to + " has not turned on phone notifications on any device"); continue;
        }
        if (!(await claim(e))) { skip(e, "already sent"); continue; }
        console.log("[push] " + (dry ? "DRY " : "") + "asking " + seat.uid + " about " + e.ref);
        await deliver({ uid: seat.uid, users, dry, push, db, log,
          message: askMessage({ from: p.from, amount, cur: currencyOf(g), group: gname, url: openAt(e.gid),
                                tag: "arrive-" + e.gid + "-" + e.ref }) });
      } else {
        // Answered by the person it went to, and told to whoever recorded it.
        const got = p.got;
        if (!got || typeof got !== "object") { skip(e, "the payment has no answer recorded"); continue; }
        if (got.uid !== e.actorUid || seat.uid !== e.actorUid) { skip(e, "answered by somebody it did not go to"); continue; }
        if (typeof p.byUid !== "string" || !p.byUid || p.byUid === e.actorUid) { skip(e, "nobody else to tell"); continue; }
        if (!subscriptionsOf(users[p.byUid]).length) {
          skip(e, "whoever recorded it has not turned on phone notifications"); continue;
        }
        if (!(await claim(e))) { skip(e, "already sent"); continue; }
        console.log("[push] " + (dry ? "DRY " : "") + "telling " + p.byUid + " the answer to " + e.ref);
        await deliver({ uid: p.byUid, users, dry, push, db, log,
          message: answerMessage({ to: p.to, amount, cur: currencyOf(g), ok: got.ok === true, group: gname,
                                   url: openAt(e.gid), tag: "answer-" + e.gid + "-" + e.ref }) });
      }
    } catch (err) {
      log.pushFailed++;
      log.errors.push({ gid: e.gid, error: ("push: " + ((err && err.message) || String(err))).slice(0, 300) });
      console.error("[push] could not notify for", e.gid, err);
    }
  }
  return log;

  /* An expense added or changed tells the people in it - whoever paid and
     whoever it is split between - with their own share. A deletion cannot be
     looked up any more, so it tells everybody in the group, and only once the
     expense really is gone. Never the person who did it, and never somebody
     who switched that kind off on the Account screen. */
  async function expense(e, g, gname) {
    const seats = Object.values(g.people || {}).filter((s) => s && typeof s.uid === "string" && s.uid);
    const actor = nameOf(g, e.actorUid) || e.actor;
    let exp = null, involved;
    if (e.kind === "expense.del") {
      if (e.ref && (g.expenses || {})[e.ref]) { skip(e, "that expense has not been deleted"); return; }
      involved = seats;
    } else {
      exp = (g.expenses || {})[e.ref];
      if (!exp || typeof exp !== "object") { skip(e, "that expense no longer exists"); return; }
      if (e.kind === "expense.add" && exp.byUid && exp.byUid !== e.actorUid) {
        skip(e, "the expense was added by somebody else"); return;
      }
      const names = new Set([exp.payer, ...Object.keys(sharesOf(exp))]);
      involved = seats.filter((s) => names.has(s.n));
    }
    const uids = [...new Set(involved.map((s) => s.uid))].filter((u) => u !== e.actorUid);
    if (!uids.length) { skip(e, "nobody else in it has an account"); return; }
    const wanting = uids.filter((u) => wants((users[u] || {}).prefs, e.kind));
    const reachable = wanting.filter((u) => subscriptionsOf(users[u]).length);
    if (!reachable.length) {
      skip(e, wanting.length ? "nobody in it has phone notifications on" : "everybody in it has switched these off");
      return;
    }
    if (!(await claim(e))) { skip(e, "already sent"); return; }
    const shares = exp ? sharesOf(exp) : {};
    for (const u of reachable) {
      const me = nameOf(g, u);
      await deliver({ uid: u, users, dry, push, db, log,
        message: expenseMessage({
          kind: e.kind, actor, group: gname, cur: currencyOf(g),
          desc: exp ? exp.desc : e.desc,
          amount: exp ? Number(exp.amount) : e.amount,
          share: exp ? cents(shares[me] || 0) : null,
          paidByYou: !!exp && exp.payer === me,
          url: openAt(e.gid), tag: "exp-" + e.gid + "-" + (e.ref || e.key)
        }) });
    }
    console.log("[push] " + (dry ? "DRY " : "") + e.kind + " " + (e.ref || "-") + " told " + reachable.length + " account(s)");
  }
}
