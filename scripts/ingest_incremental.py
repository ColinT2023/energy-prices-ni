"""
Incremental EA-001 ingestion — run every 30 minutes by
.github/workflows/ingest.yml. Reads the last processed watermark from
ingestion_state, fetches only reports published after it, upserts their NI
price rows into Supabase, and advances the watermark.

If any report in this run fails to download or parse, the watermark is NOT
advanced, so the whole batch (including reports that did succeed) is
retried on the next run. That's safe rather than wasteful: ni_prices is
upserted on (datetime, market), so re-processing an already-ingested report
just overwrites its rows with the same values.

In practice this means a single persistently-unavailable SEMOpx report
(listed on their report API but not yet downloadable — see
download_and_parse_reports' "report not yet available" case) freezes the
watermark, and therefore all forward progress, until it resolves. Observed
over 13-18 Aug 2026: this happens roughly once a day, usually clearing
within ~24h but at least once taking ~39.5h (see README.md's "Known
pattern" section for the actual gap measurements and the trade-off
reasoning against building a skip/bypass for it) — not a bug, and not
something to "fix" by skipping ahead without re-reading that section
first.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment —
set as GitHub Actions secrets in CI, or in scripts/.env for a local run.
"""

import os

from dotenv import load_dotenv
from supabase import create_client

from ni_prices_common import (
    download_and_parse_reports,
    get_new_ea001_reports,
    latest_end_ts,
    pivot_records,
    price_table_to_rows,
)


def main():
    load_dotenv()
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    state = supabase.table("ingestion_state").select("last_publish_time").eq("id", 1).single().execute()
    watermark = state.data["last_publish_time"]

    new_items = get_new_ea001_reports(watermark)

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

    # The *maximum* end timestamp across new_items, not new_items[-1] —
    # list order isn't reliably end-timestamp order (see
    # get_new_ea001_reports' docstring), so the last item isn't
    # necessarily the most recent one. Derived from each report's
    # filename-embedded timestamp, not the API's PublishTime field — see
    # parse_resource_name_end_ts's docstring for why PublishTime can't be
    # trusted here. Using it to advance the watermark was exactly what
    # silently left ingestion stuck for hours despite every scheduled run
    # reporting success.
    new_watermark = latest_end_ts(new_items).isoformat()
    supabase.table("ingestion_state").update({"last_publish_time": new_watermark}).eq("id", 1).execute()
    print(f"Watermark advanced to {new_watermark}.")


if __name__ == "__main__":
    main()
