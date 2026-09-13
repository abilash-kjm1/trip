/* Activity notices: what gets thrown away, who gets told, what is left behind. */
import { normaliseEntry, recipientUids, wants, isMember, lineFor, runActivity }
  from "../lib/activity.js";

let bad = 0;
const is = (a, e, w) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log("  ok   " + w);
  else { bad++; console.log("  FAIL " + w + "  expected " + JSON.stringify(e) + " got " + JSON.stringify(a)); }
};

const NOW = Date.parse("2026-09-13T18:00:00Z");
const good = { kind: "expense.add", gid: "montreal", actorUid: "u1",
               actor: "Kalai", desc: "Dinner", amount: 84.5, at: NOW - 60000 };

console.log("a note the browser wrote is checked before it is believed");
is(normaliseEntry("k", good, NOW).desc, "Dinner", "a sound note survives");
is(normaliseEntry("k", null, NOW), null, "nothing at all");
is(normaliseEntry("k", { ...good, kind: "expense.nuke" }, NOW), null, "a kind we do not send");
is(normaliseEntry("k", { ...good, gid: "a/../b" }, NOW), null, "a group id that walks the path");
is(normaliseEntry("k", { ...good, gid: "" }, NOW), null, "no group id");
is(normaliseEntry("k", { ...good, actorUid: "" }, NOW), null, "no author");
is(normaliseEntry("k", { ...good, at: NOW - 3 * 24 * 3600 * 1000 }, NOW), null, "three days old is not news");
is(normaliseEntry("k", { ...good, at: NOW + 5 * 3600 * 1000 }, NOW), null, "five hours in the future");
is(normaliseEntry("k", { ...good, amount: -5 }, NOW).amount, null, "a negative amount is dropped, the note is not");
is(normaliseEntry("k", { ...good, amount: "lots" }, NOW).amount, null, "an amount that is not a number");
is(normaliseEntry("k", { ...good, actor: "" }, NOW).actor, "Someone", "an unnamed author still reads properly");
is(normaliseEntry("k", { ...good, desc: "x".repeat(400) }, NOW).desc.length, 120, "a very long description is cut");

console.log("\nwho hears about it");
const group = {
  meta: { name: "Montreal" },
  people: { a: { n: "Kalai", uid: "u1" }, b: { n: "Abilash", uid: "u2" },
            c: { n: "Kavya", uid: "u3" }, d: { n: "Kelvin" } }
};
is(recipientUids(group, "u1"), ["u2", "u3"], "everyone with an account but the author");
is(recipientUids(group, "u9"), ["u1", "u2", "u3"], "an author from outside excludes nobody");
is(isMember(group, "u2"), true, "a member is a member");
is(isMember(group, "u9"), false, "a stranger is not");

console.log("\nthe switches on the Account screen");
is(wants({ newExpense: true }, "expense.add"), true, "asked for new expenses");
is(wants({}, "expense.add"), false, "off unless switched on");
is(wants({ newExpense: true }, "expense.del"), false, "new expenses does not cover deletions");
is(wants({ updates: true }, "expense.del"), true, "changes covers deletions");
is(wants({ updates: true }, "payment.add"), false, "changes does not cover payments");
is(wants({ payments: true }, "payment.add"), true, "payments does");

console.log("\nhow a line reads");
is(lineFor(normaliseEntry("k", good, NOW)), "Kalai added Dinner - $84.50", "with an amount");
is(lineFor(normaliseEntry("k", { ...good, amount: null }, NOW)), "Kalai added Dinner", "without one");
is(lineFor(normaliseEntry("k", { ...good, desc: "", amount: null }, NOW)), "Kalai added an expense", "with no description");
const pay = { ...good, kind: "payment.add", desc: "Kelvin paid Abilash", amount: 120 };
is(lineFor(normaliseEntry("k", pay, NOW)), "Kelvin paid Abilash - $120.00",
   "a new payment names nobody twice");
is(lineFor(normaliseEntry("k", { ...pay, kind: "payment.del" }, NOW)),
   "Kalai deleted a payment: Kelvin paid Abilash - $120.00",
   "a deletion says who did it");

