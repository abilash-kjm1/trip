/* The schedule: validation, the window, and the double-send guard. */
import { normalise, isDue, guardMs, describe, DEFAULTS } from "../lib/schedule.js";
let bad=0;
const is=(a,e,w)=>{ if(JSON.stringify(a)===JSON.stringify(e)) console.log("  ok   "+w);
  else { bad++; console.log("  FAIL "+w+"  expected "+JSON.stringify(e)+" got "+JSON.stringify(a)); } };

console.log("rubbish in the database falls back rather than misfiring");
is(normalise(null).days, [0], "missing config -> Sunday");
is(normalise({days:"everyday"}).days, [0], "days not an array");
is(normalise({days:[9,-2,"x"]}).days, [0], "no valid day survives");
is(normalise({days:[3,3,1]}).days, [1,3], "deduped and sorted");
is(normalise({hour:99}).hour, 16, "hour out of range");
is(normalise({hour:0}).hour, 0, "midnight is a legitimate hour");
is(normalise({windowHours:0}).windowHours, 5, "window too small");
is(normalise({windowHours:99}).windowHours, 5, "window too big");
is(normalise({enabled:false}).enabled, false, "can be switched off");
is(normalise({}).enabled, true, "on unless told otherwise");

console.log("\nthe window, in the reader's own timezone");
const cfg = normalise({days:[0], hour:16, windowHours:5});   // the shipped default
const T="America/Toronto";
const at = (iso)=>new Date(iso);
is(isDue(cfg,T,{},at("2026-09-13T21:00:00Z")).due, true,  "Sunday 17:00 EDT");
is(isDue(cfg,T,{},at("2026-12-13T21:00:00Z")).due, true,  "and the same firing in winter, 16:00 EST");
is(isDue(cfg,T,{},at("2026-09-13T19:00:00Z")).due, false, "Sunday 15:00 EDT is before the window");
is(isDue(cfg,T,{},at("2026-09-14T00:00:00Z")).due, true,  "Sunday 20:00 EDT is the last hour in");
is(isDue(cfg,T,{},at("2026-09-14T01:00:00Z")).due, false, "Sunday 21:00 EDT is out");
is(isDue(cfg,T,{},at("2026-09-12T21:00:00Z")).due, false, "Saturday");

console.log("\na weekday schedule");
const wed = normalise({days:[3], hour:9, windowHours:2});
is(isDue(wed,T,{},at("2026-09-16T13:00:00Z")).due, true,  "Wednesday 09:00 Toronto");
is(isDue(wed,T,{},at("2026-09-16T16:00:00Z")).due, false, "Wednesday 12:00 is past the 2h window");

console.log("\nnot sending twice");
const twice = normalise({days:[0,3], hour:16, windowHours:5});
const sunday = at("2026-09-13T21:00:00Z");
is(isDue(twice,T,{lastWeekly: sunday.getTime()-3600e3}, sunday).due, false, "an hour after a send, no");
is(isDue(twice,T,{lastWeekly: sunday.getTime()-4*24*3600e3}, sunday).due, true, "the other day of the week, yes");
is(guardMs(normalise({days:[0]})) > 5*24*3600e3, true, "one day a week guards nearly a week");
is(guardMs(twice) < 4*24*3600e3, true, "two days a week guards less than the gap");

console.log("\noff means off");
is(isDue(normalise({enabled:false}),T,{},at("2026-09-13T21:00:00Z")).due, false, "switched off");

console.log("\ndescribed for the admin screen");
is(describe(normalise({days:[0],hour:16,windowHours:5})), "Sun between 16:00 and 21:00, each person's own time", "reads plainly");

console.log(bad? "\n"+bad+" FAILED" : "\nall passed");
process.exit(bad?1:0);
