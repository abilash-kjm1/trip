/* Run with: node test/ledger.test.js
   No framework. The point is to prove the server's arithmetic matches the
   app's, so an email never contradicts the screen. */
import { balances, settlements, sharesOf, groupSummary, cents } from "../lib/ledger.js";

let failed = 0;
function is(actual, expected, what) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log("  ok   " + what); }
  else { failed++; console.log("  FAIL " + what + "\n       expected " + e + "\n       got      " + a); }
}

const group = {
  meta: { name: "Montreal & Quebec" },
  people: {
    a: { n: "Abilash", uid: "u1" },
    b: { n: "Kalai", uid: "u2" },
    c: { n: "Kavya" },
    d: { n: "Kelvin" }
  },
  expenses: {
    e1: { desc: "Hotel", amount: 300, payer: "Kalai", mode: "equal",
          between: ["Abilash", "Kalai", "Kavya", "Kelvin"] },
    e2: { desc: "Dinner", amount: 100, payer: "Abilash", mode: "exact",
          between: ["Abilash", "Kalai", "Kavya", "Kelvin"],
          vals: { Abilash: 40, Kalai: 30, Kavya: 20, Kelvin: 10 } },
    e3: { desc: "Fuel", amount: 80, payer: "Kavya", mode: "equal",
          between: ["Kavya", "Kelvin"] },
    e4: { desc: "Suite", amount: 300, payer: "Kalai", mode: "shares",
          between: ["Abilash", "Kalai", "Kavya", "Kelvin"],
          vals: { Abilash: 2, Kalai: 2, Kavya: 1, Kelvin: 1 } },
    e5: { desc: "Tips", amount: 200, payer: "Kelvin", mode: "percent",
          between: ["Abilash", "Kelvin"], vals: { Abilash: 25, Kelvin: 75 } }
  },
  payments: {
    p1: { from: "Kelvin", to: "Kalai", amount: 20 }
  }
};

console.log("split modes");
is(sharesOf(group.expenses.e1), { Abilash: 75, Kalai: 75, Kavya: 75, Kelvin: 75 }, "equal");
is(sharesOf(group.expenses.e2), { Abilash: 40, Kalai: 30, Kavya: 20, Kelvin: 10 }, "exact");
is(sharesOf(group.expenses.e4), { Abilash: 100, Kalai: 100, Kavya: 50, Kelvin: 50 }, "shares");
is(sharesOf(group.expenses.e5), { Abilash: 50, Kelvin: 150 }, "percent");

console.log("balances");
const b = balances(group);
//  Abilash paid 100; share 75+40+100+50 = 265          -> -165
//  Kalai   paid 600; share 75+30+100    = 205; +20 pmt -> +375
//  Kavya   paid  80; share 75+20+40+50  = 185          -> -105
//  Kelvin  paid 200; share 75+10+40+50+150 = 325; -20  -> -105
is(b, { Abilash: -165, Kalai: 375, Kavya: -105, Kelvin: -105 }, "four people, five modes, one payment");
is(cents(Object.values(b).reduce((a, v) => a + v, 0)), 0, "balances sum to zero");

console.log("settlements");
const st = settlements(group);
is(cents(st.reduce((a, t) => a + t.amt, 0)), 375, "transfers total what the creditor is owed");
is(st.every((t) => t.to === "Kalai"), true, "everything routes to the only creditor");

console.log("per-account summary");
const s = groupSummary(group, "Montreal & Quebec", "u1");
is(s.me, "Abilash", "resolves the account to its person");
is(s.net, -165, "net matches the balance");
is(s.owes.map((x) => x.desc).sort(), ["Hotel", "Suite", "Tips"], "lines Abilash carries a share of");
is(s.lent.map((x) => x.desc), ["Dinner"], "lines Abilash paid that others still owe on");
is(s.lent[0].out, 60, "Dinner: paid 100, own share 40, so 60 is out");

console.log("an account that never claimed a name");
is(groupSummary(group, "x", "nobody"), null, "returns nothing rather than guessing");

console.log("rubbish input does not throw");
is(balances({}), {}, "empty group");
is(sharesOf(null), {}, "null expense");
is(balances({ expenses: { z: { amount: "not a number", payer: "A", between: ["A"] } } }),
   { A: 0 }, "non-numeric amount treated as zero");

console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
process.exit(failed ? 1 : 0);
