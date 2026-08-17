import { londonMidnightUtc, londonYmd, shiftYmd } from "./londonTime";
import { TYPICAL_PUBLISH_TIME } from "./priceSeries";

// "All time" needs a lower bound to send as .gte('datetime', ...), but it
// must not be a specific assumed start date — that was the bug here
// (hardcoded to "2026-01-01", silently wrong the moment real data existed
// before that, or once it's no longer actually the current season).
// A sentinel far enough in the past that no real ni_prices row could ever
// predate it gets the exact same result as looking up MIN(datetime) —
// Postgres returns the same matching rows either way — without an extra
// round trip before the range is known. SEM itself didn't exist before
// 2007, so this has a lot of margin.
const ALL_TIME_SENTINEL_START = "2000-01-01T00:00:00Z";
const PRESET_DAYS = { "7day": 7 };

/**
 * Shown wherever a day's periods haven't been published yet — normal for
 * part of the day, since day-ahead publishes between 12 and 1pm the day
 * before delivery, not at midnight. `dayLabel` reads naturally in front
 * of "day ahead prices haven't been published yet" (e.g. "Today's",
 * "Tomorrow's"). Shared between the Ring, the "today" scope, and the
 * "tomorrow" scope so the wording (and the "this isn't an error"
 * framing) stays consistent across all of them rather than three
 * independently-written copies — this is also what surfaces the
 * TYPICAL_PUBLISH_TIME window next to the Tomorrow series specifically,
 * via TOMORROW_NOT_PUBLISHED_MESSAGE below, rather than a separate
 * purpose-built note.
 */
export function notPublishedMessage(dayLabel) {
  return `${dayLabel} day ahead prices haven't been published yet. SEMOpx usually publishes them ${TYPICAL_PUBLISH_TIME} the day before, this will update automatically once ingestion picks up the new report.`;
}

export const TODAY_NOT_PUBLISHED_MESSAGE = notPublishedMessage("Today's");
export const TOMORROW_NOT_PUBLISHED_MESSAGE = notPublishedMessage("Tomorrow's");

/**
 * Permanent, always-visible caption shown above the table whenever it's
 * the active view — regardless of scope, and regardless of whether
 * tomorrow's date happens to be present in the currently displayed rows.
 * Replaces an earlier version that only appeared conditionally (gated on
 * a rowsIncludeTomorrow check, paired with an asterisk on the Viewing
 * indicator): the underlying fact — that tomorrow's day ahead price
 * usually lands between 12 and 1pm — is just as true, and just as worth
 * surfacing, on a day tomorrow's data doesn't happen to be loaded yet,
 * so gating it added complexity without adding accuracy.
 */
export const TOMORROW_TABLE_CAPTION = `Tomorrow's day ahead prices are usually published ${TYPICAL_PUBLISH_TIME}.`;

/**
 * {from, to} for a preset scope key.
 *
 * "today" and "7 day" are both bounded lookback windows ending at
 * today's own close, expressed via customRange/dayRange rather than
 * hand-rolling a forward step, since those already handle the DST-safe
 * "next local midnight" arithmetic correctly (see customRange's own
 * comment) and this reuses that instead of a second, independently-
 * reasoned-about implementation. Without this bound, "today" previously
 * had `to: null` (open-ended) and would silently pick up tomorrow's
 * rows the moment they existed (e.g. day-ahead auctioned between 12 and
 * 1pm today, or via the provisional feed) — confirmed live before that
 * fix landed. "7 day" had the exact same latent gap — same open-ended
 * `to: null`, same silent leak into tomorrow once its day-ahead
 * publishes — it just took longer to actually surface (needed
 * provisional's forward reach into tomorrow to push the merged span
 * past the aggregation threshold before anyone would notice) rather
 * than being any less real. Both now stop at the same boundary: today's
 * own close, never into tomorrow.
 *
 * "full" stays open-ended (`to: null`) — genuinely meant to run through
 * whatever's latest, not a fixed end date. This is the one preset scope
 * that isn't a bounded lookback window by design, so it's the one place
 * `to: null` is still correct rather than a gap.
 *
 * There's no "tomorrow" scope key here — see tomorrowRange() below,
 * which the price history chart calls directly for its own Tomorrow/Both
 * chart series rather than this going through a date-range preset.
 */
export function presetRange(scope) {
  const todayYmd = londonYmd(new Date());
  if (scope === "today") return dayRange(todayYmd);
  const days = PRESET_DAYS[scope];
  if (days) return customRange(shiftYmd(todayYmd, -(days - 1)), todayYmd);
  return { from: ALL_TIME_SENTINEL_START, to: null };
}

/**
 * {from, to} covering exactly tomorrow's London calendar day. Not a
 * "date range" scope — there's no dedicated Tomorrow button in that
 * group any more — this is fetched directly by the price history
 * chart's own Tomorrow/Both series options, which only ever apply
 * alongside the "today" date range, layering tomorrow's day-ahead price
 * on top of it rather than replacing it.
 */
export function tomorrowRange() {
  return dayRange(shiftYmd(londonYmd(new Date()), 1));
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
