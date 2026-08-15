import { londonMidnightUtc, londonDayStart, londonYmd, shiftYmd } from "./londonTime";

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
 * The one real-data-backed claim about SEM-DA's typical publish time —
 * quoted by notPublishedMessage below (folded into its longer sentence)
 * and by TOMORROW_TABLE_FOOTNOTE below (the table's own footnote for
 * when tomorrow's data is already showing), rather than each spot
 * hardcoding its own copy of the same fact and risking the two drifting
 * apart. See lib/priceSeries.js's AUCTION_EXPLANATION for the fuller
 * version of the same fact aimed at the Help page/export audience.
 *
 * "Usually" + "around midday" are deliberate hedges, not a promise —
 * real published-time data across 227 SEM-DA reports (every day since
 * 31 Dec 2025, weekends and bank holidays included, no gaps) has a
 * median of 11:55am UK time with p95 still only 12:01pm, but a real
 * (rare) tail out to 1:30pm, so a bare "by midday" would occasionally be
 * wrong.
 */
const TYPICAL_PUBLISH_TIME = "around midday";

/**
 * Shown wherever a day's periods haven't been published yet — normal for
 * part of the day, since day-ahead publishes around midday the day
 * before delivery, not at midnight. `dayLabel` reads naturally in front
 * of "day ahead prices haven't been published yet" (e.g. "Today's",
 * "Tomorrow's"). Shared between the Ring, the "today" scope, and the
 * "tomorrow" scope so the wording (and the "this isn't an error"
 * framing) stays consistent across all of them rather than three
 * independently-written copies — this is also what surfaces the
 * "usually by around midday" timing next to the Tomorrow series
 * specifically, via TOMORROW_NOT_PUBLISHED_MESSAGE below, rather than a
 * separate purpose-built note.
 */
export function notPublishedMessage(dayLabel) {
  return `${dayLabel} day ahead prices haven't been published yet. SEMOpx usually publishes them by ${TYPICAL_PUBLISH_TIME} the day before, this will update automatically once ingestion picks up the new report.`;
}

export const TODAY_NOT_PUBLISHED_MESSAGE = notPublishedMessage("Today's");
export const TOMORROW_NOT_PUBLISHED_MESSAGE = notPublishedMessage("Tomorrow's");

/**
 * Footnote shown above the table whenever its currently displayed rows
 * genuinely include tomorrow's date (see rowsIncludeTomorrow below) —
 * unlike TOMORROW_NOT_PUBLISHED_MESSAGE above, which fires in the
 * opposite case (tomorrow's data asked for but not there yet), this
 * fires once it *is* showing, as a quick "here's why this date is
 * already populated" orientation note rather than a repeat of the fuller
 * explanation the Help page carries.
 */
export const TOMORROW_TABLE_FOOTNOTE = `Tomorrow's prices are usually published by ${TYPICAL_PUBLISH_TIME}.`;

/**
 * Whether `rows` (the table's actual currently-displayed rows, already
 * scoped/filtered/sorted) contain at least one settlement period dated
 * tomorrow (Europe/London calendar day) — checked against the real rows
 * rather than inferred from which scope button is active, since 7 day
 * and All time are open-ended (`to: null`, see presetRange below) and
 * silently pick up tomorrow's day-ahead rows the moment they're
 * published, exactly like Custom does when its range reaches that far.
 * "Tomorrow data is showing" is genuinely not a Custom-only or
 * Tomorrow-series-only case.
 */
export function rowsIncludeTomorrow(rows) {
  const tomorrowYmd = shiftYmd(londonYmd(new Date()), 1);
  return rows.some((row) => londonYmd(new Date(row.datetime)) === tomorrowYmd);
}

/**
 * {from, to} for a preset scope key.
 *
 * "today" is bound to exactly that one London calendar day — expressed
 * as dayRange(ymd) rather than hand-rolling a forward step, since
 * dayRange/customRange already handle the DST-safe "next local midnight"
 * arithmetic correctly (see customRange's own comment) and this reuses
 * that instead of a second, independently-reasoned-about implementation.
 * Without this bound, "today" previously had `to: null` (open-ended) and
 * would silently pick up tomorrow's rows the moment they existed (e.g.
 * day-ahead auctioned around midday today, or via the provisional feed)
 * — confirmed live before this fix landed.
 *
 * "7 day"/"full" stay open-ended (`to: null`) — genuinely meant to run
 * through whatever's latest, not a fixed end date.
 *
 * There's no "tomorrow" scope key here — see tomorrowRange() below,
 * which the price history chart calls directly for its own Tomorrow/Both
 * chart series rather than this going through a date-range preset.
 */
export function presetRange(scope) {
  if (scope === "today") return dayRange(londonYmd(new Date()));
  const days = PRESET_DAYS[scope];
  const from = days ? londonDayStart(days - 1).toISOString() : ALL_TIME_SENTINEL_START;
  return { from, to: null };
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
