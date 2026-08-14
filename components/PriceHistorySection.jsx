"use client";

import { useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { useProvisionalPrices } from "../hooks/useProvisionalPrices";
import { useDataCoverage } from "../hooks/useDataCoverage";
import { presetRange, customRange, TODAY_NOT_PUBLISHED_MESSAGE, TOMORROW_NOT_PUBLISHED_MESSAGE } from "../lib/priceRange";
import { exportToExcel } from "../lib/exportExcel";
import { dayAheadSeries, latestIntradaySeries, mergeWithProvisional } from "../lib/priceSeries";
import { londonYmd, formatShortDate, formatLongDate } from "../lib/londonTime";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceTable from "./PriceTable";

const SCOPES = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "7day", label: "7 day" },
  { key: "full", label: "All time" },
  { key: "custom", label: "Custom" },
];

// Intraday auctions only ever run same-day — a future date can never have
// intraday data, not "not yet", never. Series keys disabled for the
// "tomorrow" scope specifically, forcing Day ahead as the only
// selectable series there.
const TOMORROW_ONLY_SERIES = "dayAhead";
const TOMORROW_DISABLED_SERIES_TITLE = "Not available for Tomorrow — intraday auctions only ever run on the day itself.";

const VIEWS = [
  { key: "chart", label: "Chart" },
  { key: "table", label: "Table" },
];

const SERIES = [
  { key: "dayAhead", label: "Day ahead" },
  { key: "intraday", label: "Intraday" },
  { key: "both", label: "Both" },
];

/** Rows for a given series selection — same logic the chart itself uses
 * (dayAheadSeries/latestIntradaySeries), so an export filtered to one
 * series matches exactly what that series means on the chart rather than
 * a naive "all rows for that auction" filter. */
function rowsForSeries(rows, seriesFilter) {
  if (seriesFilter === "dayAhead") return dayAheadSeries(rows);
  if (seriesFilter === "intraday") return latestIntradaySeries(rows);
  return rows;
}

/** Short-form date for a label — includes the year only when it isn't
 * the current one, so the common case (this year's data) stays compact
 * without silently becoming ambiguous for an older Custom-range date. */
function labelDate(ymd) {
  const currentYear = londonYmd(new Date()).slice(0, 4);
  return ymd.slice(0, 4) === currentYear ? formatShortDate(ymd) : formatLongDate(ymd);
}

/**
 * The calendar day(s) the day-ahead series in view actually covers, as
 * {startYmd, endYmd} — the fact "Day ahead" alone doesn't state wherever
 * it appears, only implies via whichever scope tab happens to be
 * selected (see the button/chart label below, which spells it out).
 * Derived from the same `range` already driving the fetch, rather than a
 * second, independently-reasoned date calculation — "full" is the one
 * exception, since `range.from` there is a sentinel far in the past, not
 * a real date, so it needs the actual coverage bounds instead (the same
 * earliest/latest the chart's own "All time" caption and the Help page
 * already use, not a separate query for the same fact).
 */
function dayAheadSpan(scope, range, coverageEarliest, coverageLatest) {
  if (scope === "full") {
    if (!coverageEarliest || !coverageLatest) return null;
    return { startYmd: londonYmd(new Date(coverageEarliest)), endYmd: londonYmd(new Date(coverageLatest)) };
  }
  if (!range) return null;
  const startYmd = londonYmd(new Date(range.from));
  // range.to is an exclusive boundary — stepping back a moment lands
  // within the last calendar day actually included, rather than the one
  // just past it. Open-ended ranges (7 day) run through "now" instead.
  const endYmd = range.to ? londonYmd(new Date(new Date(range.to).getTime() - 1)) : londonYmd(new Date());
  return { startYmd, endYmd };
}

/**
 * "Day ahead" alone reads as if it always means "tomorrow's price" — for
 * a specific delivery date (especially Today, often already in effect by
 * the time it's viewed), that's a real contradiction someone would
 * otherwise have to resolve themselves by checking which scope tab is
 * selected. Names the actual date(s) in view instead, in two lengths:
 * `button` for the compact series toggle, `chart` for the fuller legend
 * caption where there's room to spell it out.
 */
function dayAheadLabels(scope, range, coverageEarliest, coverageLatest) {
  const span = dayAheadSpan(scope, range, coverageEarliest, coverageLatest);
  if (!span) return { button: "Day ahead", chart: "Day ahead" };
  const { startYmd, endYmd } = span;
  if (startYmd === endYmd) {
    const d = labelDate(startYmd);
    return { button: `Day ahead · ${d}`, chart: `Day ahead price for ${d}` };
  }
  const from = labelDate(startYmd);
  const to = labelDate(endYmd);
  return { button: `Day ahead · ${from} – ${to}`, chart: `Day ahead price, ${from} – ${to}` };
}

