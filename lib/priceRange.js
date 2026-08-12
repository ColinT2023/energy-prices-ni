import { londonMidnightUtc, londonDayStart } from "./londonTime";

const FULL_SEASON_START = "2026-01-01T00:00:00Z";
const PRESET_DAYS = { today: 1, "7day": 7 };

/**
 * Shown wherever "today" has zero rows at all — normal for part of the
 * day, since day-ahead publishes the afternoon before delivery, not at
 * midnight. Shared between the Ring and the chart so the wording (and the
 * "this isn't an error" framing) stays consistent between them.
 */
export const TODAY_NOT_PUBLISHED_MESSAGE =
  "Today's day ahead prices haven't been published yet. SEMOpx publishes them in the afternoon the day before, this will update automatically once ingestion picks up the new report.";

/**
 * {from, to} for a preset scope key. `to` is always null — "today"/"7 day"/
 * "full" are all open-ended windows running through whatever's latest,
 * not a fixed end date, so there's nothing to bound them with.
 */
export function presetRange(scope) {
  const days = PRESET_DAYS[scope];
  const from = days ? londonDayStart(days - 1).toISOString() : FULL_SEASON_START;
  return { from, to: null };
}

/**
 * {from, to} for a custom range picker's from/to values (plain
 * "YYYY-MM-DD" strings from <input type="date">, read as Europe/London
 * calendar days). `to` is inclusive of the whole day picked, converted
 * here to an exclusive next-day boundary for the query. Returns null if
 * either date is missing or the range is backwards/empty — callers use
 * that to mean "not ready to fetch yet" rather than falling back to
 * fetching everything.
 */
export function customRange(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const from = londonMidnightUtc(new Date(fromDateStr));
  // +24h always lands within the *next* London day (see periodsInLondonDay
  // for why 24h/25h is the safe margin), giving that day's own midnight
  // as an exclusive upper bound.
  const toExclusive = londonMidnightUtc(new Date(new Date(toDateStr).getTime() + 24 * 60 * 60 * 1000));
  if (toExclusive.getTime() <= from.getTime()) return null;
  return { from: from.toISOString(), to: toExclusive.toISOString() };
}

/** {from, to} covering exactly one "YYYY-MM-DD" day — a single-day customRange. */
export function dayRange(ymd) {
  return customRange(ymd, ymd);
}
