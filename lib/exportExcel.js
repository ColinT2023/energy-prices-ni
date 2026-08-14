import { formatLondonDateTime } from "./londonTime";
import {
  AUCTION_EXPLANATION,
  AUCTION_LABEL,
  BAND_EXPLANATION,
  BAND_LABEL,
  PROVISIONAL_EXPLANATION,
  gbpToPence,
  roundPrice,
} from "./priceSeries";

// Pale tints of the band colours (ARGB) — legible as a fill behind dark
// text in Excel's default light sheet view, unlike the site's own
// full-saturation tokens.
const BAND_FILL = { low: "FFD1E9F7", average: "FFFDF0C7", peak: "FFF9D3E4" };

// Excel cells with no explicit number format fall back to "General",
// which trims trailing zeros (125.00 -> "125", 125.30 -> "125.3") — so
// without this, a column of roundPrice'd values wouldn't actually *look*
// consistently 2dp even though every value is stored to at most 2dp.
const PRICE_NUM_FMT = "0.00";

/**
 * Builds the workbook itself — pure ExcelJS usage, no browser APIs, so
 * it's testable head-on (e.g. via a plain Node script) independent of the
 * download step below, which needs a real DOM.
 *
 * `rows` is written in the order given, not re-sorted here — the caller
 * (PriceHistorySection) already sorts/filters via lib/priceTableView.js,
 * the same functions the table itself renders from, so this needs to
 * trust that order rather than silently overriding it back to a fixed
 * datetime sort regardless of what was actually showing on screen.
 * `filterNote`/`sortNote` (plain strings, from lib/priceTableView.js's
 * describeFilters/describeSort) go into the About sheet so the file
 * stays self-documenting about what produced it if opened later with no
 * memory of this session.
 */
export async function buildPriceWorkbook(rows, { filterNote, sortNote } = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NI Energy Prices";
  workbook.created = new Date();

  // Drives both the About sheet's extra note and the data sheet's Status
  // column below — inferred from the rows themselves (the same
  // `provisional` flag mergeWithProvisional tags them with), not a
  // separate parameter, so an export with the toggle off is byte-for-byte
  // the same shape it was before this existed.
  const hasProvisional = rows.some((row) => row.provisional);

  // ── Sheet 1: methodology note ────────────────────────────────────────────
  // A separate sheet rather than a header row on the data sheet, so the
  // explanation reads as prose instead of fighting the data table's own
  // header row for space. Row positions are a cursor, not hardcoded cell
  // references — sections come and go (Status/export-details below are
  // conditional), so hand-picked row numbers would silently collide the
  // next time a section's presence changed.
  const aboutSheet = workbook.addWorksheet("About");
  aboutSheet.getColumn(1).width = 90;

  let r = 1;
  function heading(text) {
    aboutSheet.getCell(`A${r}`).value = text;
    aboutSheet.getCell(`A${r}`).font = { bold: true, size: 13 };
    r += 1;
  }
  function body(text, height = 32) {
    aboutSheet.getCell(`A${r}`).value = text;
    aboutSheet.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
    aboutSheet.getRow(r).height = height;
    r += 2; // leaves one blank row after, matching this sheet's existing spacing
  }

  heading("How low, typical, and peak are worked out");
  body(BAND_EXPLANATION);
  body(
    "Trailing 7d p33 / p67 in the data sheet are the actual cutoff prices (£/MWh) each row was judged against — below p33 is low, above p67 is peak."
  );

  heading("What the Auction column means");
  body(AUCTION_EXPLANATION, 48);

  if (hasProvisional) {
    heading("What the Status column means");
    body(PROVISIONAL_EXPLANATION, 48);
  }

  // Always present (sort is never genuinely "off" — there's always an
  // active key/direction) rather than only appearing once something's
  // filtered, so "no filters applied" is stated plainly instead of the
  // note just being absent and leaving that ambiguous.
  heading("What was applied to this export");
  body(
    `${filterNote ? `Filtered to: ${filterNote}.` : "No filters applied — every row for the active date range."} Sorted by: ${sortNote}.`
  );

  // ── Sheet 2: data ─────────────────────────────────────────────────────────
  const sheet = workbook.addWorksheet("NI Prices", {
    pageSetup: { fitToPage: true, orientation: "landscape" },
  });

  const columns = [
    { header: "Settlement period", key: "period", width: 20 },
    { header: "Auction", key: "auction", width: 14 },
    { header: "Price (p/kWh)", key: "pence", width: 16, style: { numFmt: PRICE_NUM_FMT } },
    { header: "Price (£/MWh)", key: "gbp", width: 16, style: { numFmt: PRICE_NUM_FMT } },
    { header: "Band", key: "band", width: 12 },
    { header: "Trailing 7d p33 (£/MWh)", key: "p33", width: 20, style: { numFmt: PRICE_NUM_FMT } },
    { header: "Trailing 7d p67 (£/MWh)", key: "p67", width: 20, style: { numFmt: PRICE_NUM_FMT } },
  ];
  if (hasProvisional) {
    columns.push({ header: "Status", key: "status", width: 14 });
  }
  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFF2F2F0" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF29292C" } };
    cell.alignment = { vertical: "middle" };
  });

  for (const row of rows) {
    const rowData = {
      period: formatLondonDateTime(row.datetime),
      auction: AUCTION_LABEL[row.auction] ?? row.auction,
      pence: roundPrice(gbpToPence(row.price_gbp)),
      gbp: roundPrice(row.price_gbp),
      band: BAND_LABEL[row.band] ?? row.band,
      p33: roundPrice(row.trailing_7d_p33),
      p67: roundPrice(row.trailing_7d_p67),
    };
    if (hasProvisional) {
      rowData.status = row.provisional ? "Provisional" : "Official";
    }
    const excelRow = sheet.addRow(rowData);
    const bandCell = excelRow.getCell("band");
    if (BAND_FILL[row.band]) {
      bandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL[row.band] } };
    }
    if (hasProvisional && row.provisional) {
      const statusCell = excelRow.getCell("status");
      statusCell.font = { italic: true, color: { argb: "FF9A9A9E" } };
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  return workbook;
}

/**
 * Client-side .xlsx export of exactly the rows currently on screen, in
 * the exact order currently on screen — whatever PriceHistorySection's
 * table sort/filter state currently resolves to for the active Today/
 * 7 day/All time/Custom scope, so the export always matches what's
 * visible rather than running its own separate fetch or its own separate
 * ordering. Dynamic import (inside buildPriceWorkbook) keeps ExcelJS out
 * of the initial bundle.
 */
export async function exportToExcel({ rows, filenameSuffix, filterNote, sortNote }) {
  const workbook = await buildPriceWorkbook(rows, { filterNote, sortNote });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ni-energy-prices-${filenameSuffix}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
