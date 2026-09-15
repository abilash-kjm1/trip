/* Phone notifications: which subscriptions are believed, who gets pushed,
   and what a tampered note can and cannot do. */
import { cleanSubscription, subscriptionsOf, askMessage, answerMessage } from "../lib/push.js";
import { runActivity, notesFor } from "../lib/activity.js";

let bad = 0;
const is = (a, e, w) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log("  ok   " + w);
  else { bad++; console.log("  FAIL " + w + "  expected " + JSON.stringify(e) + " got " + JSON.stringify(a)); }
};

const NOW = Date.parse("2026-09-14T18:00:00Z");
const P256 = "B" + "A".repeat(86), AUTH = "A".repeat(22);
const sub = (endpoint) => ({ endpoint, keys: { p256dh: P256, auth: AUTH } });

console.log("a subscription is checked before it is used");
is(!!cleanSubscription(sub("https://fcm.googleapis.com/fcm/send/abc")), true, "Chrome on Android");
is(!!cleanSubscription(sub("https://web.push.apple.com/QGx")), true, "Safari on iPhone");
is(!!cleanSubscription(sub("https://updates.push.services.mozilla.com/wpush/v2/x")), true, "Firefox");
is(cleanSubscription(sub("https://evil.example.com/hook")), null, "somewhere that is not a push service");
is(cleanSubscription(sub("http://fcm.googleapis.com/fcm/send/abc")), null, "not https");
is(cleanSubscription(sub("https://fcm.googleapis.com:8443/x")), null, "an odd port");
is(cleanSubscription(sub("https://fcm.googleapis.com.evil.com/x")), null, "a look-alike host");
is(cleanSubscription(sub("https://user:pw@fcm.googleapis.com/x")), null, "credentials in the address");
is(cleanSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: AUTH } }), null,
   "a key that is not a key");
is(cleanSubscription({ endpoint: "https://fcm.googleapis.com/x" }), null, "no keys");
is(cleanSubscription("nope"), null, "not an object");
is(subscriptionsOf({ push: { ok1: sub("https://fcm.googleapis.com/a"), "bad/id": sub("https://fcm.googleapis.com/b"),
                             junk: { endpoint: "x" } } }).map((x) => x.id),
   ["ok1"], "only sound devices under sound ids");
is(subscriptionsOf(undefined), [], "an account with none");

console.log("\nhow they read");
is(askMessage({ from: "Kelvin", amount: 45.5, group: "Montreal" }).title, "Did $45.50 arrive?", "the question");
is(askMessage({ from: "Kelvin", amount: 45.5, group: "Montreal" }).sticky, true, "stays until it is dealt with");
is(answerMessage({ to: "Kelvin", amount: 45.5, ok: true, group: "Montreal" }).title, "Kelvin got your $45.50", "a yes");
is(answerMessage({ to: "Kelvin", amount: 45.5, ok: false, group: "Montreal" }).sticky, true, "a no stays on screen");
is(askMessage({ from: "Priya", amount: 4500, group: "Goa", cur: "INR" }).title, "Did ₹4,500.00 arrive?", "the question, in rupees");
is(/UPI app/.test(askMessage({ from: "Priya", amount: 4500, group: "Goa", cur: "INR" }).body), true, "a rupee payment is checked in a UPI app");
is(answerMessage({ to: "Priya", amount: 250000, ok: true, group: "Goa", cur: "INR" }).title, "Priya got your ₹2,50,000.00", "a yes, in lakhs");

