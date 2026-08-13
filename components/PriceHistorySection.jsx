"use client";

import { useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { useProvisionalPrices } from "../hooks/useProvisionalPrices";
import { presetRange, customRange, TODAY_NOT_PUBLISHED_MESSAGE } from "../lib/priceRange";
import { exportToExcel } from "../lib/exportExcel";
import { dayAheadSeries, latestIntradaySeries, mergeWithProvisional } from "../lib/priceSeries";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceTable from "./PriceTable";

const SCOPES = [
  { key: "today", label: "Today" },
  { key: "7day", label: "7 day" },
  { key: "full", label: "All time" },
  { key: "custom", label: "Custom" },
];

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
            {SERIES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === seriesFilter ? "active" : undefined}
                aria-pressed={s.key === seriesFilter}
                onClick={() => setSeriesFilter(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="toggle" role="group" aria-label="Date range">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === scope ? "active" : undefined}
                aria-pressed={s.key === scope}
                onClick={() => setScope(s.key)}
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
          emptyMessage={scope === "today" ? TODAY_NOT_PUBLISHED_MESSAGE : undefined}
        />
      ) : (
        <PriceTable rows={rowsForSeries(displayRows, seriesFilter)} />
      )}
    </div>
  );
}
