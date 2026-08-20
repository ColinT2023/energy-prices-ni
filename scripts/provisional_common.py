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


# How many of yesterday's trailing periods to also check, alongside all of
# today. The main pipeline's own watermark can lag by a period or two even
# once a day has technically ended (the same trailing-edge pattern seen
# repeatedly with the official pipeline this session) — a day "finishing"
# doesn't guarantee its last periods actually got covered before it did.
# Confirmed directly against the live IST=1 endpoint that it still returns
# real values for periods whose delivery date has already passed (not
# scoped to in-flight/near-term auctions only), so there's a real gap here
# worth covering. Deliberately small and fixed, not a general lookback —
# this is specifically the trailing-edge gap, not a mechanism for reaching
# further back into history.
TRAILING_PERIODS_FROM_YESTERDAY = 4

# The London wall-clock hour after which "today" is safe to treat as
# genuinely covered by mere presence-of-any-auction, rather than requiring
# a real report-list check every run. Set past SEM-IDA3's own window close
# (17:00-22:30 London, confirmed invariant across 231 real historical days
# this session — zero exceptions) with 30 minutes of margin, not right at
# the edge, in case a specific day's report is a little late.
#
# Why this exists: the coverage check below only asks "does *any* auction's
# row exist for this period," not "does the *latest available* auction's
# row exist" — so once SEM-DA/IDA1/IDA2 alone happen to fill every period
# of today (very plausible on their own: IDA1 alone typically covers
# 44-48 of the day's 48 periods), nothing_left_to_poll() would return True
# and ingest_provisional.py would stop checking the report list for the
# rest of the day, silently missing SEM-IDA3 even once it publishes and is
# genuinely fetchable. Confirmed as a real, live case on 20 Aug 2026:
# SEM-IDA3 published 13:15 UTC, but provisional had already reached 48/48
# any-auction coverage for today, and no run touched the report list again
# until this fix. A single named constant, not inlined, since this depends
# on SEMOpx's real schedule staying consistent with what's been verified —
# adjust this one place if that ever changes.
TODAY_COVERAGE_SHORTCUT_HOUR_LONDON = 23


def _periods_covered(supabase, start_utc, end_utc):
    """Count of distinct settlement periods with at least one row, across
    ni_prices and ni_prices_provisional combined, in [start_utc, end_utc)."""
    start_iso = start_utc.isoformat()
    end_iso = end_utc.isoformat()

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
    return len({row["datetime"] for row in official.data} | {row["datetime"] for row in provisional.data})


def nothing_left_to_poll(supabase):
    """
    True if there's nothing this job could usefully add right now: every
    period of today (London) already has a row from somewhere, *and* so
    do the last TRAILING_PERIODS_FROM_YESTERDAY periods of yesterday.
    Doesn't matter which auction or which table a period's row came from,
    only that one exists — filling gaps is this job's entire purpose,
    keeping an already-covered period's value fresher against a later
    auction revision is not something it tries to do... with one
    exception: today specifically isn't considered coverable at all until
    TODAY_COVERAGE_SHORTCUT_HOUR_LONDON, since "any auction present" can't
    be trusted as "the latest auction present" while SEM-IDA3 could still
    publish (see that constant's own comment for why, and the real case
    that motivated it).

    Before the cutoff: always False, no query needed at all — the answer
    is already known without asking the database, which is strictly
    cheaper than the four small `select datetime` queries this used to
    always run. After the cutoff: same two `_periods_covered` checks as
    before, unchanged — this exists so a run can decide "nothing to do"
    without ever touching the report list or the IST=1 endpoint, so it
    stays cheap regardless of how tight the schedule interval is. (The
    report-fetching in ingest_provisional.py itself needs no matching
    change: it's driven by the official pipeline's watermark, not by
    date, so it already picks up yesterday's trailing-period reports
    whenever it does run — confirmed directly, that's exactly how Aug
    12's trailing periods ended up provisionally covered already.)
    """
    now_london = datetime.now(timezone.utc).astimezone(LONDON_TZ)
    if now_london.hour < TODAY_COVERAGE_SHORTCUT_HOUR_LONDON:
        return False

    today_start, today_end, today_periods = london_today_bounds()
    yesterday_trailing_start = today_start - timedelta(minutes=30 * TRAILING_PERIODS_FROM_YESTERDAY)

    return (
        _periods_covered(supabase, today_start, today_end) >= today_periods
        and _periods_covered(supabase, yesterday_trailing_start, today_start) >= TRAILING_PERIODS_FROM_YESTERDAY
    )


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


def _ist_timestamp_to_utc_iso(ts):
    """
    Convert one IST=1 Index-prices timestamp to a proper UTC ISO string.

    These timestamps are naive (no "Z"), and were previously assumed UTC
    on the theory that this API family's fields are UTC despite the
    missing suffix — true for PublishTime (see
    ni_prices_common.parse_publish_time), but confirmed WRONG for this
    field specifically: fetching the IST=1 JSON for an already-published
    report and comparing it against that same report's official CSV
    (whose Index-prices timestamps carry an explicit, genuine "Z") shows
    the same price value sitting under a JSON timestamp exactly one hour
    ahead of its true UTC timestamp during BST. So these are actually
    Europe/London *local* wall-clock time. Converted properly via
    zoneinfo (not a hardcoded hour offset) so this stays correct across
    the DST boundary too.
    """
    if ts.endswith("Z"):
        return ts
    local = datetime.fromisoformat(ts).replace(tzinfo=LONDON_TZ)
    return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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
                            "datetime": _ist_timestamp_to_utc_iso(ts),
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
