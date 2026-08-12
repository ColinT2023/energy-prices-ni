// Settlement periods and "today" boundaries are defined in NI local time
// (Europe/London), which shifts between GMT and BST — not UTC. Getting
// this wrong would put the Ring and the "Today" scope out by an hour for
// half the year. No date library is pulled in for this; Intl's timeZone
// support is enough for the two things actually needed: the current
// London Y-M-D, and the London/UTC offset at a given instant.

const LONDON_TZ = "Europe/London";

function londonYmd(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * The UTC instant corresponding to midnight in Europe/London on the day
 * `date` falls on locally. Works out the current GMT/BST offset by
 * checking what a UTC-midnight guess reads as in London, then correcting
 * for it — rather than hardcoding either offset.
 */
export function londonMidnightUtc(date = new Date()) {
  const ymd = londonYmd(date);
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offsetHours = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: LONDON_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(guess)
  );
  return new Date(guess.getTime() - offsetHours * 60 * 60 * 1000);
}

/** Midnight in Europe/London, `daysAgo` days before `from`'s local day. */
export function londonDayStart(daysAgo, from = new Date()) {
  const start = londonMidnightUtc(from);
  start.setUTCDate(start.getUTCDate() - daysAgo);
  return start;
}

/** "HH:MM" for a Date/ISO-string instant, rendered in Europe/London. */
export function formatLondonTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/**
 * Which of the (usually) 48 half-hourly settlement periods `value` falls
 * in, relative to `dayStartUtc` (from londonMidnightUtc/londonDayStart).
 * DST-transition days have 47 or 49 periods in reality — not specially
 * handled here, they just fall outside the normal 0-47 range.
 */
export function settlementPeriodIndex(value, dayStartUtc) {
  const minutes = Math.floor((new Date(value).getTime() - dayStartUtc.getTime()) / 60000);
  return Math.floor(minutes / 30);
}
