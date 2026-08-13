"""
Provisional ingestion — polls SEMOpx's undocumented IST=1 endpoint for
whichever EA-001 reports the *official* pipeline (ingest_incremental.py)
hasn't ingested yet, and writes anything usable into ni_prices_provisional.
Entirely separate from the official pipeline: this script never writes to
ni_prices or ingestion_state, only reads the watermark from the latter to
know which reports are still pending.

This is unofficial by design — see provisional_common.py and
supabase/schema.sql's ni_prices_provisional comment for the full context.
Two things follow from that:

1. Kill switch: set PROVISIONAL_INGESTION_ENABLED=false (a GitHub Actions
   repo variable, not a secret — it's not sensitive) to stop this job from
   doing anything at all, without a code deploy. Defaults to enabled.
2. Fails soft, always: anything going wrong here — the endpoint changing
   shape, disappearing, timing out — is caught, logged, and the job exits
   0 having simply written nothing this cycle. It must never fail loudly
   enough to look like a real incident, and must never touch the official
   tables, so there's no path from this script back to the main site
   breaking.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, same as
ingest_incremental.py.
"""

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

from ni_prices_common import get_new_ea001_reports, pivot_records, price_table_to_rows
from provisional_common import fetch_ist_document, parse_ist_document, today_fully_covered


def enabled():
    value = os.environ.get("PROVISIONAL_INGESTION_ENABLED", "true").strip().lower()
    return value not in ("false", "0", "no", "off")


def run():
    load_dotenv()
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Cheap coverage check first, before anything that touches the report
    # list or the IST=1 endpoint — most triggers under a tight schedule
    # should land here and exit immediately, since there's nothing to gain
    # once every period of today already has a row from somewhere.
    if today_fully_covered(supabase):
        print("Today's settlement periods are already fully covered (official + provisional) — nothing to do.")
        return

    state = supabase.table("ingestion_state").select("last_publish_time").eq("id", 1).single().execute()
    watermark = state.data["last_publish_time"]

    # Same candidate set the official pipeline is waiting on — anything
    # newer than the watermark that hasn't landed in ni_prices yet. Most
    # of these will still be genuinely unavailable even via IST=1; that's
    # expected and not a failure, just nothing to add this cycle.
    candidates = get_new_ea001_reports(watermark)
    print(f"Checking {len(candidates)} pending report(s) for provisional data.")

    records = []
    hits = 0
    for item in candidates:
        doc = fetch_ist_document(item["_id"])
        if doc is None:
            continue
        parsed = parse_ist_document(doc)
        if parsed:
            hits += 1
            records.extend(parsed)

    print(f"{hits} of {len(candidates)} pending report(s) had usable provisional data.")

    price_table = pivot_records(records)
    if price_table.empty:
        print("No provisional NI price rows this cycle.")
        return

    rows = price_table_to_rows(price_table)
    for row in rows:
        row.pop("source_file", None)  # not part of ni_prices_provisional's schema

    CHUNK_SIZE = 500
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        supabase.table("ni_prices_provisional").upsert(chunk, on_conflict="datetime,market,auction").execute()
    print(f"Upserted {len(rows)} provisional row(s).")


def main():
    if not enabled():
        print("PROVISIONAL_INGESTION_ENABLED is off — skipping (kill switch).")
        return
    try:
        run()
    except Exception as error:
        # Never propagate — an undocumented endpoint changing shape or
        # disappearing is an expected possibility, not an incident.
        print(f"Provisional ingestion failed this cycle, skipping: {error}")


if __name__ == "__main__":
    main()
    sys.exit(0)
