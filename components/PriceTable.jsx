"use client";

import { useMemo, useState } from "react";
import { formatLondonDateTime } from "../lib/londonTime";
import { AUCTION_LABEL, BAND_LABEL, gbpToPence, formatPence, formatGbp } from "../lib/priceSeries";

const BAND_COLOUR = { low: "var(--low)", average: "var(--average)", peak: "var(--peak)" };

const BASE_COLUMNS = [
  {
    key: "datetime",
    label: "Settlement period",
    // Easy to misread as "when the auction ran" — it's the delivery
    // period the price applies to, priced by an auction that ran earlier
    // (the afternoon before, for day ahead; earlier the same day, for
    // intraday). Native title attribute keeps this discoverable on hover
    // without needing a new tooltip component for one column.
    title: "The delivery period this price applies to, not when the auction that set it ran.",
  },
  { key: "auction", label: "Auction" },
  { key: "pence", label: "Price (p/kWh)" },
  { key: "price_gbp", label: "Price (£/MWh)" },
  { key: "band", label: "Band" },
];
const STATUS_COLUMN = { key: "status", label: "Status" };

/**
 * Sortable table over the same scoped rows as the chart — one row per
 * auction's price for a period (not collapsed to "latest"), so DA vs
 * intraday revisions are visible side by side. Carries the same
 * information as the ring/chart in text form, per the brief's
 * accessibility floor: band is never colour-only here.
 *
 * The Status column only appears when `rows` actually contains a
 * provisional row (the same `provisional` flag mergeWithProvisional
 * tags them with) — inferred from the data itself rather than a
 * separate prop, so a toggle-off render (never any provisional rows)
 * looks exactly as it did before this column existed.
 */
export default function PriceTable({ rows }) {
  const [sortKey, setSortKey] = useState("datetime");
  const [sortDir, setSortDir] = useState("desc");

  const hasProvisional = useMemo(() => rows.some((row) => row.provisional), [rows]);
  const columns = hasProvisional ? [...BASE_COLUMNS, STATUS_COLUMN] : BASE_COLUMNS;

  const sorted = useMemo(() => {
    const withPence = rows.map((row) => ({
      ...row,
      pence: gbpToPence(row.price_gbp),
      status: row.provisional ? "Provisional" : "Official",
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    return withPence.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number") return (av - bv) * dir;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, sortKey, sortDir]);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "datetime" ? "desc" : "asc");
    }
  }

  if (rows.length === 0) {
    return <p className="placeholder-note">No data yet for this range.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="price-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                title={col.title}
              >
                <button type="button" className="sort-button" onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && <span aria-hidden="true">{sortDir === "asc" ? " ↑" : " ↓"}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.datetime}-${row.market}`}>
              <td>{formatLondonDateTime(row.datetime)}</td>
              <td>{AUCTION_LABEL[row.auction] ?? row.auction}</td>
              <td>{formatPence(row.price_gbp)}</td>
              <td>{formatGbp(row.price_gbp)}</td>
              <td>
                <span className="band-dot" style={{ background: BAND_COLOUR[row.band] }} />
                {BAND_LABEL[row.band] ?? row.band}
              </td>
              {hasProvisional && (
                <td className={row.provisional ? "status-provisional" : undefined}>{row.status}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