/* ---- the whole pass, over a fake database ---- */
function fakeDb(queue, groups) {
  const removed = [];
  return {
    removed,
    read: async (p) => {
      if (p === "mail/queue") return queue;
      const m = /^trips\/(.+)$/.exec(p);
      return (m && groups[m[1]]) || {};
    },
    remove: async (p) => { removed.push(p); }
  };
}
const users = {
  u1: { profile: { name: "Kalai", email: "kalai@example.com" }, prefs: { newExpense: true } },
  u2: { profile: { name: "Abilash", email: "abi@example.com" }, prefs: { newExpense: true, payments: true } },
  u3: { profile: { name: "Kavya", email: "kavya@example.com" }, prefs: {} }
};
const at = new Date(NOW);

async function run(queue, groups = { montreal: group }) {
  const db = fakeDb(queue, groups);
  const sent = [];
  const log = await runActivity({
    users, at, dry: false, appUrl: "https://example.test/",
    db, send: async (m) => { sent.push(m); }
  });
  return { log, sent, removed: db.removed };
}

console.log("\na full pass");
let r = await run({ n1: good });
is(r.log.sent, 1, "one email, not three");
is(r.sent[0].to, "abi@example.com", "to the one who asked for it");
is(r.sent[0].subject, "One update in Montreal", "named the group in the subject");
is(r.removed, ["mail/queue/n1"], "the note is cleared");

console.log("\nseveral things at once become one email");
r = await run({
  n1: good,
  n2: { ...good, desc: "Petrol", amount: 60, at: NOW - 30000 },
  n3: { kind: "payment.add", gid: "montreal", actorUid: "u1", actor: "Kalai",
        desc: "Kalai paid Abilash", amount: 20, at: NOW - 10000 }
});
is(r.log.sent, 1, "still one email");
is(r.sent[0].subject, "3 updates in Montreal", "counted, and the group named");
is(r.sent[0].text.includes("Kalai paid Abilash - $20.00"), true, "the payment is in it");
is(r.removed.length, 3, "all three notes cleared");

console.log("\nnotes that must not reach anybody");
r = await run({ n1: { ...good, actorUid: "u9" } });          // not in the group
is([r.log.sent, r.log.dropped], [0, 1], "an author who is not in the group is ignored");
r = await run({ n1: { ...good, gid: "nowhere" } });
is([r.log.sent, r.log.dropped], [0, 1], "a group that does not exist");
r = await run({ n1: { ...good, kind: "payment.add" } });
is(r.log.sent, 1, "Abilash wants payments");
r = await run({ n1: { ...good, actorUid: "u2" } });          // Abilash did it himself
is([r.log.sent, r.sent[0].to], [1, "kalai@example.com"],
   "the author hears nothing about their own doing; Kalai, who asked, does");

console.log("\na dry run changes nothing");
const db = fakeDb({ n1: good }, { montreal: group });
const sent = [];
const dlog = await runActivity({ users, at, dry: true, appUrl: "x",
                                 db, send: async (m) => { sent.push(m); } });
is([dlog.sent, sent.length, db.removed.length], [1, 0, 0],
   "counted, but nothing sent and nothing cleared");

console.log("\none failure does not swallow the rest");
const twoGroups = {
  montreal: group,
  quebec: { meta: { name: "Quebec" }, people: { a: { n: "Kalai", uid: "u1" }, b: { n: "Kavya", uid: "u3" } } }
};
const db2 = fakeDb({ n1: good, n2: { ...good, gid: "quebec" } }, twoGroups);
users.u3.prefs = { newExpense: true };
let n = 0;
const flog = await runActivity({
  users, at, dry: false, appUrl: "x", db: db2,
  send: async () => { if (++n === 1) throw new Error("mailbox full"); }
});
is([flog.sent, flog.failed], [1, 1], "one got through, one did not");
is(db2.removed.length, 2, "the queue is cleared either way");
users.u3.prefs = {};

console.log("\nan empty queue costs nothing");
r = await run({});
is([r.log.queued, r.log.sent, r.removed.length], [0, 0, 0], "no reads, no sends, no deletes");

console.log(bad ? "\n" + bad + " FAILED" : "\nall good");
process.exit(bad ? 1 : 0);
