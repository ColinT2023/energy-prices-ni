// A settlement period can be priced by up to four auctions (day ahead,
// then three intraday revisions), each stored as its own row sharing the
// same `datetime`. Later auctions supersede earlier ones for the same
// period — SEM-IDA3 is closer to real time than SEM-DA. This priority
// order is shared by anything that needs "the latest known price" rather
// than every individual auction's row.
export const AUCTION_PRIORITY = {
  "SEM-DA": 0,
  "SEM-IDA1": 1,
  "SEM-IDA2": 2,
  "SEM-IDA3": 3,
};

export const AUCTION_LABEL = {
  "SEM-DA": "day ahead",
  "SEM-IDA1": "intraday 1",
  "SEM-IDA2": "intraday 2",
  "SEM-IDA3": "intraday 3",
};

function priorityOf(row) {
  return AUCTION_PRIORITY[row.auction] ?? -1;
}

/**
 * Collapses rows sharing the same settlement period (datetime) down to
 * the single most-recently-auctioned one, sorted by datetime ascending.
 * Used wherever "the current price" for a period means one answer (the
 * Ring, the headline price) rather than every auction's row (the table).
 */
export function latestPerPeriod(rows) {
  const byPeriod = new Map();
  for (const row of rows) {
    const existing = byPeriod.get(row.datetime);
    if (!existing || priorityOf(row) > priorityOf(existing)) {
      byPeriod.set(row.datetime, row);
    }
  }
  return [...byPeriod.values()].sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
}

/** Every SEM-DA row, sorted by datetime — the chart's solid day-ahead line. */
export function dayAheadSeries(rows) {
  return rows
    .filter((row) => row.auction === "SEM-DA")
    .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
}

/**
 * Latest intraday auction per period (SEM-IDA1/2/3 only — day ahead is
 * excluded even where it's all that exists yet, since this is meant to
 * read as "how intraday trading has actually repriced the day", not a
 * day-ahead line in disguise for not-yet-revised periods).
 */
export function latestIntradaySeries(rows) {
  const byPeriod = new Map();
  for (const row of rows) {
    if (row.auction === "SEM-DA") continue;
    const existing = byPeriod.get(row.datetime);
    if (!existing || priorityOf(row) > priorityOf(existing)) {
      byPeriod.set(row.datetime, row);
    }
  }
  return [...byPeriod.values()].sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
}
