/* Joining Settle: the signed link, and the request reaching the administrator. */
import { makeToken, readToken, normaliseAccess, isApproved, TOKEN_TTL_MS,
         decisionPage, outcomePage } from "../lib/access.js";
import { runActivity, JOIN_KIND } from "../lib/activity.js";

let bad = 0;
const is = (a, e, w) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log("  ok   " + w);
  else { bad++; console.log("  FAIL " + w + "  expected " + JSON.stringify(e) + " got " + JSON.stringify(a)); }
};

const SECRET = "a-long-enough-cron-secret-for-testing";
const NOW = Date.parse("2026-09-13T18:00:00Z");

console.log("the link in the administrator's email");
const tok = makeToken("uid-1", SECRET, NOW);
is(readToken(tok, SECRET, NOW), "uid-1", "a good token names its person");
is(readToken(tok, "a-different-secret", NOW), null, "signed with another key");
is(readToken(tok + "x", SECRET, NOW), null, "a character added");
is(readToken(tok.slice(0, -1), SECRET, NOW), null, "a character removed");
is(readToken("", SECRET, NOW), null, "empty");
is(readToken("no-dot-here", SECRET, NOW), null, "not even the right shape");
is(readToken(null, SECRET, NOW), null, "not a string");
is(readToken(tok, SECRET, NOW + TOKEN_TTL_MS + 1000), null, "expired after a fortnight");
is(readToken(tok, SECRET, NOW + TOKEN_TTL_MS - 1000), "uid-1", "still good the day before");
is(makeToken("uid-1", SECRET, NOW) === makeToken("uid-2", SECRET, NOW), false,
   "two people never share a token");
// The payload is readable, as base64 always is - it carries no secret, and the
// signature is what stops it being changed.
const forged = Buffer.from(JSON.stringify({ u: "uid-9", e: NOW + 1e9 })).toString("base64url");
is(readToken(forged + "." + tok.split(".")[1], SECRET, NOW), null,
   "a swapped payload no longer matches the signature");

console.log("\nwhat the database says about somebody");
is(normaliseAccess({ status: "approved" }).status, "approved", "a known status");
is(normaliseAccess({ status: "ADMIN" }).status, null, "an invented status is not one");
is(normaliseAccess(null).status, null, "no record at all");
is(isApproved({ status: "approved" }), true, "approved");
is(isApproved({ status: "pending" }), false, "pending is not approved");
is(isApproved({}), false, "a record with nothing in it is not approved");
is(normaliseAccess({ email: "  ABI@Example.COM " }).email, "abi@example.com", "address tidied");

console.log("\nthe request reaching the administrator");
function fakeDb(queue, access) {
  const removed = [];
  return {
    removed,
    read: async (p) => {
      if (p === "mail/queue") return queue;
      const m = /^access\/(.+)$/.exec(p);
      if (m) return access[m[1]] || {};
      return {};
    },
    remove: async (p) => { removed.push(p); }
  };
}
const users = { u7: { profile: { name: "Kelvin", email: "kelvin@example.com" } } };
const ask = { kind: JOIN_KIND, actorUid: "u7", actor: "Kelvin", at: NOW - 1000 };

async function run(queue, access, extra = {}) {
  const db = fakeDb(queue, access);
  const sent = [];
  const log = await runActivity({
    users, at: new Date(NOW), dry: false, appUrl: "https://app.test/", db,
    send: async (m) => { sent.push(m); },
    adminEmail: "admin@example.com", secret: SECRET,
    apiBase: "https://api.test/", ...extra
  });
  return { log, sent, removed: db.removed };
}

let r = await run({ q1: ask }, { u7: { status: "pending", name: "Kelvin", email: "kelvin@example.com" } });
is([r.log.joins, r.log.sent], [1, 0], "one request passed on, and it is not a group notice");
is(r.sent[0].to, "admin@example.com", "it goes to the administrator");
is(r.sent[0].subject, "Kelvin wants to join Settle", "and says who");
is(/https:\/\/api\.test\/api\/access\?t=/.test(r.sent[0].text), true, "with a link back to this deployment");
is(r.removed, ["mail/queue/q1"], "the note is cleared");

