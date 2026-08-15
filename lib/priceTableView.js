import { gbpToPence } from "./priceSeries";

// Column metadata shared between PriceTable's rendering and the Excel
// export's self-documentation note — one definition of what's sortable,
// what's filterable, and what a filter's options are, rather than the
// table and the export separately hardcoding the same facts and risking
// drift between them. STATUS_COLUMN is kept separate (not just appended
// here) since it's the one column PriceTable only shows conditionally,
// depending on whether the active range has any provisional rows at all.
export const AUCTION_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "SEM-DA", label: "Day ahead" },
  { value: "SEM-IDA1", label: "Intraday 1" },
  { value: "SEM-IDA2", label: "Intraday 2" },
  { value: "SEM-IDA3", label: "Intraday 3" },
];

export const BAND_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "low", label: "Low" },
  { value: "average", label: "Typical" },
  { value: "peak", label: "Peak" },
];

export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Official", label: "Official" },
  { value: "Provisional", label: "Provisional" },
];

// Value/date-time columns get the same grey-chip ▼ trigger as the filter
// columns, opening a "Smallest to largest"/"Largest to smallest" menu —
// Excel's own convention for numeric and date/time columns, as opposed
// to the "A-Z"/"Z-A" wording it reserves for text columns (Auction/Band/
// Status here, which keep the plain click-to-toggle header instead).
export const SORT_DIRECTION_OPTIONS = [
  { value: "asc", label: "Smallest to largest" },
  { value: "desc", label: "Largest to smallest" },
];

export const COLUMNS = [
  {
    key: "datetime",
    label: "Settlement period",
    sortable: true,
    sortMenu: true,
    // Easy to misread as "when the auction ran" — it's the delivery
    // period the price applies to, priced by an auction that ran earlier
    // (between 12 and 1pm the day before, for day ahead; earlier the
    // same day, for intraday). Native title attribute keeps this
    // discoverable on hover without needing a new tooltip component for
    // one column.
    title: "The delivery period this price applies to, not when the auction that set it ran.",
  },
  { key: "auction", label: "Auction", sortable: true, filterOptions: AUCTION_FILTER_OPTIONS },
  { key: "pence", label: "Price (p/kWh)", sortable: true, sortMenu: true },
  { key: "price_gbp", label: "Price (£/MWh)", sortable: true, sortMenu: true },
  { key: "band", label: "Band", sortable: true, filterOptions: BAND_FILTER_OPTIONS },
];
export const STATUS_COLUMN = { key: "status", label: "Status", sortable: true, filterOptions: STATUS_FILTER_OPTIONS };

export function defaultFilters() {
  return { auction: "all", band: "all", status: "all" };
}

/** Adds the table's two computed display fields (pence derived from
 * price_gbp, status derived from the provisional flag) — used both by
 * PriceTable's own rendering and the Excel export, so a sort/filter keyed
 * on either field means the same thing in both places rather than each
 * surface deriving it independently. */
export function toViewRows(rows) {
  return rows.map((row) => ({
    ...row,
    pence: gbpToPence(row.price_gbp),
    status: row.provisional ? "Provisional" : "Official",
  }));
}

/** Narrows to rows matching every active filter dimension (AND, not OR)
 * — each defaults to "all" (no restriction on that dimension). */
export function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.auction !== "all" && row.auction !== filters.auction) return false;
    if (filters.band !== "all" && row.band !== filters.band) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    return true;
  });
}

/** Same comparator the table has always used — numeric fields compare
 * numerically, everything else as a string, nulls sort last regardless
 * of direction. */
export function sortRows(rows, sortKey, sortDir) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number") return (av - bv) * dir;
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

export function hasActiveFilters(filters) {
  return filters.auction !== "all" || filters.band !== "all" || filters.status !== "all";
}

function columnLabel(key) {
  const col = [...COLUMNS, STATUS_COLUMN].find((c) => c.key === key);
  return col ? col.label : key;
}

/** Plain-language summary of the active filters for the Excel export's
 * About sheet — "all" dimensions are omitted rather than listed as
 * noise, so one active filter reads as one short clause, not "Auction:
 * All, Band: Low, Status: All". Null when nothing's filtered, so the
 * caller can render a plain "no filters" line instead of an empty one. */
export function describeFilters(filters) {
  const parts = [];
  if (filters.auction !== "all") {
    const opt = AUCTION_FILTER_OPTIONS.find((o) => o.value === filters.auction);
    parts.push(`Auction = ${opt ? opt.label : filters.auction}`);
  }
  if (filters.band !== "all") {
    const opt = BAND_FILTER_OPTIONS.find((o) => o.value === filters.band);
    parts.push(`Band = ${opt ? opt.label : filters.band}`);
  }
  if (filters.status !== "all") {
    parts.push(`Status = ${filters.status}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/** "Settlement period (descending)" — for the same self-documentation
 * note, same justification as describeFilters. */
export function describeSort(sortKey, sortDir) {
  return `${columnLabel(sortKey)} (${sortDir === "asc" ? "ascending" : "descending"})`;
}