/**
 * Owns the Today/7 day/All time/Custom scope, the chart/table view
 * switch, and the Day ahead/Intraday/Both series toggle — resolves the
 * scope to a single {from, to} range (lib/priceRange.js), fetches it once
 * via useNiPrices, and hands the rows to whichever view is active. The
 * series toggle only affects the chart and the export (same principle as
 * the date scope: the export always matches what's currently shown) —
 * the table is unaffected, it already lists every auction's row
 * regardless of this toggle.
 *
 * provisionalEnabled (from the page-level toggle) drives the chart, the
 * table, and the export alike — all three read from the same
 * `displayRows`, so there's one merge, not three independent ones that
 * could drift. When the toggle's off, provisionalRows is always empty
 * (see useProvisionalPrices), which makes mergeWithProvisional a no-op —
 * displayRows is then identical in content to `rows`, so every surface
 * behaves exactly as it did before this existed, with no separate
 * "toggle off" code path to keep in sync. Not restricted to any
 * particular scope: provisionalRows is fetched for whatever range is
 * active and merges in wherever it actually has something, since how far
 * back provisional data can reach is the backend's call
 * (nothing_left_to_poll), not a boundary re-derived here.
 */
export default function PriceHistorySection({ provisionalEnabled = false }) {
  const [scope, setScope] = useState("today");
  const [view, setView] = useState("chart");
  const [seriesFilter, setSeriesFilter] = useState("both");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (scope === "custom") return customRange(customFrom, customTo);
    return presetRange(scope);
  }, [scope, customFrom, customTo]);

  const { rows, error } = useNiPrices(range);
  const provisionalRows = useProvisionalPrices(provisionalEnabled, range);
  const displayRows = useMemo(() => mergeWithProvisional(rows, provisionalRows), [rows, provisionalRows]);
  const [exporting, setExporting] = useState(false);

  const { earliest: coverageEarliest, latest: coverageLatest } = useDataCoverage();
  const { button: dayAheadButtonLabel, chart: dayAheadChartLabel } = useMemo(
    () => dayAheadLabels(scope, range, coverageEarliest, coverageLatest),
    [scope, range, coverageEarliest, coverageLatest]
  );

  async function handleExport() {
    setExporting(true);
    try {
      const suffix = scope === "custom" ? `${customFrom}-to-${customTo}` : scope;
      await exportToExcel({ rows: rowsForSeries(displayRows, seriesFilter), filenameSuffix: suffix });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>Price history</h2>
        <div className="section-controls">
          <div className="toggle" role="group" aria-label="Chart or table view">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                className={v.key === view ? "active" : undefined}
                aria-pressed={v.key === view}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="toggle" role="group" aria-label="Series">
            {SERIES.map((s) => {
              const disabled = scope === "tomorrow" && s.key !== TOMORROW_ONLY_SERIES;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={s.key === seriesFilter ? "active" : undefined}
                  aria-pressed={s.key === seriesFilter}
                  disabled={disabled}
                  title={disabled ? TOMORROW_DISABLED_SERIES_TITLE : undefined}
                  onClick={() => setSeriesFilter(s.key)}
                >
                  {s.key === "dayAhead" ? dayAheadButtonLabel : s.label}
                </button>
              );
            })}
          </div>
          <div className="toggle" role="group" aria-label="Date range">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === scope ? "active" : undefined}
                aria-pressed={s.key === scope}
                onClick={() => {
                  setScope(s.key);
                  if (s.key === "tomorrow") setSeriesFilter(TOMORROW_ONLY_SERIES);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="export-button"
            onClick={handleExport}
            disabled={exporting || displayRows.length === 0}
          >
            {exporting ? "Exporting…" : "Export .xlsx"}
          </button>
        </div>
      </div>

      {scope === "custom" && (
        <div className="custom-range">
          <label>
            From
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
          {!range && (
            <span className="custom-range-hint">
              {!customFrom || !customTo ? "Pick both dates." : "End date must be after the start date."}
            </span>
          )}
        </div>
      )}

      {error && <p role="alert">Couldn&apos;t load price history: {error}</p>}
      {view === "chart" ? (
        <PriceHistoryChart
          rows={displayRows}
          seriesFilter={seriesFilter}
          dayAheadLabel={dayAheadChartLabel}
          emptyMessage={
            scope === "today"
              ? TODAY_NOT_PUBLISHED_MESSAGE
              : scope === "tomorrow"
                ? TOMORROW_NOT_PUBLISHED_MESSAGE
                : undefined
          }
        />
      ) : (
        <PriceTable rows={rowsForSeries(displayRows, seriesFilter)} />
      )}
    </div>
  );
}
