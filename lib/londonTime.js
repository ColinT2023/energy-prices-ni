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

/** "12 Aug" for a "YYYY-MM-DD" string, no year — for compact labels where
 * the year only needs to appear when it isn't the current one. */
export function formatShortDate(ymd) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "numeric",
    month: "short",
  }).format(new Date(ymd));
}

/** Minutes elapsed since `value`'s own Europe/London calendar-day
 * midnight (0 at 00:00, up to ~1470 on the 25-hour clocks-back day) — a
 * "time of day" coordinate independent of which calendar date `value`
 * falls on, so two different days' data can be plotted against one
 * shared time-of-day x-axis for direct comparison (e.g. today's actual
 * prices vs tomorrow's day-ahead prices, hour by hour). */
export function minutesSinceLondonMidnight(value) {
  const date = new Date(value);
  return (date.getTime() - londonMidnightUtc(date).getTime()) / 60000;
}

/** Inclusive count of London calendar days between two datetimes (both
 * endpoints counted, so "1 Jan - 14 Aug" reads as covering both named
 * days) — via the whole-day difference between their local midnights,
 * not a raw ms/86400000 division, so a DST transition anywhere in the
 * range doesn't shift the count by an hour's worth. Shared by the
 * chart's "All time" caption and the Help page's coverage note so both
 * derive the same day count from the same two datetimes, not two
 * independently-written calculations of the same fact. */
export function daySpanCount(earliestIso, latestIso) {
  const start = londonMidnightUtc(new Date(earliestIso)).getTime();
  const end = londonMidnightUtc(new Date(latestIso)).getTime();
  return Math.round((end - start) / 86400000) + 1;
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
