/* Renders the reminder to reminders/test/preview.html and exercises the
   timezone gate, without touching Firebase or Resend.
   Run with: node test/preview.js */
import { writeFileSync } from "node:fs";
import { groupSummary } from "../lib/ledger.js";
import { reminderEmail } from "../lib/template.js";

/* ---------- the timezone gate, copied from the handler ---------- */
const WINDOW_FROM = 16, WINDOW_TO = 20;
function localNow(tz, at) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "numeric", hour12: false
    }).formatToParts(at);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return { weekday: get("weekday"), hour: parseInt(get("hour"), 10) };
  } catch { return null; }
}
function due(tz, iso) {
  const n = localNow(tz, new Date(iso));
  return !!n && n.weekday === "Sun" && n.hour >= WINDOW_FROM && n.hour <= WINDOW_TO;
}

console.log("timezone gate");
// 2026-09-13 is a Sunday. 21:00 UTC = 17:00 in Toronto while on EDT.
const cases = [
  // the scheduled firing, 21:00 UTC on a Sunday, either side of the clock change
  ["America/Toronto", "2026-09-13T21:00:00Z", true,  "summer: cron lands 17:00 Toronto"],
  ["America/Toronto", "2026-12-13T21:00:00Z", true,  "winter: cron lands 16:00 Toronto, still sends"],
  ["America/Vancouver","2026-09-13T21:00:00Z", false, "Vancouver is only 14:00 then"],
  ["America/Vancouver","2026-09-14T00:00:00Z", true,  "Vancouver at 17:00 on its own Sunday"],
  ["America/Halifax", "2026-09-13T21:00:00Z", true,  "Halifax 18:00, inside the window"],
  ["America/Toronto", "2026-09-13T13:00:00Z", false, "Sunday 09:00 Toronto is too early"],
  ["America/Toronto", "2026-09-13T23:00:00Z", true,  "Sunday 19:00 Toronto is still inside the window"],
  ["America/Toronto", "2026-09-14T01:00:00Z", false, "Sunday 21:00 Toronto is past it"],
  ["America/Toronto", "2026-09-12T21:00:00Z", false, "Saturday never fires"],
  ["Not/AZone",       "2026-09-13T21:00:00Z", false, "unknown timezone never fires"]
];
let bad = 0;
for (const [tz, iso, want, what] of cases) {
  const got = due(tz, iso);
  if (got === want) console.log("  ok   " + what);
  else { bad++; console.log("  FAIL " + what + " expected " + want + " got " + got); }
}

/* ---------- render one ---------- */
const group = {
  meta: { name: "Montreal & Quebec" },
  people: { a: { n: "Abilash", uid: "u1" }, b: { n: "Kalai" }, c: { n: "Kavya" }, d: { n: "Kelvin" } },
  expenses: {
    e1: { desc: "Hotel Montreal", amount: 300, payer: "Kalai", mode: "equal",
          between: ["Abilash", "Kalai", "Kavya", "Kelvin"] },
    e2: { desc: "Dinner at Schwartz", amount: 100, payer: "Abilash", mode: "exact",
          between: ["Abilash", "Kalai", "Kavya", "Kelvin"],
          vals: { Abilash: 40, Kalai: 30, Kavya: 20, Kelvin: 10 } },
    e3: { desc: "Parking Old Quebec", amount: 36, payer: "Kavya", mode: "equal",
          between: ["Abilash", "Kavya"] }
  },
  payments: {}
};
const flat = {
  meta: { name: "Flat 4B" },
  people: { a: { n: "Abilash", uid: "u1" }, b: { n: "Sam" } },
  expenses: { e1: { desc: "Internet", amount: 60, payer: "Abilash", mode: "equal", between: ["Abilash", "Sam"] } },
  payments: {}
};

const gs = [
  groupSummary(group, "Montreal & Quebec", "u1"),
  groupSummary(flat, "Flat 4B", "u1")
];
let owe = 0, owed = 0;
gs.forEach((g) => { if (g.net < 0) owe += -g.net; else owed += g.net; });

const mail = reminderEmail({
  name: "Abilash", owe, owed, groups: gs,
  appUrl: "https://abilash-kjm1.github.io/trip/"
});
writeFileSync(new URL("./preview.html", import.meta.url), mail.html);

console.log("\nrendered");
console.log("  subject: " + mail.subject);
console.log("  owe " + owe.toFixed(2) + " / owed " + owed.toFixed(2));
console.log("  html " + mail.html.length + " bytes -> test/preview.html");
console.log("\n--- plain text ---\n" + mail.text);
process.exit(bad ? 1 : 0);
