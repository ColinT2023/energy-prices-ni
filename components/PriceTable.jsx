"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatLondonDateTime } from "../lib/londonTime";
import { AUCTION_LABEL, BAND_LABEL, formatPence, formatGbp } from "../lib/priceSeries";
import { COLUMNS, STATUS_COLUMN, SORT_DIRECTION_OPTIONS, hasActiveFilters } from "../lib/priceTableView";

const BAND_COLOUR = { low: "var(--low)", average: "var(--average)", peak: "var(--peak)" };

/** Excel AutoFilter-style dropdown embedded in a column header — a small
 * ▼ chip trigger opening a short menu. Shared by two callers below:
 * per-value filtering (ColumnFilterButton, on Auction/Band/Status) and
 * the sort-direction menu (ColumnSortButton, on Settlement period/
 * Price (p/kWh)/Price (£/MWh)) — one trigger, one positioning system,
 * one "filled in once it's active" colour rule, so the whole header row
 * reads as one system rather than a filter affordance and a sort
 * affordance that happen to look alike. Only one menu is open at a time
 * across both kinds (openKey/setOpenKey lifted to the table).
 *
 * The menu *body* is fully owned by the caller via renderMenu({close})
 * — the two callers need genuinely different interaction models (sort
 * picks one option and closes immediately; filter is a checkbox list
 * that stays open across several edits and closes only on its own
 * Apply action), so only the trigger/portal/positioning/dismissal
 * mechanics are shared here, not the content.
 *
 * The menu itself is portaled to document.body and positioned with
 * `position: fixed` from the trigger's real getBoundingClientRect(),
 * rather than `position: absolute` inside .column-menu — the table
 * lives inside .table-scroll, whose overflow-x: auto (which forces
 * overflow-y: auto too, per the CSS overflow spec) clips any
 * absolutely-positioned descendant that renders past its own box, so a
 * menu opened near the table's right edge (Status, and Band once the
 * window narrows slightly) got cut off with no way to scroll it into
 * view. Escaping via a portal sidesteps that clipping ancestor
 * entirely — the same fix shape as the earlier chart-tooltip overflow
 * issue, which needed to escape its own anchor's constraints the same
 * way. Closing any way other than the menu's own commit action (click
 * outside, Escape, scroll) discards whatever wasn't explicitly applied
 * — for the filter menu specifically, that means unapplied checkbox
 * edits are abandoned, same as dismissing a real Excel AutoFilter
 * dropdown without pressing OK. */
function ColumnMenuButton({ menuKey, ariaLabel, active, openKey, setOpenKey, menuRole = "menu", renderMenu }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const isOpen = openKey === menuKey;
  const [menuPos, setMenuPos] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, left: rect.left });
  }, [isOpen]);

  // Now that the menu escapes .table-scroll, the viewport edge is the
  // only boundary left to respect — clamp leftward/upward once the real
  // rendered size is known, same measure-then-correct approach as the
  // tooltip fix (a guessed size can't account for actual content).
  // Vertical clamping specifically matters now that filter menus are a
  // checkbox list (up to 6 rows + Apply) rather than a 2-option sort
  // menu — tall enough, opened low enough on a short mobile viewport,
  // to render its Apply button below the fold with no way to reach it.
  // Flips above the trigger first (like a native <select>/AutoFilter
  // dropdown would), falling back to clamping against the bottom edge
  // only if flipping still wouldn't fit either.
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current || !menuPos || !triggerRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const margin = 8;

    let left = menuPos.left;
    const overflowRight = rect.right - (window.innerWidth - margin);
    if (overflowRight > 0) left -= overflowRight;
    if (left < margin) left = margin;

    let top = menuPos.top;
    const overflowBottom = rect.bottom - (window.innerHeight - margin);
    if (overflowBottom > 0) {
      const flippedTop = triggerRect.top - rect.height - 6;
      top = flippedTop >= margin ? flippedTop : Math.max(margin, window.innerHeight - margin - rect.height);
    }

    if (left !== menuPos.left || top !== menuPos.top) {
      setMenuPos((pos) => (pos ? { ...pos, left, top } : pos));
    }
    // menuPos.left/top are intentionally the only menuPos fields
    // depended on — depending on the whole object would re-run this
    // every time it sets either, looping. Settles in at most two passes:
    // the second run measures the already-corrected position, finds no
    // further overflow, and makes no further change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, menuPos && menuPos.left, menuPos && menuPos.top]);

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

  return (
    <span className="column-menu">
      <button
        ref={triggerRef}
        type="button"
        className={active ? "column-menu-trigger active" : "column-menu-trigger"}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onClick={() => setOpenKey(isOpen ? null : menuKey)}
      >
        ▼
      </button>
      {isOpen &&
        menuPos &&
        createPortal(
          <span
            className="column-menu-list"
            role={menuRole}
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          >
            {renderMenu({ close: () => setOpenKey(null) })}
          </span>,
          document.body
        )}
    </span>
  );
}