/* ---- a small world ---- */
const group = {
  meta: { name: "Montreal" },
  people: { a: { n: "Abilash", uid: "u1" }, b: { n: "Kelvin", uid: "u2" }, c: { n: "Kavya", uid: "u3" } },
  payments: {
    p1: { from: "Abilash", to: "Kelvin", amount: 45.5, byUid: "u1", ask: true, at: NOW - 60000 },
    p2: { from: "Abilash", to: "Kelvin", amount: 20, byUid: "u1", ask: true, got: { ok: false, uid: "u2", at: NOW - 1000 } },
    p3: { from: "Kavya", to: "Kelvin", amount: 5, byUid: "u3", ask: true, netted: true },
    p4: { from: "Abilash", to: "Kelvin", amount: 9, byUid: "u1", ask: true, got: { ok: true, uid: "u2", at: NOW - 1000 } }
  }
};
const users = {
  u1: { profile: { name: "Abilash", email: "abi@example.com" }, push: { d1: sub("https://web.push.apple.com/abi") } },
  u2: { profile: { name: "Kelvin", email: "kel@example.com" }, prefs: { payments: false },
        push: { d2: sub("https://fcm.googleapis.com/fcm/send/kel"), d3: sub("https://fcm.googleapis.com/fcm/send/old") } },
  u3: { profile: { name: "Kavya", email: "kav@example.com" } }
};
function fakeDb(queue) {
  const removed = [];
  return {
    removed,
    read: async (p) => (p === "mail/queue" ? queue : p === "trips/montreal" ? group : {}),
    remove: async (p) => { removed.push(p); },
    set: async () => {}
  };
}
async function run(queue, { fail, noPush, dry, claim } = {}) {
  const db = fakeDb(queue), pushed = [], sent = [];
  if (claim) db.claim = claim;
  const log = await runActivity({
    users, at: new Date(NOW), dry: !!dry, appUrl: "https://app.test/trip/", db,
    send: async (m) => { sent.push(m); },
    push: noPush ? null : async (s, payload, opts) => {
      if (fail) await fail(s);
      pushed.push({ to: s.endpoint, msg: JSON.parse(payload), opts });
    }
  });
  return { log, pushed, sent, removed: db.removed };
}
const note = (kind, ref, actorUid = "u1", extra = {}) => ({
  kind, gid: "montreal", actorUid, actor: "Abilash", desc: "Abilash paid Kelvin",
  amount: 45.5, at: NOW - 5000, ref, ...extra
});
const KEL = ["https://fcm.googleapis.com/fcm/send/kel", "https://fcm.googleapis.com/fcm/send/old"];

console.log("\na new payment asks the person it went to");
let r = await run({ n1: note("payment.add", "p1") });
is(r.pushed.map((x) => x.to), KEL, "every one of Kelvin's devices, nobody else's");
is(r.pushed[0].msg.title, "Did $45.50 arrive?", "asking the question");
is(r.pushed[0].msg.url, "https://app.test/trip/#g=montreal", "opening at the group");
is(r.pushed[0].opts.TTL, 86400, "and not kept waiting more than a day");
is(r.removed, ["mail/queue/n1"], "the note is cleared as usual");

console.log("\nnotes that must not reach a phone");
r = await run({ n1: note("payment.add", "p1", "u3") });
is(r.pushed.length, 0, "a payment somebody else recorded");
r = await run({ n1: note("payment.add", "nope") });
is(r.pushed.length, 0, "a payment that does not exist");
r = await run({ n1: note("payment.add", "p2") });
is(r.pushed.length, 0, "one that has already been answered");
r = await run({ n1: note("payment.add", "p3", "u3") });
is(r.pushed.length, 0, "money netted, not moved");
r = await run({ n1: note("payment.add", "p1", "u9") });
is(r.pushed.length, 0, "an author outside the group");
r = await run({ n1: note("payment.add", "../p1") });
is(r.pushed.length, 0, "a reference that is not a key");

console.log("\nan answer tells whoever recorded it, in the record's words");
r = await run({ n1: note("payment.got", "p4", "u2") });
is([r.pushed.length, r.pushed[0] && r.pushed[0].to, r.pushed[0] && r.pushed[0].msg.title],
   [1, "https://web.push.apple.com/abi", "Kelvin got your $9.00"], "a yes, to Abilash");
is(r.sent.length, 0, "and it is never emailed");
r = await run({ n1: note("payment.got", "p2", "u2", { ok: true }) });
is(r.pushed[0] && r.pushed[0].msg.title, "Kelvin can’t see your $20.00",
   "the note says yes, the record says no: the record wins");
r = await run({ n1: note("payment.got", "p4", "u3") });
is(r.pushed.length, 0, "an answer from somebody the payment did not go to");
r = await run({ n1: note("payment.got", "p1", "u2") });
is(r.pushed.length, 0, "an answer the record does not have");

console.log("\nasking again");
r = await run({ n1: note("payment.ask", "p1") });
is([r.pushed.length, r.sent.length], [2, 0], "Kelvin's phones are asked again, and nobody is emailed");

console.log("\na phone that has gone away is forgotten");
r = await run({ n1: note("payment.add", "p1") }, {
  fail: async (s) => { if (s.endpoint.endsWith("/old")) { const e = new Error("gone"); e.statusCode = 410; throw e; } }
});
is([r.log.pushed, r.log.pushGone, r.removed.includes("users/u2/push/d3")], [1, 1, true], "its subscription is removed");
r = await run({ n1: note("payment.add", "p1") }, {
  fail: async () => { const e = new Error("busy"); e.statusCode = 503; throw e; }
});
is([r.log.pushFailed, r.removed.length], [2, 1], "a busy service is a failure, not a reason to forget the phone");

