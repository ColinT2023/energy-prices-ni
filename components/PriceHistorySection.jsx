"use client";

import { useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { useProvisionalPrices } from "../hooks/useProvisionalPrices";
import { useDataCoverage } from "../hooks/useDataCoverage";
import { presetRange, customRange, tomorrowRange, TODAY_NOT_PUBLISHED_MESSAGE } from "../lib/priceRange";
import { exportToExcel } from "../lib/exportExcel";
import { mergeWithProvisional } from "../lib/priceSeries";
import { londonYmd, formatShortDate, formatLongDate } from "../lib/londonTime";
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

// Chart-only — Table and the Excel export always show every auction's
// row for whatever date range is active, unfiltered (see displayRows
// below), since "overlay two series" is a chart-specific visual idea
// that doesn't translate to a flat row of data. Tomorrow/Both only mean
// anything alongside "today": they compare today's actual prices against
// tomorrow's day-ahead price specifically, not some other range's.
const CHART_SERIES = [
  { key: "intraday", label: "Intraday" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "both", label: "Both" },
];
const CHART_SERIES_DISABLED_TITLE =
  "Only available while viewing Today — Tomorrow and Both compare against tomorrow's date specifically.";

/**
 * The calendar day(s) the currently selected date scope covers, as
 * {startYmd, endYmd} — independent of chart series, since date range and
 * chart series are separate choices (even though chart series is itself
 * now constrained by date range — see CHART_SERIES above); this feeds
 * the shared "Viewing: ..." indicator, not any one button. Derived from
 * the same `range` already driving the fetch, rather than a second,
 * independently-reasoned date calculation — "full" is the one exception,
 * since `range.from` there is a sentinel far in the past, not a real
 * date, so it needs the actual coverage bounds instead (the same
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
 * any one button. Only reacts to scope/range, never to chart series. A
 * single day always carries its year (reads as a complete date on its
 * own); a range only adds the year where the two ends actually differ
 * (e.g. an "All time" span crossing a year boundary) rather than on
 * every date.
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
 * Owns the Today/7 day/All time/Custom date range, the chart/table view
 * switch, and the chart-only Intraday/Tomorrow/Both series — resolves
 * the date range to a single {from, to} (lib/priceRange.js), fetches it
 * once via useNiPrices, and hands displayRows to whichever view is
 * active. Table and the Excel export always get displayRows unfiltered
 * (every auction's row for the active date range) — chart series has no
 * effect on either, since overlaying two series is a chart-specific
 * visual idea.
 *
 * Whenever the date range is "today", a second, independent range
 * (tomorrowRange()) is also fetched — not gated on chart series actually
 * being Tomorrow/Both, so switching between Intraday/Tomorrow/Both is
 * instant rather than waiting on a fresh request each time. This fetch
 * simply doesn't run for any other date range, since Tomorrow/Both are
 * disabled there anyway.
 *
 * provisionalEnabled (from the page-level toggle) drives both fetches —
 * today's range and tomorrow's — the same way, so "today" and "tomorrow"
 * behave identically with respect to provisional data, not two
 * independently-reasoned-about toggle behaviours.
 */
export default function PriceHistorySection({ provisionalEnabled = false }) {
  const [scope, setScope] = useState("today");
  const [view, setView] = useState("chart");
  const [chartSeries, setChartSeries] = useState("intraday");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (scope === "custom") return customRange(customFrom, customTo);
    return presetRange(scope);
  }, [scope, customFrom, customTo]);

  const { rows, error } = useNiPrices(range);
  const provisionalRows = useProvisionalPrices(provisionalEnabled, range);
  const displayRows = useMemo(() => mergeWithProvisional(rows, provisionalRows), [rows, provisionalRows]);

  const tomorrowRangeValue = useMemo(() => (scope === "today" ? tomorrowRange() : null), [scope]);
  const { rows: tomorrowRows } = useNiPrices(tomorrowRangeValue);
  const tomorrowProvisionalRows = useProvisionalPrices(provisionalEnabled, tomorrowRangeValue);
  const tomorrowDisplayRows = useMemo(
    () => mergeWithProvisional(tomorrowRows, tomorrowProvisionalRows),
    [tomorrowRows, tomorrowProvisionalRows]
  );

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
      await exportToExcel({ rows: displayRows, filenameSuffix: suffix });
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
        Date range and view are independent choices below. Chart series depends on date range too — Tomorrow and Both
        only apply while viewing Today.
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
        {view === "chart" && (
          <div className="control-group">
            <span className="control-group-label">Chart series</span>
            <div className="toggle" role="group" aria-label="Chart series">
              {CHART_SERIES.map((s) => {
                const disabled = scope !== "today" && s.key !== "intraday";
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={s.key === chartSeries ? "active" : undefined}
                    aria-pressed={s.key === chartSeries}
                    disabled={disabled}
                    title={disabled ? CHART_SERIES_DISABLED_TITLE : undefined}
                    onClick={() => setChartSeries(s.key)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
                  if (s.key !== "today") setChartSeries("intraday");
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
          tomorrowRows={tomorrowDisplayRows}
          chartSeries={chartSeries}
          emptyMessage={scope === "today" ? TODAY_NOT_PUBLISHED_MESSAGE : undefined}
        />
      ) : (
        <PriceTable rows={displayRows} />
      )}
    </div>
  );
}