/** Excel's own AutoFilter checkbox-list behaviour: every value starts
 * checked, unchecking narrows to an OR of whatever's still checked, and
 * unchecking everything is a deliberate "show nothing" rather than
 * silently reverting to "show everything" (see filterRows in
 * lib/priceTableView.js — this component only ever hands it whatever
 * Set the checkboxes actually resolve to). Edits are held in local
 * `pending` state and only committed via Apply, matching Excel's own
 * OK-to-commit pattern rather than filtering live on every click — this
 * remounts fresh (and so re-syncs to the real applied `selected`) each
 * time the menu opens, since ColumnMenuButton only renders it while
 * open. "(Select all)" is genuinely tri-state (checked/unchecked/
 * indeterminate), same as real Excel's own master checkbox — plain
 * `checked` alone can't express "some but not all", so its DOM
 * `.indeterminate` property is set imperatively via a ref. */
function FilterCheckboxList({ options, selected, onApply, close }) {
  const [pending, setPending] = useState(selected);
  const selectAllRef = useRef(null);

  const allChecked = pending.size === options.length;
  const noneChecked = pending.size === 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allChecked && !noneChecked;
    }
  }, [allChecked, noneChecked]);

  function toggleValue(value) {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleSelectAll() {
    setPending(allChecked ? new Set() : new Set(options.map((o) => o.value)));
  }

  return (
    <>
      <label className="column-menu-checkbox column-menu-select-all">
        <input type="checkbox" ref={selectAllRef} checked={allChecked} onChange={toggleSelectAll} />
        (Select all)
      </label>
      {options.map((opt) => (
        <label key={opt.value} className="column-menu-checkbox">
          <input type="checkbox" checked={pending.has(opt.value)} onChange={() => toggleValue(opt.value)} />
          {opt.label}
        </label>
      ))}
      <button
        type="button"
        className="column-menu-apply"
        onClick={() => {
          onApply(pending);
          close();
        }}
      >
        Apply
      </button>
    </>
  );
}

function ColumnFilterButton({ column, selected, onChange, openKey, setOpenKey }) {
  const active = selected.size !== column.filterOptions.length;
  return (
    <ColumnMenuButton
      menuKey={`filter:${column.key}`}
      ariaLabel={`Filter ${column.label}`}
      active={active}
      menuRole="group"
      openKey={openKey}
      setOpenKey={setOpenKey}
      renderMenu={({ close }) => (
        <FilterCheckboxList
          options={column.filterOptions}
          selected={selected}
          onApply={(next) => onChange(column.key, next)}
          close={close}
        />
      )}
    />
  );
}

/** "Smallest to largest"/"Largest to smallest" — Excel's own wording for
 * numeric and date/time columns (as opposed to the "A-Z"/"Z-A" it uses
 * for text columns), which is what Settlement period and both price
 * columns actually are. Auction/Band/Status keep the plain click-to-
 * toggle header instead, since they're the text columns here. */
function ColumnSortButton({ column, sortKey, sortDir, onSelect, openKey, setOpenKey }) {
  const isActiveColumn = sortKey === column.key;
  return (
    <ColumnMenuButton
      menuKey={`sort:${column.key}`}
      ariaLabel={`Sort ${column.label}`}
      active={isActiveColumn}
      openKey={openKey}
      setOpenKey={setOpenKey}
      renderMenu={({ close }) => (
        <>
          {SORT_DIRECTION_OPTIONS.map((opt) => {
            const selected = isActiveColumn && sortDir === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "column-menu-option active" : "column-menu-option"}
                onClick={() => {
                  onSelect(column.key, opt.value);
                  close();
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </>
      )}
    />
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
export default function PriceTable({
  rows,
  hasProvisional,
  sortKey,
  sortDir,
  onSort,
  onSortSelect,
  filters,
  onFilterChange,
}) {
  // Shared across both the per-value filter menus and the sort-direction
  // menus, prefixed by kind (filter:/sort:) — so opening one always
  // closes any other, filter or sort, rather than letting two popovers
  // stack.
  const [openMenuKey, setOpenMenuKey] = useState(null);
  const columns = hasProvisional ? [...COLUMNS, STATUS_COLUMN] : COLUMNS;

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
                {col.sortMenu ? (
                  <>
                    <span className="col-label">{col.label}</span>
                    <ColumnSortButton
                      column={col}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSelect={onSortSelect}
                      openKey={openMenuKey}
                      setOpenKey={setOpenMenuKey}
                    />
                  </>
                ) : (
                  <button type="button" className="sort-button" onClick={() => onSort(col.key)}>
                    {col.label}
                    {sortKey === col.key && (
                      <span className="sort-arrow" aria-hidden="true">
                        {sortDir === "asc" ? " ▲" : " ▼"}
                      </span>
                    )}
                  </button>
                )}
                {col.filterOptions && (
                  <ColumnFilterButton
                    column={col}
                    selected={filters[col.key]}
                    onChange={onFilterChange}
                    openKey={openMenuKey}
                    setOpenKey={setOpenMenuKey}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            // A single-cell row, not the earlier full-component early
            // return — that hid the header row (and with it, every
            // filter chip) the moment a filter matched zero rows, which
            // used to be a rare coincidence but is now a one-click
            // reachable state (uncheck everything in a column, or AND
            // two columns into an empty intersection). Keeping the
            // header/chips mounted means the filter that caused this is
            // still right there to reopen and fix.
            <tr>
              <td colSpan={columns.length} className="placeholder-note">
                {hasActiveFilters(filters) ? "No rows match the current filters." : "No data yet for this range."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