const link = /api\/access\?t=([^\s"]+)/.exec(r.sent[0].text)[1];
is(readToken(decodeURIComponent(link), SECRET, NOW), "u7", "and the link really authorises that person");

console.log("\nrequests that must not reach anybody");
r = await run({ q1: ask }, { u7: { status: "approved" } });
is([r.log.joins, r.log.dropped], [0, 1], "somebody already approved is not asked about again");
r = await run({ q1: ask }, {});
is([r.log.joins, r.log.dropped], [0, 1], "a note with no matching request in the database");
r = await run({ q1: ask }, { u7: { status: "pending" } }, { adminEmail: "" });
is([r.log.joins, r.log.failed], [0, 1], "no administrator address configured: reported, not silent");
is(/ADMIN_EMAIL/.test(r.log.errors[0].error), true, "and the error says what is missing");

console.log("\na request travels alongside ordinary notices");
const group = { meta: { name: "Montreal" }, people: { a: { uid: "u1" }, b: { uid: "u2" } } };
const db = fakeDb({ q1: ask, q2: { kind: "expense.add", gid: "montreal", actorUid: "u1",
                                   actor: "Kalai", desc: "Dinner", amount: 20, at: NOW - 500 } },
                   { u7: { status: "pending", name: "Kelvin", email: "kelvin@example.com" } });
const baseRead = db.read;
db.read = async (p) => (p === "trips/montreal" ? group : baseRead(p));
const sent = [];
const log = await runActivity({
  users: { ...users, u2: { profile: { name: "Abi", email: "abi@example.com" }, prefs: { newExpense: true } } },
  at: new Date(NOW), dry: false, appUrl: "x", db, send: async (m) => { sent.push(m); },
  adminEmail: "admin@example.com", secret: SECRET, apiBase: "https://api.test/"
});
is([log.joins, log.sent, log.failed], [1, 1, 0], "both go out in the same pass");
is(sent.map((m) => m.to).sort(), ["abi@example.com", "admin@example.com"], "to the right two people");
is(db.removed.length, 2, "and both notes are cleared");

console.log("\nthe page the administrator lands on");
const pg = decisionPage({ name: "Kelvin Raj", email: "kelvin@example.com" }, "tok-123");
is(/Kelvin Raj wants to join Settle/.test(pg), true, "it says who is asking");
is(/kelvin@example\.com/.test(pg), true, "and which account");
is(/<form method="POST"/.test(pg), true, "deciding is a form, not a link");
is((pg.match(/type="submit"/g) || []).length, 2, "two buttons");
is(/value="tok-123"/.test(pg), true, "carrying the token through");
is(/noindex/.test(pg), true, "and it stays out of search results");

// A name is typed by the person asking, so it arrives here as their text.
const nasty = decisionPage({ name: "<script>alert(1)</script>", email: "x@y.z" }, "t");
is(/<script>alert/.test(nasty), false, "a name cannot smuggle in markup");
is(/&lt;script&gt;/.test(nasty), true, "it is shown as the text it is");
const nastyTok = decisionPage({ name: "A", email: "x@y.z" }, '"><script>x</script>');
is(/"><script>/.test(nastyTok), false, "nor can the token break out of its attribute");

is(/Kelvin Raj was approved/.test(outcomePage({ name: "Kelvin Raj" }, true, "Told them.")), true,
   "the outcome page says what happened");
is(/was declined/.test(outcomePage({ name: "Kelvin Raj" }, false, "Told them.")), true,
   "both ways");

console.log(bad ? "\n" + bad + " FAILED" : "\nall good");
process.exit(bad ? 1 : 0);
