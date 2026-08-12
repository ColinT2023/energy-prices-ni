"use client";

import { useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import PriceHistoryChart from "./PriceHistoryChart";
import PriceTable from "./PriceTable";

const SCOPES = [
  { key: "today", label: "Today" },
  { key: "7day", label: "7 day" },
  { key: "full", label: "Full 2026" },
];

const VIEWS = [
  { key: "chart", label: "Chart" },
  { key: "table", label: "Table" },
];

/**
 * Owns the Today/7 day/Full 2026 scope and the chart/table view switch
 * the brief describes as shared between the chart and the table, fetches
 * that scope's rows once, and hands them to whichever view is active.
 */
export default function PriceHistorySection() {
  const [scope, setScope] = useState("today");
  const [view, setView] = useState("chart");
  const { rows, error } = useNiPrices(scope);

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

      {error && <p role="alert">Couldn&apos;t load price history: {error}</p>}
      {view === "chart" ? <PriceHistoryChart rows={rows} /> : <PriceTable rows={rows} />}
    </div>
  );
}
