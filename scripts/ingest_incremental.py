"""
Incremental EA-001 ingestion — run every 30 minutes by
.github/workflows/ingest.yml. Reads the last processed PublishTime from
ingestion_state, fetches only reports published after it, upserts their NI
price rows into Supabase, and advances the watermark.

If any report in this run fails to download or parse, the watermark is NOT
advanced, so the whole batch (including reports that did succeed) is
retried on the next run. That's safe rather than wasteful: ni_prices is
upserted on (datetime, market), so re-processing an already-ingested report
just overwrites its rows with the same values.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment —
set as GitHub Actions secrets in CI, or in scripts/.env for a local run.
"""

import os

from dotenv import load_dotenv
from supabase import create_client

from ni_prices_common import (
    DEFAULT_START_DATE,
    download_and_parse_reports,
    get_ea001_report_list,
    parse_publish_time,
    pivot_records,
    price_table_to_rows,
)


def main():
    load_dotenv()
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    state = supabase.table("ingestion_state").select("last_publish_time").eq("id", 1).single().execute()
    watermark = state.data["last_publish_time"]

    # The API's Date filter is date-only, so this is a coarse pre-filter —
    # precise PublishTime filtering happens below in Python.
    query_start_date = watermark[:10] if watermark else DEFAULT_START_DATE
    all_items = get_ea001_report_list(query_start_date, sort_by="PublishTime", order_by="ASC")

    watermark_ts = parse_publish_time(watermark) if watermark else None
    new_items = [
        item for item in all_items
        if watermark_ts is None or parse_publish_time(item["PublishTime"]) > watermark_ts
    ]

    if not new_items:
        print(f"No new EA-001 reports since watermark {watermark or '(none)'}.")
        return

    print(f"Found {len(new_items)} new EA-001 report(s) since {watermark or 'the beginning'}.")

    records, failures = download_and_parse_reports(new_items)

    price_table = pivot_records(records)
    if not price_table.empty:
        rows = price_table_to_rows(price_table)
        supabase.table("ni_prices").upsert(rows, on_conflict="datetime,market").execute()
        print(f"Upserted {len(rows)} row(s) into ni_prices.")
    else:
        print("No NI price rows parsed from this batch.")

    if failures:
        print(f"WARNING: {len(failures)} report(s) failed and will be retried next run:")
        for resource_name, error in failures:
            print(f"  {resource_name}: {error}")
        return

    new_watermark = new_items[-1]["PublishTime"]
    supabase.table("ingestion_state").update({"last_publish_time": new_watermark}).eq("id", 1).execute()
    print(f"Watermark advanced to {new_watermark}.")


if __name__ == "__main__":
    main()
