/* ===========================================================================
   The split maths, server side.

   This is a deliberate, line-for-line port of the client's arithmetic. If the
   two ever disagree, somebody gets an email that contradicts what the app is
   showing them, which is worse than sending nothing. test/ledger.test.js
   pins the behaviour.
   =========================================================================== */

/** Round to cents the way the client does. */
export const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function money(n) {
  const v = cents(n);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
}

/** {name: amountOwed} for one expense. Modes: equal | exact | percent | shares */
export function sharesOf(e) {
  const out = {};
  if (!e || typeof e !== "object") return out;
  const between = Array.isArray(e.between) && e.between.length ? e.between : [e.payer];
  const vals = (e.vals && typeof e.vals === "object") ? e.vals : {};
  const amt = Number(e.amount) || 0;

  if (e.mode === "exact") {
    between.forEach((n) => { out[n] = Number(vals[n]) || 0; });
  } else if (e.mode === "percent") {
    between.forEach((n) => { out[n] = amt * ((Number(vals[n]) || 0) / 100); });
  } else if (e.mode === "shares") {
    const tot = between.reduce((a, n) => a + (Number(vals[n]) || 0), 0) || 1;
    between.forEach((n) => { out[n] = amt * ((Number(vals[n]) || 0) / tot); });
  } else {
    const per = between.length ? amt / between.length : 0;
    between.forEach((n) => { out[n] = per; });
  }
  return out;
}

/** Everyone named anywhere in the group, members list or not. */
export function peopleIn(group) {
  const out = [];
  const add = (n) => { if (n && out.indexOf(n) < 0) out.push(n); };
  Object.values(group.people || {}).forEach((p) => {
    add(p && typeof p === "object" ? p.n : String(p));
  });
  Object.values(group.expenses || {}).forEach((e) => {
    add(e.payer);
    (Array.isArray(e.between) ? e.between : []).forEach(add);
  });
  Object.values(group.payments || {}).forEach((p) => { add(p.from); add(p.to); });
  return out;
}

/** Net per person. Positive = they are owed, negative = they owe. */
export function balances(group) {
  const b = {};
  peopleIn(group).forEach((n) => { b[n] = 0; });

  Object.values(group.expenses || {}).forEach((e) => {
    if (!e || typeof e !== "object") return;
    if (!(e.payer in b)) b[e.payer] = 0;
    b[e.payer] += Number(e.amount) || 0;
    const sh = sharesOf(e);
    Object.keys(sh).forEach((n) => {
      if (!(n in b)) b[n] = 0;
      b[n] -= sh[n];
    });
  });

  Object.values(group.payments || {}).forEach((p) => {
    if (!p || typeof p !== "object") return;
    const amt = Number(p.amount) || 0;
    if (!(p.from in b)) b[p.from] = 0;
    if (!(p.to in b)) b[p.to] = 0;
    b[p.from] += amt;   // paying down what you owe
    b[p.to] -= amt;
  });

  Object.keys(b).forEach((n) => { b[n] = cents(b[n]); });
  return b;
}

/** Fewest transfers that clear everyone. */
export function settlements(group) {
  const b = balances(group);
  const cred = [], deb = [];
  Object.keys(b).forEach((n) => {
    const v = b[n];
    if (v > 0.004) cred.push({ n, v });
    else if (v < -0.004) deb.push({ n, v: -v });
  });
  cred.sort((a, c) => c.v - a.v);
  deb.sort((a, c) => c.v - a.v);

  const out = [];
  let i = 0, j = 0, guard = 0;
  while (i < deb.length && j < cred.length && guard++ < 9999) {
    const pay = Math.min(deb[i].v, cred[j].v);
    if (pay > 0.004) out.push({ from: deb[i].n, to: cred[j].n, amt: cents(pay) });
    deb[i].v -= pay; cred[j].v -= pay;
    if (deb[i].v <= 0.004) i++;
    if (cred[j].v <= 0.004) j++;
  }
  return out;
}

/** Which person in this group is the given account? Null if they never claimed one. */
export function personFor(group, uid) {
  const people = group.people || {};
  for (const k of Object.keys(people)) {
    const p = people[k];
    if (p && typeof p === "object" && p.uid === uid) return p.n || null;
  }
  return null;
}

/**
 * What one account should be told about one group.
 * Returns null when the group has nothing outstanding for them.
 */
export function groupSummary(group, groupName, uid) {
  const me = personFor(group, uid);
  if (!me) return null;

  const net = balances(group)[me];
  if (net === undefined) return null;

  const owes = [];   // lines where I carry a share of what somebody else paid
  const lent = [];   // lines I paid that other people carry a share of

  Object.values(group.expenses || {}).forEach((e) => {
    if (!e || typeof e !== "object") return;
    const sh = sharesOf(e);
    const mine = cents(sh[me] || 0);
    const amount = cents(e.amount);
    if (e.payer === me) {
      const others = cents(amount - mine);
      if (others > 0.004) {
        lent.push({ desc: String(e.desc || "Expense"), amount, share: mine, out: others, group: groupName });
      }
    } else if (mine > 0.004) {
      owes.push({ desc: String(e.desc || "Expense"), amount, share: mine, payer: String(e.payer || ""), group: groupName });
    }
  });

  const plan = settlements(group).filter((t) => t.from === me || t.to === me);

  return {
    group: groupName,
    me,
    net: cents(net),
    owes: owes.sort((a, b) => b.share - a.share),
    lent: lent.sort((a, b) => b.out - a.out),
    plan
  };
}