console.log("\nwithout keys, or on a dry run");
r = await run({ n1: note("payment.add", "p1") }, { noPush: true });
is([r.pushed.length, r.log.pushed], [0, 0], "no sender configured, nothing pushed");
r = await run({ n1: note("payment.add", "p1") }, { dry: true });
is([r.pushed.length, r.log.pushed, r.removed.length], [0, 2, 0], "a dry run counts, sends nothing, clears nothing");

console.log("\nsaying why nothing was pushed");
r = await run({ n1: note("payment.add", "p2") });
is(r.log.pushSkipped, ["payment.add p2: already answered in the app"], "an answered payment says so");
r = await run({ n1: note("payment.add", "p1") }, { noPush: true });
is(r.log.pushSkipped.length === 1 && r.log.pushSkipped[0].includes("not configured"), true, "missing keys say so");
r = await run({ n1: { ...note("payment.add", "p1"), ref: undefined } });
is(r.log.pushSkipped.length === 1 && r.log.pushSkipped[0].includes("old copy"), true,
   "a note from an old copy of the app says so");
const kelvinsPhones = users.u2.push; delete users.u2.push;
r = await run({ n1: note("payment.add", "p1") });
is(r.log.pushSkipped.length === 1 && r.log.pushSkipped[0].includes("not turned on"), true,
   "somebody who never turned them on says so");
users.u2.push = kelvinsPhones;

console.log("\nexpenses reach the people in them");
group.expenses = {
  e1: { desc: "Dinner", amount: 90, payer: "Abilash", mode: "equal",
        between: ["Abilash", "Kelvin", "Kavya"], byUid: "u1", at: NOW - 9000 }
};
const exp = (kind, ref, actorUid = "u1", extra = {}) => ({
  kind, gid: "montreal", actorUid, actor: "Someone", desc: "Dinner", amount: 90, at: NOW - 4000, ref, ...extra
});
r = await run({ n1: exp("expense.add", "e1") });
is([r.pushed.map((x) => x.to), r.pushed[0] && r.pushed[0].msg.title, r.pushed[0] && r.pushed[0].msg.body],
   [KEL, "Abilash added Dinner · $90.00", "Your share $30.00 · Montreal"],
   "Kelvin hears, with his own share, named from the group rather than the note");
r = await run({ n1: exp("expense.edit", "e1", "u2") });
is([r.pushed.map((x) => x.to), r.pushed[0] && r.pushed[0].msg.title, r.pushed[0] && r.pushed[0].msg.body],
   [["https://web.push.apple.com/abi"], "Kelvin changed Dinner · $90.00", "You paid · Montreal"],
   "a change tells the others in it, never the one who made it");
is(r.pushed[0] && r.pushed[0].msg.tag, "exp-montreal-e1", "and replaces the earlier notification about it");
r = await run({ n1: exp("expense.del", "gone", "u1", { desc: "Taxi", amount: 12 }) });
is([r.pushed.length, r.pushed[0] && r.pushed[0].msg.title], [2, "Abilash deleted Taxi · $12.00"],
   "a deletion tells the group");
r = await run({ n1: exp("expense.del", "e1") });
is([r.pushed.length, r.log.pushSkipped[0]], [0, "expense.del e1: that expense has not been deleted"],
   "a deletion that did not happen tells nobody");
r = await run({ n1: exp("expense.add", "e1", "u2") });
is(r.pushed.length, 0, "an expense somebody else added cannot be announced by another");
users.u2.prefs = { payments: false, newExpense: false };
r = await run({ n1: exp("expense.add", "e1") });
is(r.pushed.length, 0, "the New expenses switch covers the phone too");
users.u2.prefs = { payments: false };

console.log("\nsent once, whoever gets there first");
r = await run({ n1: note("payment.add", "p1") }, { claim: async () => false });
is([r.pushed.length, !!(r.log.pushSkipped[0] && r.log.pushSkipped[0].includes("already sent"))], [0, true],
   "a note the instant notifier already sent is not sent again");
r = await run({ n1: note("payment.add", "p1", "u1", { pushed: "c123" }) });
is([r.pushed.length, r.log.pushSkipped.length, r.removed], [0, 0, ["mail/queue/n1"]],
   "an already-pushed note is still cleared, quietly");
const outbox = {
  a: note("payment.add", "p1"),
  b: note("payment.add", "p1", "u2"),
  c: note("payment.add", "p1", "u1", { pushed: "x" }),
  d: { ...exp("expense.add", "e1"), at: NOW - 9000 },
  e: { kind: "nudge", gid: "montreal", actorUid: "u1", at: NOW - 1000, desc: "Kelvin" }
};
is(notesFor(outbox, "u1", NOW).map((x) => x.key), ["d", "a"],
   "the instant notifier only takes the caller's own unsent notes, oldest first");

console.log(bad ? "\n" + bad + " FAILED" : "\nall good");
process.exit(bad ? 1 : 0);
