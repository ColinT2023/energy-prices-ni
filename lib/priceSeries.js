import { londonMidnightUtc, londonYmd } from "./londonTime";

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

// Plain-language description of ni_prices_banded's band logic (rank-based
// thirds, not a fixed threshold), shared by the Ring's info tooltip, the
// Help page, and the Excel export's methodology note so the wording never
// drifts between them. Deliberately has no "percentile"/"quantile" — see
// the point-2 request this was written for.
export const BAND_EXPLANATION =
  "Each half hour is compared to all the half-hourly prices from the last 7 days. The cheapest third are shown as low, the priciest third as peak, and the rest as average.";

// Plain-language description of what the Auction column's values mean —
// used verbatim in the Excel export's About sheet; the Help page covers
// the same facts with more context but names the same literal codes.
export const AUCTION_EXPLANATION =
  "SEM-DA is the day ahead auction, held the afternoon before delivery and setting the first price for every half hour of the next day. SEM-IDA1, SEM-IDA2, and SEM-IDA3 are three further intraday auctions held later on the day itself, each repricing the same settlement periods with more up to date information. A higher number means a more recent revision, so SEM-IDA3 — where a period has one — is the closest to real time.";

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

// Beyond this span, the chart aggregates to one point per day instead of
// plotting every half-hourly row — full detail is genuinely useful for
// Today/7 day (and is where the Ring's own "now" context lives), but not
// meaningful at a glance across months of half-hourly noise, and it's a
// real render cost at that size. 7 day itself (span == 7) stays full
// detail — only ranges that exceed it aggregate.
export const WIDE_RANGE_DAYS = 7;

/**
 * Collapses an already one-row-per-period series (dayAheadSeries or
 * latestIntradaySeries output) down to one point per London calendar day
 * — the day's average price, banded by comparing that average against
 * the day's own trailing_7d_p33/p67 cutoffs (also averaged across the
 * day). That's an aggregate-of-aggregates rather than a fresh per-day
 * banding query, which is deliberate: it reuses exactly the cutoffs each
 * underlying row was already judged against rather than adding another
 * source of truth for what "low/average/peak" means.
 */
export function aggregateDaily(seriesRows) {
  const byDay = new Map();
  for (const row of seriesRows) {
    const ymd = londonYmd(new Date(row.datetime));
    let bucket = byDay.get(ymd);
    if (!bucket) {
      bucket = { ymd, sumPrice: 0, sumP33: 0, sumP67: 0, count: 0 };
      byDay.set(ymd, bucket);
    }
    bucket.sumPrice += row.price_gbp;
    bucket.sumP33 += row.trailing_7d_p33 ?? row.price_gbp;
    bucket.sumP67 += row.trailing_7d_p67 ?? row.price_gbp;
    bucket.count += 1;
  }

  return [...byDay.values()]
    .map((b) => {
      const avgPrice = b.sumPrice / b.count;
      const avgP33 = b.sumP33 / b.count;
      const avgP67 = b.sumP67 / b.count;
      const band = avgPrice < avgP33 ? "low" : avgPrice > avgP67 ? "peak" : "average";
      return {
        datetime: londonMidnightUtc(new Date(`${b.ymd}T00:00:00Z`)).toISOString(),
        price_gbp: avgPrice,
        band,
        periodCount: b.count,
      };
    })
    .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
}
