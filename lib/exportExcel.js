import { formatLondonDateTime } from "./londonTime";
import { AUCTION_LABEL } from "./priceSeries";

const BAND_LABEL = { low: "Low", average: "Average", peak: "Peak" };
// Pale tints of the band colours (ARGB) — legible as a fill behind dark
// text in Excel's default light sheet view, unlike the site's own
// full-saturation tokens.
const BAND_FILL = { low: "FFD1E9F7", average: "FFFDF0C7", peak: "FFF9D3E4" };

function gbpToPence(priceGbp) {
  return priceGbp / 10;
}

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

  const sheet = workbook.addWorksheet("NI Prices", {
    pageSetup: { fitToPage: true, orientation: "landscape" },
  });

  sheet.columns = [
    { header: "Settlement period", key: "period", width: 20 },
    { header: "Auction", key: "auction", width: 14 },
    { header: "Price (p/kWh)", key: "pence", width: 16 },
    { header: "Price (£/MWh)", key: "gbp", width: 16 },
    { header: "Band", key: "band", width: 12 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFF2F2F0" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF29292C" } };
    cell.alignment = { vertical: "middle" };
  });

  const sorted = [...rows].sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0));

  for (const row of sorted) {
    const excelRow = sheet.addRow({
      period: formatLondonDateTime(row.datetime),
      auction: AUCTION_LABEL[row.auction] ?? row.auction,
      pence: Number(gbpToPence(row.price_gbp).toFixed(1)),
      gbp: Number(Number(row.price_gbp).toFixed(2)),
      band: BAND_LABEL[row.band] ?? row.band,
    });
    const bandCell = excelRow.getCell("band");
    if (BAND_FILL[row.band]) {
      bandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL[row.band] } };
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  return workbook;
}

/**
 * Client-side .xlsx export of exactly the rows currently on screen —
 * whatever PriceHistorySection last fetched for the active Today/7 day/
 * Full 2026/Custom scope, so the export always matches what's visible
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
