"""
One-off backfill: pulls every EA-001 report since ni_prices_common's
DEFAULT_START_DATE, parses the NI market blocks, and upserts the full
result into Supabase. Run this once locally after the Supabase schema
exists (see supabase/README.md); ingest_incremental.py takes over from
where this leaves off, on a 30 minute schedule via GitHub Actions.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — either exported in
the shell or set in scripts/.env (see scripts/.env.example).
"""

import os

from dotenv import load_dotenv
from supabase import create_client

from ni_prices_common import (
    DEFAULT_START_DATE,
    download_and_parse_reports,
    get_ea001_report_list,
    latest_end_ts,
    pivot_records,
    price_table_to_rows,
)

UPSERT_CHUNK_SIZE = 500


def main():
    load_dotenv()
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Sort order here doesn't affect which reports get fetched (this pulls
    # the full unconditional history, no early-stop) or the watermark
    # computed below: that's the *maximum* end timestamp across every
    # fetched item (latest_end_ts), not "whichever item sorts last",
    # since a day-ahead report's Date (its delivery day, one day ahead of
    # when it was actually generated) doesn't reliably sort last just
    # because it's the most recently generated. Kept as Date/ASC
    # (get_ea001_report_list's own default) as a reasonable, readable
    # choice, not because anything here still depends on it.
    report_items = get_ea001_report_list(DEFAULT_START_DATE, sort_by="Date", order_by="ASC")
    print(f"Found {len(report_items)} EA-001 reports from {DEFAULT_START_DATE} onwards.")

    records, failures = download_and_parse_reports(report_items)
    print(f"Parsed {len(records)} NI price records ({len(failures)} report(s) failed).")
    for resource_name, error in failures:
        print(f"  Skipped {resource_name}: {error}")

    price_table = pivot_records(records)
    if price_table.empty:
        print("No NI records were parsed. Check the market prefix or report format.")
        return

    rows = price_table_to_rows(price_table)
    for i in range(0, len(rows), UPSERT_CHUNK_SIZE):
        chunk = rows[i : i + UPSERT_CHUNK_SIZE]
        supabase.table("ni_prices").upsert(chunk, on_conflict="datetime,market").execute()
        print(f"  Upserted rows {i + 1}-{i + len(chunk)} of {len(rows)}")

    if failures:
        print(
            "Some reports failed — leaving the ingestion_state watermark unset "
            "so the scheduled workflow retries the whole date range on its "
            "first run rather than silently skipping the gap."
        )
        return

    watermark = latest_end_ts(report_items).isoformat() if report_items else None
    if watermark:
        supabase.table("ingestion_state").update({"last_publish_time": watermark}).eq("id", 1).execute()
        print(f"Initial watermark set to {watermark}.")


if __name__ == "__main__":
    main()
