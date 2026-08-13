"""
Fetch + parse helpers for SEMOpx's undocumented per-report JSON endpoint —
https://reports.sem-o.com/api/v1/documents/{_id}?IST=1 — which can return a
report's fully parsed contents before its official static-report CSV exists
(see ni_prices_common.py's module docstring for how this was found and
confirmed). Kept in its own module, not added to ni_prices_common.py:
this is a different, undocumented data source with its own response shape,
used only by ingest_provisional.py — the official backfill/incremental
pipeline never touches it.

Deliberately not integrated into the official pipeline. See
ingest_provisional.py for the kill switch and failure handling this
unofficial dependency needs that the official pipeline doesn't.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

IST_DOCUMENT_URL = "https://reports.sem-o.com/api/v1/documents/{doc_id}?IST=1"
LONDON_TZ = ZoneInfo("Europe/London")


def london_today_bounds(now_utc=None):
    """
    (day_start_utc, day_end_utc, expected_periods) for "today" in
    Europe/London. expected_periods comes from actual elapsed time between
    local midnights, not assumed to be 48, so this stays correct on the
    two UK clock-change days (46 in spring, 50 in autumn) — same idea as
    lib/londonTime.js's periodsInLondonDay on the frontend, reimplemented
    here since the ingestion scripts don't share code with the Next.js app.
    """
    now_utc = now_utc or datetime.now(timezone.utc)
    now_london = now_utc.astimezone(LONDON_TZ)
    today_midnight_local = now_london.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_midnight_local = (today_midnight_local + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    day_start_utc = today_midnight_local.astimezone(timezone.utc)
    day_end_utc = tomorrow_midnight_local.astimezone(timezone.utc)
    expected_periods = round((day_end_utc - day_start_utc).total_seconds() / 1800)
    return day_start_utc, day_end_utc, expected_periods


def today_fully_covered(supabase):
    """
    True if every settlement period of today (London) already has at
    least one row across ni_prices and ni_prices_provisional combined —
    doesn't matter which auction or which table it came from, only that
    a row exists. Filling gaps is this job's entire purpose; keeping an
    already-covered period's provisional value fresher against a later
    auction revision is not something it tries to do, so once every
    period has *a* row, there's nothing left to gain by polling further
    until tomorrow's periods start needing coverage.

    Two small `select datetime` queries — this exists specifically so a
    run can decide "nothing to do" without ever touching the report list
    or the IST=1 endpoint, so it stays cheap regardless of how tight the
    schedule interval is.
    """
    day_start_utc, day_end_utc, expected_periods = london_today_bounds()
    start_iso = day_start_utc.isoformat()
    end_iso = day_end_utc.isoformat()

    official = (
        supabase.table("ni_prices")
        .select("datetime")
        .gte("datetime", start_iso)
        .lt("datetime", end_iso)
        .execute()
    )
    provisional = (
        supabase.table("ni_prices_provisional")
        .select("datetime")
        .gte("datetime", start_iso)
        .lt("datetime", end_iso)
        .execute()
    )

    covered = {row["datetime"] for row in official.data} | {row["datetime"] for row in provisional.data}
    return len(covered) >= expected_periods


def fetch_ist_document(doc_id, timeout=30):
    """
    Fetch one report's parsed contents via the IST=1 endpoint. Returns the
    parsed JSON dict, or None if the request fails, the response isn't
    JSON, or it doesn't have the expected "rows" list — every one of
    those is treated as "no provisional data available for this report
    right now" by the caller, not an error to raise. This endpoint is
    undocumented and could change shape or disappear without notice;
    nothing here should ever be able to take down the provisional
    ingestion job, let alone the official one.
    """
    try:
        response = requests.get(IST_DOCUMENT_URL.format(doc_id=doc_id), timeout=timeout)
        response.raise_for_status()
        doc = response.json()
    except Exception:
        return None
    if not isinstance(doc.get("rows"), list):
        return None
    return doc


def parse_ist_document(doc):
    """
    Extract NI-market price records from an IST=1 document — the JSON
    equivalent of what parse_market_result_report (ni_prices_common.py)
    extracts from the raw CSV: only NI-prefixed markets, only "Index
    prices" blocks (EUR and GBP), everything else (Index volumes, Net
    position, Default blocks) ignored, same as the CSV parser.

    doc["rows"] is a list of market blocks. Each block is a flat list
    where a ["Market", name] pair sets which market subsequent entries
    belong to, and a ["Index prices", periods, currency] header is
    immediately followed by a timestamps array and a values array. Other
    header types (Index volumes, Net position, Default blocks) have
    different shapes — rather than tracking each one's exact element
    count to skip over it, this just scans every entry and only acts on
    the two patterns it recognises (Market, Index prices), which is
    simpler and can't be thrown off by a shape it doesn't know about.
    """
    records = []
    auction_id = None
    for pair in doc.get("AreaSet") or []:
        if isinstance(pair, list) and len(pair) == 2 and pair[0] == "Auction":
            auction_id = pair[1]

    resource_name = doc.get("ResourceName")

    for block in doc.get("rows") or []:
        current_market = None
        i = 0
        n = len(block)
        while i < n:
            entry = block[i]

            if isinstance(entry, list) and len(entry) == 2 and entry[0] == "Market":
                current_market = entry[1]
                i += 1
                continue

            if (
                isinstance(entry, list)
                and len(entry) == 3
                and entry[0] == "Index prices"
                and current_market
                and current_market.startswith("NI")
                and i + 2 < n
            ):
                currency = entry[2]
                timestamps = block[i + 1]
                values = block[i + 2]
                for ts, val in zip(timestamps, values):
                    if val is None:
                        continue
                    records.append(
                        {
                            # Naive, no "Z" suffix, but UTC despite that —
                            # same pattern already confirmed for this API
                            # family's PublishTime (see
                            # ni_prices_common.parse_publish_time).
                            "datetime": ts if ts.endswith("Z") else ts + "Z",
                            "market": current_market,
                            "auction": auction_id,
                            "currency": currency,
                            "price": float(val),
                            "source_file": resource_name,
                        }
                    )
                i += 3
                continue

            i += 1

    return records
