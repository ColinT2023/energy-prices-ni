"use client";

import { useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { useProvisionalPrices } from "../hooks/useProvisionalPrices";
import { useDataCoverage } from "../hooks/useDataCoverage";
import { presetRange, customRange, TODAY_NOT_PUBLISHED_MESSAGE, TOMORROW_NOT_PUBLISHED_MESSAGE } from "../lib/priceRange";
import { exportToExcel } from "../lib/exportExcel";
import { latestIntradaySeries, mergeWithProvisional } from "../lib/priceSeries";
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
// intraday data, not "not yet", never. "Intraday" alone is disabled for
// the "tomorrow" scope specifically, forcing "Both" as the only
// selectable series there — Both still shows a day-ahead-only chart in
// that case (the intraday line just contributes no points, same
// graceful-degradation behaviour Both already has whenever intraday
// simply hasn't published yet for any other reason), so it's the
// closest equivalent to the isolated day-ahead view a future date can
// have, without a third "day ahead only" button.
const TOMORROW_ONLY_SERIES = "both";
const TOMORROW_DISABLED_SERIES_TITLE = "Not available for Tomorrow — intraday auctions only ever run on the day itself.";

const VIEWS = [
  { key: "chart", label: "Chart" },
  { key: "table", label: "Table" },
];

// No standalone "Day ahead" option — Both already carries an unchanged
// day-ahead reference line, so isolating day ahead alone would only
// duplicate what Both already shows whenever intraday hasn't repriced a
// period yet, for one fewer button to scan.
const SERIES = [
  { key: "intraday", label: "Intraday" },
  { key: "both", label: "Both" },
];

/** Rows for a given series selection — same logic the chart itself uses
 * (latestIntradaySeries), so an export filtered to Intraday matches
 * exactly what that series means on the chart rather than a naive "all
 * rows for that auction" filter. */
function rowsForSeries(rows, seriesFilter) {
  if (seriesFilter === "intraday") return latestIntradaySeries(rows);
  return rows;
}

/**
 * The calendar day(s) the currently selected date scope covers, as
 * {startYmd, endYmd} — independent of which auction type (series) is
 * selected, since date range and auction type are separate choices; this
 * feeds the shared "Viewing: ..." indicator, not any one series button.
 * Derived from the same `range` already driving the fetch, rather than a
 * second, independently-reasoned date calculation — "full" is the one
 * exception, since `range.from` there is a sentinel far in the past, not
 * a real date, so it needs the actual coverage bounds instead (the same
 * earliest/latest the chart's own "All time" caption and the Help page
 * already use, not a separate query for the same fact).
 */
function scopeSpan(scope, range, coverageEarliest, coverageLatest) {
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
 * "Viewing: 14 Aug 2026 (Today)" — a single readout of the active date
 * scope, shown once above the whole control area rather than attached to
 * any one series button. Only reacts to scope/range, never to
 * seriesFilter, so it stays visibly true that date and auction type are
 * two independent choices rather than one implying the other. A single
 * day always carries its year (reads as a complete date on its own); a
 * range only adds the year where the two ends actually differ (e.g. an
 * "All time" span crossing a year boundary) rather than on every date.
 */
function viewingLabel(scope, range, coverageEarliest, coverageLatest, scopeLabel) {
  const span = scopeSpan(scope, range, coverageEarliest, coverageLatest);
  if (!span) return null;
  const { startYmd, endYmd } = span;
  if (startYmd === endYmd) {
    return `Viewing: ${formatLongDate(startYmd)} (${scopeLabel})`;
  }
  const yearsDiffer = startYmd.slice(0, 4) !== endYmd.slice(0, 4);
  const from = yearsDiffer ? formatLongDate(startYmd) : formatShortDate(startYmd);
  const to = yearsDiffer ? formatLongDate(endYmd) : formatShortDate(endYmd);
  return `Viewing: ${from} – ${to} (${scopeLabel})`;
}

/**
 * Owns the Today/7 day/All time/Custom scope, the chart/table view
 * switch, and the Intraday/Both series toggle — resolves the scope to a
 * single {from, to} range (lib/priceRange.js), fetches it once via
 * useNiPrices, and hands the rows to whichever view is active. The
 * series toggle applies identically to the chart, the table, and the
 * export — all three derive from the same rowsForSeries(displayRows,
 * seriesFilter) call (the chart via its own seriesFilter prop, table and
 * export via the shared helper below), so switching series can't leave
 * one surface out of sync with what the others show.
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
  const scopeLabel = SCOPES.find((s) => s.key === scope)?.label ?? scope;
  const viewingText = useMemo(
    () => viewingLabel(scope, range, coverageEarliest, coverageLatest, scopeLabel),
    [scope, range, coverageEarliest, coverageLatest, scopeLabel]
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
        {viewingText && <p className="viewing-indicator">{viewingText}</p>}
      </div>

      <p className="controls-explainer">
        Date range and auction type are independent choices below — changing one never changes the other.
      </p>

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
        <div className="control-group">
          <span className="control-group-label">Auction type</span>
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
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="control-group">
          <span className="control-group-label">Date range</span>
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
