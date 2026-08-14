"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatLondonDateTime } from "../lib/londonTime";
import { AUCTION_LABEL, BAND_LABEL, formatPence, formatGbp } from "../lib/priceSeries";
import { COLUMNS, STATUS_COLUMN, hasActiveFilters } from "../lib/priceTableView";

const BAND_COLOUR = { low: "var(--low)", average: "var(--average)", peak: "var(--peak)" };

/** Excel AutoFilter-style dropdown embedded in a column header — a small
 * ▼ trigger next to the sort button, opening a short list of that
 * column's possible values plus "All". Only one menu is open at a time
 * (openKey/setOpenKey lifted to the table), closed by picking an option,
 * clicking outside, Escape, or scrolling.
 *
 * The menu itself is portaled to document.body and positioned with
 * `position: fixed` from the trigger's real getBoundingClientRect(),
 * rather than `position: absolute` inside .column-filter — the table
 * lives inside .table-scroll, whose overflow-x: auto (which forces
 * overflow-y: auto too, per the CSS overflow spec) clips any
 * absolutely-positioned descendant that renders past its own box, so a
 * menu opened near the table's right edge (Status, and Band once the
 * window narrows slightly) got cut off with no way to scroll it into
 * view. Escaping via a portal sidesteps that clipping ancestor
 * entirely — the same fix shape as the earlier chart-tooltip overflow
 * issue, which needed to escape its own anchor's constraints the same
 * way. */
function ColumnFilterButton({ column, value, onChange, openKey, setOpenKey }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const isOpen = openKey === column.key;
  const [menuPos, setMenuPos] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, left: rect.left });
  }, [isOpen]);

  // Now that the menu escapes .table-scroll, the viewport edge is the
  // only boundary left to respect — clamp leftward once the real
  // rendered width is known, same measure-then-correct approach as the
  // tooltip fix (a guessed width can't account for actual content).
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current || !menuPos) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = menuPos.left;
    const overflowRight = rect.right - (window.innerWidth - margin);
    if (overflowRight > 0) left -= overflowRight;
    if (left < margin) left = margin;
    if (left !== menuPos.left) {
      setMenuPos((pos) => (pos ? { ...pos, left } : pos));
    }
    // menuPos.left is intentionally the only menuPos field depended on —
    // depending on the whole object would re-run this every time it sets
    // left, looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, menuPos && menuPos.left]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inTrigger && !inMenu) setOpenKey(null);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpenKey(null);
    }
    // capture:true so this also fires for scroll on .table-scroll (an
    // ancestor of the trigger) — scroll events don't bubble, but they do
    // reach capture-phase listeners on ancestors including window.
    function handleScroll() {
      setOpenKey(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isOpen, setOpenKey]);

  const active = value !== "all";
  return (
    <span className="column-filter">
      <button
        ref={triggerRef}
        type="button"
        className={active ? "column-filter-trigger active" : "column-filter-trigger"}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Filter ${column.label}`}
        onClick={() => setOpenKey(isOpen ? null : column.key)}
      >
        ▼
      </button>
      {isOpen &&
        menuPos &&
        createPortal(
          <span
            className="column-filter-menu"
            role="menu"
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          >
            {column.filterOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={value === opt.value}
                className={value === opt.value ? "column-filter-option active" : "column-filter-option"}
                onClick={() => {
                  onChange(column.key, opt.value);
                  setOpenKey(null);
                }}
              >
                {opt.label}
              </button>
            ))}
          </span>,
          document.body
        )}
    </span>
  );
}

/**
 * Sortable, filterable table over the same scoped rows as the chart —
 * one row per auction's price for a period (not collapsed to "latest"),
 * so DA vs intraday revisions are visible side by side. Carries the same
 * information as the ring/chart in text form, per the brief's
 * accessibility floor: band is never colour-only here.
 *
 * `rows` arrives already sorted and filtered — PriceHistorySection owns
 * that state (sortKey/sortDir/filters) and computes the final array via
 * lib/priceTableView.js, the same functions the Excel export applies to
 * the same state, so the table and the export can't independently drift.
 * This component only renders and reports interactions upward.
 *
 * `hasProvisional` (whether to show the Status column/filter at all) is
 * passed in from the *unfiltered* range rather than derived from `rows`
 * here — deriving it from the already-filtered rows would make the
 * Status filter disappear the moment someone filtered down to
 * Status = Official, since no visible row would still have
 * provisional: true to detect.
 */
export default function PriceTable({ rows, hasProvisional, sortKey, sortDir, onSort, filters, onFilterChange }) {
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const columns = hasProvisional ? [...COLUMNS, STATUS_COLUMN] : COLUMNS;

  if (rows.length === 0) {
    return (
      <p className="placeholder-note">
        {hasActiveFilters(filters) ? "No rows match the current filters." : "No data yet for this range."}
      </p>
    );
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
                <button type="button" className="sort-button" onClick={() => onSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && (
                    <span className="sort-arrow" aria-hidden="true">
                      {sortDir === "asc" ? " ▲" : " ▼"}
                    </span>
                  )}
                </button>
                {col.filterOptions && (
                  <ColumnFilterButton
                    column={col}
                    value={filters[col.key]}
                    onChange={onFilterChange}
                    openKey={openFilterKey}
                    setOpenKey={setOpenFilterKey}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.datetime}-${row.market}-${row.auction}`}>
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
