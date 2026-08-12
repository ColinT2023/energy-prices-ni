// Settlement periods and "today" boundaries are defined in NI local time
// (Europe/London), which shifts between GMT and BST — not UTC. Getting
// this wrong would put the Ring and the "Today" scope out by an hour for
// half the year. No date library is pulled in for this; Intl's timeZone
// support is enough for the two things actually needed: the current
// London Y-M-D, and the London/UTC offset at a given instant.

const LONDON_TZ = "Europe/London";

/** "2026-08-12"-style Europe/London calendar date for `date`. */
export function londonYmd(date) {
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

/**
 * Midnight in Europe/London, `daysAgo` days before `from`'s local day.
 * Steps back one real day at a time (subtracting a fixed 23h, then
 * re-anchoring to that instant's actual local midnight) rather than
 * shifting the UTC calendar date field directly — a plain `setUTCDate`
 * shift is wrong whenever a clock change falls inside the range, since
 * London days aren't all 24 UTC-hours long. 23h always lands within the
 * previous London day regardless of its length (23h/24h/25h), so
 * re-anchoring from there is safe.
 */
export function londonDayStart(daysAgo, from = new Date()) {
  let cursor = londonMidnightUtc(from);
  for (let i = 0; i < daysAgo; i++) {
    cursor = londonMidnightUtc(new Date(cursor.getTime() - 23 * 60 * 60 * 1000));
  }
  return cursor;
}

/**
 * How many half-hourly settlement periods `date`'s London calendar day
 * actually contains: 48 on a normal day, 46 on the spring-forward day
 * (01:00-02:00 skipped), 50 on the clocks-back day (01:00-02:00 repeats).
 * Derived from real elapsed time between this local midnight and the
 * next, rather than a calendar rule, so it's correct without needing to
 * know the transition dates.
 */
export function periodsInLondonDay(date = new Date()) {
  const start = londonMidnightUtc(date);
  // +25h always lands within the *next* London day, even when today
  // itself is the 25-hour clocks-back day.
  const next = londonMidnightUtc(new Date(start.getTime() + 25 * 60 * 60 * 1000));
  return Math.round((next.getTime() - start.getTime()) / (30 * 60000));
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

/** "12 Aug 13:00" for a Date/ISO-string instant, rendered in Europe/London. */
export function formatLondonDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/** "12 Aug 2026, 14:32" for a Date/ISO-string instant, rendered in Europe/London. */
export function formatLondonFullDateTime(value) {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
  return `${date}, ${formatLondonTime(value)}`;
}

/**
 * `ymd` shifted by `days` whole calendar days, e.g.
 * shiftYmd("2026-08-12", -1) -> "2026-08-11". `new Date(ymd)` parses a
 * bare date string as UTC midnight, which always falls on the same
 * London calendar day (London is never behind UTC) — so shifting the UTC
 * date field and re-reading it back through londonYmd is safe here,
 * without needing londonDayStart's DST re-anchoring (that's for finding
 * an exact *instant*; this is just calendar-date label arithmetic).
 */
export function shiftYmd(ymd, days) {
  const d = new Date(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return londonYmd(d);
}

/** "12 Aug 2026" for a "YYYY-MM-DD" string, rendered in Europe/London. */
export function formatLongDate(ymd) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ymd));
}

/**
 * Which half-hourly settlement period `value` falls in, relative to
 * `dayStartUtc` (from londonMidnightUtc/londonDayStart) — 0-47 on a
 * normal day, 0-45 on the spring-forward day, 0-49 on the clocks-back
 * day. This is pure elapsed-time arithmetic (no assumption about how
 * many periods the day has), so it's correct on all three without change
 * — see periodsInLondonDay for the day's actual period count.
 */
export function settlementPeriodIndex(value, dayStartUtc) {
  const minutes = Math.floor((new Date(value).getTime() - dayStartUtc.getTime()) / 60000);
  return Math.floor(minutes / 30);
}
