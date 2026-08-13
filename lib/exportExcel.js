import { formatLondonDateTime } from "./londonTime";
import {
  AUCTION_EXPLANATION,
  AUCTION_LABEL,
  BAND_EXPLANATION,
  PROVISIONAL_EXPLANATION,
  gbpToPence,
  roundPrice,
} from "./priceSeries";

const BAND_LABEL = { low: "Low", average: "Typical", peak: "Peak" };
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
 */
export async function buildPriceWorkbook(rows) {
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
  // header row for space.
  const aboutSheet = workbook.addWorksheet("About");
  aboutSheet.getColumn(1).width = 90;
  aboutSheet.getCell("A1").value = "How low, typical, and peak are worked out";
  aboutSheet.getCell("A1").font = { bold: true, size: 13 };
  aboutSheet.getCell("A2").value = BAND_EXPLANATION;
  aboutSheet.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  aboutSheet.getRow(2).height = 32;
  aboutSheet.getCell("A4").value =
    "Trailing 7d p33 / p67 in the data sheet are the actual cutoff prices (£/MWh) each row was judged against — below p33 is low, above p67 is peak.";
  aboutSheet.getCell("A4").alignment = { wrapText: true, vertical: "top" };
  aboutSheet.getRow(4).height = 32;

  aboutSheet.getCell("A6").value = "What the Auction column means";
  aboutSheet.getCell("A6").font = { bold: true, size: 13 };
  aboutSheet.getCell("A7").value = AUCTION_EXPLANATION;
  aboutSheet.getCell("A7").alignment = { wrapText: true, vertical: "top" };
  aboutSheet.getRow(7).height = 48;

  if (hasProvisional) {
    aboutSheet.getCell("A9").value = "What the Status column means";
    aboutSheet.getCell("A9").font = { bold: true, size: 13 };
    aboutSheet.getCell("A10").value = PROVISIONAL_EXPLANATION;
    aboutSheet.getCell("A10").alignment = { wrapText: true, vertical: "top" };
    aboutSheet.getRow(10).height = 48;
  }

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

  const sorted = [...rows].sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0));

  for (const row of sorted) {
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
 * Client-side .xlsx export of exactly the rows currently on screen —
 * whatever PriceHistorySection last fetched for the active Today/7 day/
 * All time/Custom scope, so the export always matches what's visible
 * rather than running its own separate fetch. Dynamic import (inside
 * buildPriceWorkbook) keeps ExcelJS out of the initial bundle.
 */
export async function exportToExcel({ rows, filenameSuffix }) {
  const workbook = await buildPriceWorkbook(rows);
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
