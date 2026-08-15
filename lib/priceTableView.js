import { gbpToPence } from "./priceSeries";

// Column metadata shared between PriceTable's rendering and the Excel
// export's self-documentation note — one definition of what's sortable,
// what's filterable, and what a filter's options are, rather than the
// table and the export separately hardcoding the same facts and risking
// drift between them. STATUS_COLUMN is kept separate (not just appended
// here) since it's the one column PriceTable only shows conditionally,
// depending on whether the active range has any provisional rows at all.
export const AUCTION_FILTER_OPTIONS = [
  { value: "SEM-DA", label: "Day ahead" },
  { value: "SEM-IDA1", label: "Intraday 1" },
  { value: "SEM-IDA2", label: "Intraday 2" },
  { value: "SEM-IDA3", label: "Intraday 3" },
];

export const BAND_FILTER_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "average", label: "Typical" },
  { value: "peak", label: "Peak" },
];

export const STATUS_FILTER_OPTIONS = [
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

// Excel AutoFilter's own default state: every value starts checked,
// which is indistinguishable from "no filter" until something gets
// unchecked — see filterRows below for how a deliberately emptied-out
// column then filters to zero rows rather than reverting to "all".
export function defaultFilters() {
  return {
    auction: new Set(AUCTION_FILTER_OPTIONS.map((o) => o.value)),
    band: new Set(BAND_FILTER_OPTIONS.map((o) => o.value)),
    status: new Set(STATUS_FILTER_OPTIONS.map((o) => o.value)),
  };
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

/** Narrows to rows matching every active filter dimension — AND across
 * Auction/Band/Status, OR within each one's checked values, same
 * semantics as Excel's own AutoFilter: a column with every value
 * checked doesn't restrict anything (the default), a column with some
 * values checked keeps only rows matching one of them, and a column
 * with nothing checked deliberately matches no rows at all rather than
 * silently reverting to "all" — Excel doesn't quietly ignore an
 * emptied-out filter, and neither does this. */
export function filterRows(rows, filters) {
  return rows.filter(
    (row) => filters.auction.has(row.auction) && filters.band.has(row.band) && filters.status.has(row.status)
  );
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
  return (
    filters.auction.size !== AUCTION_FILTER_OPTIONS.length ||
    filters.band.size !== BAND_FILTER_OPTIONS.length ||
    filters.status.size !== STATUS_FILTER_OPTIONS.length
  );
}

function columnLabel(key) {
  const col = [...COLUMNS, STATUS_COLUMN].find((c) => c.key === key);
  return col ? col.label : key;
}

/** One column's clause, e.g. "Intraday 1 or Intraday 2" — Excel's own
 * wording for a multi-value AutoFilter selection. Null when every value
 * is checked (this column isn't restricting anything, so it shouldn't
 * appear at all), a plain "(none selected)" for the deliberate
 * zero-rows case rather than an empty/confusing clause. */
function describeColumnFilter(options, selected) {
  if (selected.size === options.length) return null;
  if (selected.size === 0) return "(none selected)";
  return options
    .filter((o) => selected.has(o.value))
    .map((o) => o.label)
    .join(" or ");
}

/** Plain-language summary of the active filters for the Excel export's
 * About sheet — fully-checked dimensions are omitted rather than listed
 * as noise, so one narrowed column reads as one short clause, not
 * "Auction: All, Band: Low, Status: All". Clauses join as separate
 * sentences ("Auction = X or Y. Band = Z.") rather than comma-separated,
 * so a multi-value OR within a column doesn't read as one long
 * comma list indistinguishable from the AND between columns. Null when
 * nothing's filtered, so the caller can render a plain "no filters"
 * line instead of an empty one. */
export function describeFilters(filters) {
  const parts = [];
  const auctionDesc = describeColumnFilter(AUCTION_FILTER_OPTIONS, filters.auction);
  if (auctionDesc) parts.push(`Auction = ${auctionDesc}`);
  const bandDesc = describeColumnFilter(BAND_FILTER_OPTIONS, filters.band);
  if (bandDesc) parts.push(`Band = ${bandDesc}`);
  const statusDesc = describeColumnFilter(STATUS_FILTER_OPTIONS, filters.status);
  if (statusDesc) parts.push(`Status = ${statusDesc}`);
  return parts.length > 0 ? parts.join(". ") : null;
}

/** "Settlement period (descending)" — for the same self-documentation
 * note, same justification as describeFilters. */
export function describeSort(sortKey, sortDir) {
  return `${columnLabel(sortKey)} (${sortDir === "asc" ? "ascending" : "descending"})`;
}
