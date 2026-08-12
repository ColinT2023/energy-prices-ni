"""
NI energy price table builder
------------------------------
Pulls every EA-001 (ETS Market Results) report from the SEMOpx Website
Report API since 2026-01-01, parses the NI-* market blocks and assembles
a single pandas DataFrame of half hourly Northern Ireland auction prices
in both EUR and GBP.

Report file format (confirmed from a live sample on 2026-08-12):

    Auction;SEM-IDA2
    Auction name;PWR-SEM-GB-D
    Auction date time;2026-08-11T07:00:00Z
    Publication date time;2026-08-11T07:30:00Z
    FX rates
    EUR;GBP;0,85631101
    Market;NI-IDA2
    Index prices;30;EUR
    2026-08-11T10:00:00Z;2026-08-11T10:30:00Z;...
    132,32;118,30;123,86;...
    Index prices;30;GBP
    2026-08-11T10:00:00Z;2026-08-11T10:30:00Z;...
    113,31;101,30;106,06;...
    Index volumes;30
    2026-08-11T10:00:00Z;...
    <volumes>
    Market;ROI-IDA2
    ...

Each file repeats this pattern for both the NI and ROI market areas.
Values use a comma as the decimal separator, so these are converted to
floats explicitly. Volumes are skipped for now since the brief only
asked for prices; the block is detected and stepped over.
"""

import time
import requests
import pandas as pd

API_URL = "https://reports.semopx.com/api/v1/documents/static-reports"
RESOURCE_BASE = "https://reports.semopx.com/documents/"

START_DATE = "2026-01-01"


def get_ea001_report_list(start_date):
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
            "page_size": 100,
            "sort_by": "Date",
            "order_by": "ASC",
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


def build_ni_price_table(start_date=START_DATE, pause_seconds=0.2):
    """
    Download and parse every EA-001 report since start_date, returning a
    single pandas DataFrame of NI half hourly prices with one row per
    period/market/currency combination.
    """
    report_items = get_ea001_report_list(start_date)
    print(f"Found {len(report_items)} EA-001 reports from {start_date} onwards.")

    all_records = []
    for n, item in enumerate(report_items, start=1):
        resource_name = item["ResourceName"]
        try:
            response = requests.get(RESOURCE_BASE + resource_name, timeout=30)
            response.raise_for_status()
            all_records.extend(parse_market_result_report(response.text, resource_name))
        except Exception as error:
            # Skip a bad/missing file rather than losing the whole run,
            # but keep a note of it so gaps can be investigated.
            print(f"  Skipped {resource_name}: {error}")

        if n % 50 == 0:
            print(f"  Processed {n}/{len(report_items)} reports...")

        time.sleep(pause_seconds)  # light throttling, be polite to the API

    price_table = pd.DataFrame(all_records)

    if price_table.empty:
        print("No NI records were parsed. Check the market prefix or report format.")
        return price_table

    price_table["datetime"] = pd.to_datetime(price_table["datetime"], utc=True)

    # Reshape so each half hourly period/auction/market has one row with
    # separate EUR and GBP price columns, which is easier to work with.
    price_table = price_table.pivot_table(
        index=["datetime", "market", "auction", "source_file"],
        columns="currency",
        values="price",
        aggfunc="first",
    ).reset_index()

    price_table.columns.name = None
    price_table = price_table.rename(columns={"EUR": "price_eur", "GBP": "price_gbp"})
    price_table = price_table.sort_values("datetime").reset_index(drop=True)

    return price_table


if __name__ == "__main__":
    ni_prices = build_ni_price_table()
    print(f"\nBuilt table with {len(ni_prices)} rows.")
    print(ni_prices.head())

    output_path = "ni_energy_prices_2026.csv"
    ni_prices.to_csv(output_path, index=False)
    print(f"\nSaved to {output_path}")
