/* ---------------------------------------------------------------------------
   When reminders go out.

   The schedule lives in the database at config/reminders so the administrator
   can change it from the app without a redeploy. Anything missing or nonsense
   falls back to the old behaviour - Sunday, late afternoon - rather than
   failing or, worse, mailing everybody at a random hour.
   --------------------------------------------------------------------------- */

export const DEFAULTS = {
  enabled: true,
  days: [0],        // 0 = Sunday ... 6 = Saturday
  hour: 16,         // 24h, local to each person
  windowHours: 5    // how long after `hour` a firing still counts
};
/* The default starts an hour before the intended 17:00 and runs five hours,
   because the Vercel schedule is fixed in UTC while Toronto is not: the same
   firing is 17:00 in summer and 16:00 in winter. A window that began exactly
   at 17:00 would go quiet every November.

   That tolerance is only needed because the cron fires once a day. Running it
   hourly - see the README - makes a narrow window land accurately, and then a
   chosen hour means what it says. */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Take whatever is in the database and return something safe to act on. */
export function normalise(raw) {
  const c = (raw && typeof raw === "object") ? raw : {};

  let days = Array.isArray(c.days)
    ? c.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  days = [...new Set(days)].sort((a, b) => a - b);
  if (!days.length) days = DEFAULTS.days;

  let hour = Number(c.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = DEFAULTS.hour;

  let windowHours = Number(c.windowHours);
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 12) {
    windowHours = DEFAULTS.windowHours;
  }

  return {
    enabled: c.enabled !== false,
    days,
    hour,
    windowHours,
    updatedAt: Number(c.updatedAt) || 0,
    updatedBy: typeof c.updatedBy === "string" ? c.updatedBy : ""
  };
}

/** Weekday index and hour as they read on a wall clock in `tz`. */
export function localNow(tz, at) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "numeric", hour12: false
    }).formatToParts(at);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const day = DAY_NAMES.indexOf(get("weekday"));
    const hour = parseInt(get("hour"), 10);
    if (day < 0 || Number.isNaN(hour)) return null;
    return { day, hour };
  } catch {
    return null;                      // unknown timezone
  }
}

export const isValidTz = (tz) => !!localNow(tz, new Date());

/**
 * The shortest gap between two chosen send days, in hours, minus a margin.
 * With one day a week that is nearly a week; with several it must be short
 * enough to let the next one through but long enough to stop a double send
 * inside a single window.
 */
export function guardMs(cfg) {
  const d = cfg.days;
  if (d.length <= 1) return 6 * 24 * 3600 * 1000;
  let smallest = 7;
  for (let i = 0; i < d.length; i++) {
    const next = d[(i + 1) % d.length];
    const gap = ((next - d[i]) + 7) % 7 || 7;
    if (gap < smallest) smallest = gap;
  }
  // Most of the smallest gap, so the following send is never blocked.
  return Math.max(20, smallest * 24 - 6) * 3600 * 1000;
}

/** Is this account due a reminder at this instant? */
export function isDue(cfg, tz, prefs, at) {
  if (!cfg.enabled) return { due: false, why: "schedule is switched off" };

  const now = localNow(tz, at);
  if (!now) return { due: false, why: "timezone not recognised" };

  if (cfg.days.indexOf(now.day) < 0) {
    return { due: false, why: "not a send day on their clock (" + DAY_NAMES[now.day] + ")" };
  }
  if (now.hour < cfg.hour || now.hour >= cfg.hour + cfg.windowHours) {
    return { due: false, why: "outside the send window on their clock (" + now.hour + ":00)" };
  }

  const last = Number(prefs && prefs.lastWeekly) || 0;
  if (last && at.getTime() - last < guardMs(cfg)) {
    return { due: false, why: "already sent within this cycle" };
  }
  return { due: true, why: "due" };
}

export function describe(cfg) {
  const days = cfg.days.map((d) => DAY_NAMES[d]).join(", ");
  const to = (cfg.hour + cfg.windowHours) % 24;
  return (cfg.enabled ? "" : "OFF - ") +
    days + " between " + cfg.hour + ":00 and " + to + ":00, each person's own time";
}
