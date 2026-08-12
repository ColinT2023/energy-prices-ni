"use client";

import { useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { presetRange, customRange } from "../lib/priceRange";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceTable from "./PriceTable";

const SCOPES = [
  { key: "today", label: "Today" },
  { key: "7day", label: "7 day" },
  { key: "full", label: "Full 2026" },
  { key: "custom", label: "Custom" },
];

const VIEWS = [
  { key: "chart", label: "Chart" },
  { key: "table", label: "Table" },
];

/**
 * Owns the Today/7 day/Full 2026/Custom scope and the chart/table view
 * switch the brief describes as shared between the chart and the table,
 * resolves that scope to a single {from, to} range (lib/priceRange.js),
 * fetches it once via useNiPrices, and hands the rows to whichever view
 * is active — and, via the `rows` passed down, to the Excel export too,
 * so an export always matches exactly what's on screen.
 */
export default function PriceHistorySection() {
  const [scope, setScope] = useState("today");
  const [view, setView] = useState("chart");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (scope === "custom") return customRange(customFrom, customTo);
    return presetRange(scope);
  }, [scope, customFrom, customTo]);

  const { rows, error } = useNiPrices(range);

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
      {view === "chart" ? <PriceHistoryChart rows={rows} /> : <PriceTable rows={rows} />}
    </div>
  );
}
