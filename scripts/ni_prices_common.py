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

import time

import pandas as pd
import requests

API_URL = "https://reports.semopx.com/api/v1/documents/static-reports"
RESOURCE_BASE = "https://reports.semopx.com/documents/"

# Earliest date either script will ever ask the API for. Used as the
# backfill start date and as the incremental script's fallback when no
# watermark has been set yet.
DEFAULT_START_DATE = "2026-01-01"


def get_ea001_report_list(start_date, sort_by="Date", order_by="ASC", page_size=100):
    """
    Page through the SEMOpx report list for every EA-001 report published
    on or after start_date, returning the full list of report items.
    """
    items = []
    page = 1
    while True:
        params = {
            "DPuG_ID": "EA-001",
            "Date": f">={start_date}",
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
    """
    records = []
    failures = []
    for item in report_items:
        resource_name = item["ResourceName"]
        try:
            response = requests.get(RESOURCE_BASE + resource_name, timeout=30)
            response.raise_for_status()
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
    Parse a PublishTime value into a tz-aware UTC pandas Timestamp so
    SEMOpx API values (naive, e.g. "2026-08-11T00:00:03") and values read
    back from Supabase (tz-aware, e.g. "2026-08-11T00:00:03+00:00") are
    directly comparable. SEMOpx's PublishTime is UTC despite the missing
    suffix — the report files it lists always use an explicit "Z" for the
    same instants.
    """
    ts = pd.Timestamp(value)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
