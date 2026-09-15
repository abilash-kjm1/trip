/* Run with: node test/ledger.test.js
   No framework. The point is to prove the server's arithmetic matches the
   app's, so an email never contradicts the screen. */
import { balances, settlements, sharesOf, groupSummary, cents, money, currencyOf } from "../lib/ledger.js";
import { reminderEmail } from "../lib/template.js";

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

console.log("currencies");
is(money(1234.5), "$1234.50", "dollars read as they always have");
is(money(-12.346), "-$12.35", "a negative, rounded to the cent");
is(money(4500, "INR"), "₹4,500.00", "rupees, in thousands");
is(money(1234567.891, "INR"), "₹12,34,567.89", "rupees, in lakhs");
is(money(123456789, "INR"), "₹12,34,56,789.00", "rupees, in crores");
is(money(999, "INR"), "₹999.00", "rupees under a thousand");
is(money(-100000, "INR"), "-₹1,00,000.00", "negative rupees");
is(money(20, "USD"), "$20.00", "US dollars are not a currency here");
is(money(20, "EUR"), "$20.00", "anything unexpected is dollars");
is(currencyOf({ meta: { currency: "INR" } }), "INR", "a rupee group");
is(currencyOf({ meta: {} }), "CAD", "no currency means Canadian dollars");
is(currencyOf({ meta: { currency: "toString" } }), "CAD", "not fooled by an inherited name");
is(groupSummary({ meta: { currency: "INR" }, people: { a: { n: "A", uid: "u1" }, b: { n: "B" } },
                  expenses: { e: { desc: "Chai", amount: 100, payer: "B", between: ["A", "B"] } } }, "Goa", "u1").cur,
   "INR", "a summary says which currency it is in");

// Two groups in two currencies: totals stay apart.
const two = reminderEmail({
  name: "Abi", owe: 50, owed: 900, appUrl: "https://x",
  groups: [
    { group: "Goa", cur: "INR", me: "A", net: 900, owes: [], lent: [], plan: [{ from: "B", to: "A", amt: 900 }] },
    { group: "Montreal", cur: "CAD", me: "A", net: -50, owes: [], lent: [], plan: [{ from: "A", to: "C", amt: 50 }] }
  ]
});
is(two.subject, "You are owed ₹900.00 · You owe $50.00", "the subject names each currency");
is(/Total you owe \(INR\): ₹0\.00/.test(two.text) && /Total you owe \(CAD\): \$50\.00/.test(two.text), true,
   "a total per currency, never added together");
is(/B in Goa: ₹900\.00/.test(two.text), true, "who owes, in their group's currency");
const one = reminderEmail({ name: "Abi", owe: 12.5, owed: 0, appUrl: "https://x",
  groups: [{ group: "Montreal", me: "A", net: -12.5, owes: [], lent: [], plan: [] }] });
is(one.subject, "You owe $12.50", "one currency reads exactly as before");
is(/Total you owe: \$12\.50/.test(one.text), true, "and its totals carry no currency tag");

console.log("\nsplit modes");
is(sharesOf(group.expenses.e1), { Abilash: 75, Kalai: 75, Kavya: 75, Kelvin: 75 }, "equal");
is(sharesOf(group.expenses.e2), { Abilash: 40, Kalai: 30, Kavya: 20, Kelvin: 10 }, "exact");
is(sharesOf(group.expenses.e4), { Abilash: 100, Kalai: 100, Kavya: 50, Kelvin: 50 }, "shares");
is(sharesOf(group.expenses.e5), { Abilash: 50, Kelvin: 150 }, "percent");

console.log("\nsplits always add up to the cent, never a leftover penny");
// $100 split three ways used to give everyone $33.333...repeating. Now every
// share is rounded to the cent, and whatever that rounding leaves over or
// short lands on the payer.
const hundred = { amount: 100, payer: "Abilash", mode: "equal", between: ["Abilash", "Kalai", "Kavya"] };
const hs = sharesOf(hundred);
is(hs, { Abilash: 33.34, Kalai: 33.33, Kavya: 33.33 }, "the payer's seat takes the odd cent");
is(cents(hs.Abilash + hs.Kalai + hs.Kavya), 100, "and the three shares add back up to exactly $100");
// The payer is not always in the split - lent out entirely to others - so
// the correction falls back to the first name instead.
const lentOut = { amount: 10, payer: "Abilash", mode: "equal", between: ["Kalai", "Kavya", "Kelvin"] };
const ls = sharesOf(lentOut);
is(cents(ls.Kalai + ls.Kavya + ls.Kelvin), 10, "still adds up exactly when the payer isn't one of the three");
is(ls.Kalai, 3.34, "the correction falls to the first name in the split when the payer is not in it");
// A three-way shares split with an odd total behaves the same way.
const oddShares = { amount: 10, payer: "Abilash", mode: "shares", between: ["Abilash", "Kalai", "Kavya"],
                     vals: { Abilash: 1, Kalai: 1, Kavya: 1 } };
is(cents(Object.values(sharesOf(oddShares)).reduce((a, v) => a + v, 0)), 10, "an uneven three-way shares split also lands on the cent");

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
