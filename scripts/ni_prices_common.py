"""
Shared SEMOpx EA-001 report list + parser, reused by backfill.py and
ingest_incremental.py.

get_ea001_report_list() and parse_market_result_report() are lifted
unchanged from build_ni_price_table.py — that parsing logic is already
confirmed working against a live report sample, so it's reused as-is rather
than rewritten. Everything else here just splits build_ni_price_table()'s
single-shot flow into pieces both the backfill and incremental scripts can
call independently (download+parse separately from the pivot step, and
report the pivot as rows ready for a Supabase upsert).
"""

import re
import time

import pandas as pd
import requests

API_URL = "https://reports.semopx.com/api/v1/documents/static-reports"
RESOURCE_BASE = "https://reports.semopx.com/documents/"

# Not used by this pipeline, but worth keeping on record: semopx.com's own
# "Auction Status" widget (homepage, under "Our Markets") is backed by a
# separate, undocumented endpoint — https://reports.sem-o.com/api/v1/ommessages
# (also reachable at the reports.semopx.com host; both resolve to the same
# data). It returns live per-market status records, e.g.:
#   {"Market": "SEM-DA", "MarketStatus": "On Time",
#    "OrderBookClosure": "On Time", "MarketResultsPublication": "Final", ...}
# Found via a real-browser network capture while investigating why the
# EA-001 report list appeared stuck (see get_new_ea001_reports below for
# that fix) — this endpoint is a plausible future source for a live
# "is today's auction delayed?" indicator on the site, but nothing here
# reads it today.
#
# Separately, also found and worth keeping on record: semopx.com's own
# "Market Results" chart widget does not read the flat CSV this pipeline
# downloads (RESOURCE_BASE + ResourceName). It reads a different,
# undocumented endpoint keyed by the report's internal _id instead of its
# filename — https://reports.sem-o.com/api/v1/documents/{_id}?IST=1 (the
# _id comes from the static-reports listing above). That endpoint returns
# the report's fully parsed contents as JSON (an already-decoded
# equivalent of what parse_market_result_report extracts from the raw
# CSV), and — confirmed directly — can have real values populated there
# while RESOURCE_BASE + ResourceName for the exact same report still
# 404s/returns a placeholder and the response's own
# "FilePublicationDelayed" field is true. So this endpoint runs ahead of
# the official CSV, not just a mirror of it.
#
# Deliberately not integrated: it's unofficial and undocumented (no
# indication it's a stable public API rather than an implementation
# detail of the website's own frontend), and switching to it would mean
# tracking reports by _id instead of ResourceName and parsing a different
# response shape. Kept here as a reference in case the CSV endpoint's lag
# becomes a recurring problem worth revisiting, not an active
# integration.

# Earliest date either script will ever ask the API for. Used as the
# backfill start date and as the incremental script's fallback when no
# watermark has been set yet.
DEFAULT_START_DATE = "2026-01-01"


def get_ea001_report_list(start_date, sort_by="Date", order_by="ASC", page_size=100):
    """
    Page through the SEMOpx report list for every EA-001 report published
    on or after start_date, returning the full list of report items.

    Always passes ExcludeDelayedPublication=0 (see get_new_ea001_reports'
    docstring for why) — without it, the API silently drops the most
    recently published reports regardless of the Date range asked for,
    which is exactly what left ni_prices stuck at "yesterday" every run.
    """
    items = []
    page = 1
    while True:
        params = {
            "DPuG_ID": "EA-001",
            "Date": f">={start_date}",
            "ExcludeDelayedPublication": 0,
            "page": page,
            "page_size": page_size,
            "sort_by": sort_by,
            "order_by": order_by,
        }
        response = requests.get(API_URL, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()

        items.extend(payload.get("items", []))

        total_pages = payload.get("pagination", {}).get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1

    return items


def get_new_ea001_reports(watermark, page_size=100):
    """
    Page through the EA-001 report list newest-first (sort_by=Date,
    order_by=DESC), stopping once an entire page contains nothing newer
    than the given watermark (see the stopping-condition paragraph below
    for why not just the first such item) — so this only ever looks back
    as far as needed to reach already-ingested data, not the full
    (1,000+ and growing) report history the way a Date-bounded fetch
    would.

    Sorted by Date, not PublishTime, and compared against each item's
    filename-embedded end timestamp, not its PublishTime field — SEMOpx's
    PublishTime is only genuine for the single most-recently-published
    report; for every other report it's silently rewritten to a
    clustered, non-chronological batch value (confirmed directly: 227
    real SEM-DA reports' PublishTime values collapsed into a handful of
    near-identical early-UTC timestamps regardless of their wildly
    different actual publish times). Sorting or watermarking against that
    field doesn't reliably terminate in the right place — this is what
    silently left ni_prices stuck at 14 Aug 21:30 for hours across many
    outwardly-"successful" scheduled runs, confirmed live against three
    known-missing reports the live API had but ni_prices didn't.

    Stopping condition is deliberately NOT "stop at the first item whose
    end timestamp reaches the watermark" — Date is the auction's own
    reference/delivery period, which for SEM-DA specifically is the
    *next* day's date (one day ahead of when the report was actually
    generated); every other auction type's Date is same-day. Sorted DESC,
    an already-old day-ahead report (Date = its delivery day, which can
    still be "today" or later even once stale) can land *between* two
    genuinely-new same-day reports whose Date values bracket it — first-
    item-stops missed a real, still-new report this way, confirmed live
    (a stale day-ahead report's Date sat between two newer intraday
    reports' Date values, so the walk stopped one item too soon and
    silently skipped the older-Date one). Instead, this pages until an
    *entire page* contains nothing newer than the watermark — since the
    day-ahead offset can shift at most one report's sort position by
    about a day's worth of entries, a whole 100-item page of nothing-new
    is overwhelming safety margin against that one specific, bounded
    interleaving case, while still terminating well short of the full
    (1,000+ and growing) report history.

    No Date *filter* here at all, deliberately (sort_by=Date is a
    separate, unrelated parameter from a Date range filter): SEMOpx's
    Date filter — even combined with ExcludeDelayedPublication=0 — was
    found to still cap results at whatever the API's "recent" cutoff is
    when both are combined with a Date lower bound close to now, which is
    what caused ni_prices to get permanently stuck the first time around
    (the incremental script's own watermark landed exactly on that
    boundary, so every run's Date-bounded query returned nothing newer,
    forever). Fetching the *unfiltered* list with ExcludeDelayedPublication=0
    and stopping client-side once the watermark is reached avoids that
    entirely, verified directly against the live API.

    watermark=None (no prior state) means every report is "new" — this
    pages through the whole history, same cost as a one-off backfill, but
    that only happens once, before any watermark exists.

    Returns items oldest-to-newest by fetch order, NOT guaranteed sorted
    by end timestamp (see above — Date-order and end-timestamp-order can
    genuinely diverge for a day-ahead report). A caller computing the new
    watermark must take the *maximum* end timestamp across every returned
    item, not just the last one in list order — confirmed live this
    matters: naively taking the last item understated the correct
    watermark by over two hours in the same real batch that motivated
    this fix.
    """
    watermark_ts = parse_publish_time(watermark) if watermark else None
    items = []
    page = 1
    while True:
        params = {
            "DPuG_ID": "EA-001",
            "ExcludeDelayedPublication": 0,
            "page": page,
            "page_size": page_size,
            "sort_by": "Date",
            "order_by": "DESC",
        }
        response = requests.get(API_URL, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()

        page_items = payload.get("items", [])
        if not page_items:
            break

        any_new_this_page = False
        for item in page_items:
            end_ts = parse_resource_name_end_ts(item["ResourceName"])
            if watermark_ts is not None and end_ts <= watermark_ts:
                continue
            items.append(item)
            any_new_this_page = True

        if not any_new_this_page:
            break

        total_pages = payload.get("pagination", {}).get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1

    items.reverse()  # was newest-first; callers want oldest-first
    return items


def latest_end_ts(report_items):
    """
    The maximum parse_resource_name_end_ts across `report_items` — what
    both ingest_incremental.py and backfill.py use to compute a new
    watermark. Deliberately not "the last item in list order": Date-sort
    order and end-timestamp order can genuinely diverge for a day-ahead
    report (see get_new_ea001_reports' own docstring), so the true most-
    recent report isn't reliably the last one returned. One shared
    implementation rather than each caller re-deriving the same max.
    """
    return max(parse_resource_name_end_ts(item["ResourceName"]) for item in report_items)


def parse_market_result_report(report_text, resource_name):
    """
    Parse one EA-001 report's raw text and return a list of price records
    for the NI market blocks only (both EUR and GBP), one record per
    half hourly period.
    """
    lines = report_text.splitlines()
    records = []

    auction_id = None
    current_market = None
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("Auction;"):
            auction_id = line.split(";", 1)[1]

        elif line.startswith("Market;"):
            current_market = line.split(";", 1)[1]

        elif line.startswith("Index prices;"):
            # Format: Index prices;30;EUR  (or GBP)
            currency = line.split(";")[2]
            timestamps = lines[i + 1].strip().split(";")
            raw_values = lines[i + 2].strip().split(";")

            # Only keep this block if it belongs to a Northern Ireland market
            if current_market and current_market.startswith("NI"):
                for ts, raw_val in zip(timestamps, raw_values):
                    if not raw_val:
                        continue
                    records.append(
                        {
                            "datetime": ts,
                            "market": current_market,
                            "auction": auction_id,
                            "currency": currency,
                            "price": float(raw_val.replace(",", ".")),
                            "source_file": resource_name,
                        }
                    )
            i += 2  # skip the two data lines we just consumed

        elif line.startswith("Index volumes;"):
            # Volumes are not needed for a price table, so just step over
            # the two data lines that follow this header.
            i += 2

        i += 1

    return records


def download_and_parse_reports(report_items, pause_seconds=0.2):
    """
    Download and parse each report item. Returns (records, failures)
    instead of build_ni_price_table.py's print-and-continue, so a caller
    can decide whether it's safe to advance an ingestion watermark past a
    batch that had failures in it.

    A report can appear in the list (especially with
    ExcludeDelayedPublication=0, see get_new_ea001_reports) before its
    actual file is ready: the document URL then returns HTTP 200 with a
    body like {"errorMessage":"","code":0} instead of the CSV report —
    confirmed against several live "just published" reports that stayed
    in this state for minutes after listing. That's indistinguishable
    from "genuinely empty report" to parse_market_result_report (it just
    finds no matching blocks and returns []), so it's checked for
    explicitly here and treated as a failure rather than silently parsed
    as zero records — otherwise the caller would advance its watermark
    past a report that was never actually ingested, losing it for good.
    """
    records = []
    failures = []
    for item in report_items:
        resource_name = item["ResourceName"]
        try:
            response = requests.get(RESOURCE_BASE + resource_name, timeout=30)
            response.raise_for_status()
            if not response.text.lstrip().startswith("Auction;"):
                raise ValueError(f"report not yet available (got {response.text[:100]!r} instead of CSV)")
            records.extend(parse_market_result_report(response.text, resource_name))
        except Exception as error:
            failures.append((resource_name, str(error)))
        time.sleep(pause_seconds)  # light throttling, be polite to the API
    return records, failures


def pivot_records(records):
    """
    Reshape flat (datetime, market, auction, currency, price) records into
    one row per period/market/currency-pair, with separate price_eur and
    price_gbp columns — same pivot build_ni_price_table() does.
    """
    price_table = pd.DataFrame(records)
    if price_table.empty:
        return price_table

    price_table["datetime"] = pd.to_datetime(price_table["datetime"], utc=True)

    price_table = price_table.pivot_table(
        index=["datetime", "market", "auction", "source_file"],
        columns="currency",
        values="price",
        aggfunc="first",
    ).reset_index()

    price_table.columns.name = None
    price_table = price_table.rename(columns={"EUR": "price_eur", "GBP": "price_gbp"})

    # A report missing one currency block entirely (not seen in practice,
    # but not guaranteed by the format) would leave that column absent
    # rather than present-and-null, which breaks price_table_to_rows below.
    for col in ("price_eur", "price_gbp"):
        if col not in price_table.columns:
            price_table[col] = None

    price_table = price_table.sort_values("datetime").reset_index(drop=True)
    return price_table


def price_table_to_rows(price_table):
    """Convert a pivoted price table into dicts ready for a Supabase upsert."""
    rows = []
    for _, r in price_table.iterrows():
        rows.append(
            {
                "datetime": r["datetime"].isoformat(),
                "market": r["market"],
                "auction": r["auction"],
                "price_eur": None if pd.isna(r["price_eur"]) else float(r["price_eur"]),
                "price_gbp": None if pd.isna(r["price_gbp"]) else float(r["price_gbp"]),
                "source_file": r["source_file"],
            }
        )
    return rows


def parse_publish_time(value):
    """
    Parse a stored ingestion_state.last_publish_time watermark value into
    a tz-aware UTC pandas Timestamp — Supabase always returns it tz-aware
    (e.g. "2026-08-11T00:00:03+00:00"), but this also accepts a naive
    value so a watermark written before this module switched its
    watermark source from PublishTime to parse_resource_name_end_ts below
    (naive, e.g. "2026-08-11T00:00:03") still parses correctly; either
    way the *value itself* is just an ISO instant, format-agnostic about
    where it came from. Not used to parse a live API PublishTime value
    directly any more — see parse_resource_name_end_ts's own docstring
    for why that field can't be trusted for anything but the single most-
    recently-published report.
    """
    ts = pd.Timestamp(value)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


_RESOURCE_NAME_END_TS_RE = re.compile(r"_(\d{14})_(\d{14})\.csv$")


def parse_resource_name_end_ts(resource_name):
    """
    Extract the real report-generation/publish-completion instant
    embedded in ResourceName itself — e.g.
    "MarketResult_SEM-DA_PWR-MRC-D+1_20260814100000_20260814105501.csv"
    encodes a start timestamp (the auction's own reference/gate-closure
    time) and an end timestamp (20260814105501 = 2026-08-14 10:55:01),
    both UTC.

    This is the reliable alternative to the API's own PublishTime field.
    SEMOpx silently rewrites PublishTime to a clustered, non-chronological
    batch value for any report other than the single most-recently-
    published one — confirmed directly: PublishTime for 227 real SEM-DA
    reports (every day from 31 Dec 2025 onward) collapsed into a handful
    of near-identical early-UTC timestamps regardless of the reports'
    actual, wildly different true publish times, while this filename-
    embedded value matched the one report still fresh enough for the
    API's own PublishTime to (for now) also be genuine, to the second.

    Returns a tz-aware UTC pandas Timestamp — same type parse_publish_time
    returns, so both are directly comparable wherever a watermark or sort
    key is needed. Raises (rather than returning None) if resource_name
    doesn't match the expected pattern: every real EA-001 "Market Results"
    report observed follows it, so a mismatch means something about the
    report shape has genuinely changed and is worth surfacing loudly —
    this pipeline already fails loudly rather than silently advancing a
    watermark past data it can't actually account for (see
    download_and_parse_reports' own docstring for the same principle
    applied to a different failure mode).
    """
    match = _RESOURCE_NAME_END_TS_RE.search(resource_name)
    if not match:
        raise ValueError(f"ResourceName doesn't match the expected _<start>_<end>.csv pattern: {resource_name!r}")
    end_ts = match.group(2)
    iso = f"{end_ts[0:4]}-{end_ts[4:6]}-{end_ts[6:8]}T{end_ts[8:10]}:{end_ts[10:12]}:{end_ts[12:14]}Z"
    return pd.Timestamp(iso)
