"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// PostgREST (Supabase's REST layer) caps a single request at 1,000 rows by
// default, silently — no error, no truncation flag, just fewer rows than
// actually match. "All time" (and any Custom range spanning more than
// ~7-8 days at this app's ~132 rows/day) exceeds that in one request, so
// every caller of this hook pages through until a page comes back short,
// rather than trusting a single request to be complete.
//
// Pagination is by keyset (datetime, market), not OFFSET (.range()) —
// confirmed directly against the live database that OFFSET fails once it
// gets a few pages deep: ni_prices_banded computes a trailing-7-day
// aggregate per row via a LATERAL join, and OFFSET makes Postgres run that
// for every skipped row before applying the limit, not just the ones
// actually returned. Past ~12,000 skipped rows this exceeded the
// statement timeout (PostgREST error 57014) and the request failed
// outright — worse than the 1,000-row cap it would've replaced. Filtering
// by "datetime, market) > last-seen" instead lets Postgres seek straight
// to the next page via the existing datetime index, so it only ever pays
// the LATERAL cost for rows actually returned. (datetime, market) is used
// as the cursor, not datetime alone, because ni_prices' unique constraint
// is on that pair — several rows can share one datetime (one per
// auction), and datetime alone as a cursor could silently skip whichever
// of those rows didn't make it into a page.
const PAGE_SIZE = 1000;

async function fetchAllRows(range) {
  const rows = [];
  let cursor = null; // { datetime, market } of the last row from the previous page
  for (;;) {
    let query = supabase
      .from("ni_prices_banded")
      .select("*")
      .gte("datetime", range.from)
      .order("datetime", { ascending: true })
      .order("market", { ascending: true })
      .limit(PAGE_SIZE);
    if (range.to) query = query.lt("datetime", range.to);
    if (cursor) {
      query = query.or(`datetime.gt.${cursor.datetime},and(datetime.eq.${cursor.datetime},market.gt.${cursor.market})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    const last = data[data.length - 1];
    cursor = { datetime: last.datetime, market: last.market };
  }
  return rows;
}

/** `{from, to}` -> a stable string key, so ranges that are *equal* but not
 * the *same object* (e.g. tomorrowRange()'s cached-by-date result versus
 * a range recomputed from scratch) are recognised as the same range for
 * caching purposes. `null` stays `null` — nothing to key. */
function rangeCacheKey(range) {
  return range ? `${range.from}|${range.to ?? ""}` : null;
}

/**
 * Fetches ni_prices_banded rows within `range` ({from, to}, `to` optional
 * for an open-ended "through now" window — see lib/priceRange.js) and
 * keeps them live via a Supabase realtime subscription. The range is
 * always applied at the query level (.gte/.lt), never fetched in full and
 * filtered client-side — ni_prices only grows over time, so an unscoped
 * fetch would get slower every day regardless of what's on screen.
 *
 * `range` must be a value the caller keeps referentially stable across
 * renders unless its actual bounds changed (e.g. via useMemo) — it's a
 * direct effect dependency. Pass `null` for "not ready to fetch yet"
 * (e.g. a custom range with one date still unset); rows stay empty and no
 * query is made.
 *
 * Realtime events trigger a full re-fetch of the current range rather
 * than patching the changed row in place. ni_prices_banded computes each
 * row's band from a trailing 7 day average, so a single new row can shift
 * the band of other already-loaded rows too — a single-row patch would
 * leave those stale on screen, so the whole window is re-pulled instead.
 * That also means reconnecting after a dropped connection needs no gap
 * reconciliation: the next successful fetch is already complete.
 *
 * Every range this hook instance has ever successfully fetched stays
 * cached (by value, see rangeCacheKey — not by object reference) for the
 * lifetime of the component. Switching to a range currently isn't null
 * but was previously seen (e.g. PriceRing revisiting an already-browsed
 * day, or PriceHistorySection's tomorrowRangeValue going null whenever
 * scope leaves "today" and back once it returns) restores those cached
 * rows immediately, rather than clearing to empty and making the caller
 * wait through a full network round trip to see anything — confirmed
 * live this was adding a real, measurable ~250-600ms of visible lag to
 * returning to Today. A fetch is still always kicked off below
 * regardless of whether the cache hit — this is deliberately stale-
 * *while*-revalidate, not stale-instead-of-fresh: the realtime
 * subscription that would normally have kept a range's data current
 * doesn't exist while that range isn't the active one (nothing to
 * subscribe *for*), so a cache hit alone can't promise the data is
 * still accurate, only that it's a reasonable, instant placeholder
 * while the real answer is confirmed in the background. Unbounded, not
 * evicted: the number of distinct ranges one component instance cycles
 * through in a session (a handful of scope buttons, or days browsed one
 * at a time) is far too small for this to matter memory-wise.
 */
export function useNiPrices(range) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const channelRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  // { inFlight, pending } for the *current* range — reassigned to a fresh
  // object whenever range changes (in the effect below), so a still-
  // running fetch from a range that's since changed operates on its own
  // orphaned object and can't affect the new range's tracking.
  const flightRef = useRef({ inFlight: false, pending: false });
  const cacheRef = useRef(new Map());

  const fetchRows = useCallback(async () => {
    if (!supabase) {
      setError("Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
      setLoading(false);
      return;
    }

    if (!range) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Several things can ask for a fresh fetch in quick succession: the
    // realtime channel's own "catch up once subscribed" call landing
    // right after the initial mount fetch, a postgres_changes event
    // arriving mid-fetch, a tab regaining visibility. Each is a reason to
    // be *current*, not a reason to run a whole separate fetch — a second
    // concurrent All-time pass alone doubled this hook's network cost
    // (30 pages became ~59 requests). If a fetch is already running, this
    // call is recorded as pending instead of starting its own; the
    // in-flight fetch runs once more right after it finishes, so whatever
    // the pending call was reacting to still gets picked up — coalesced
    // into one trailing fetch rather than dropped or run in parallel.
    const flight = flightRef.current;
    if (flight.inFlight) {
      flight.pending = true;
      return;
    }
    flight.inFlight = true;

    // No setLoading(true) here: this is called directly from an effect
    // body (both on mount and on range change), and setting state
    // synchronously before the first await in that path triggers React's
    // cascading-render warning. `loading` starts true for the initial
    // mount and simply isn't reset for later range changes — the old
    // range's rows stay on screen until the new ones arrive, which reads
    // better than a flash back to a loading state anyway.
    try {
      const data = await fetchAllRows(range);
      setRows(data);
      setError(null);
      cacheRef.current.set(rangeCacheKey(range), data);
    } catch (fetchError) {
      setError(fetchError.message);
    }
    setLoading(false);

    flight.inFlight = false;
    if (flight.pending) {
      flight.pending = false;
      fetchRows();
    }
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    // Whether the channel has completed at least one SUBSCRIBED before —
    // gates the catch-up fetch below (see openChannel) so it only fires
    // on a genuine *re*connect, not the very first connect.
    let hasConnectedBefore = false;
    flightRef.current = { inFlight: false, pending: false };

    // Restore a previously-fetched range's rows immediately, before the
    // fresh fetch below has any chance to resolve — see the cache
    // paragraph in this hook's own doc comment for why. Deliberately
    // does nothing for a cache miss (rows are simply left as whatever
    // the previous range's were, same as always) and never touches
    // `loading`, so the existing "old data stays on screen until new
    // data arrives" behaviour is unchanged for a genuinely new range —
    // this only ever makes what's already showing more accurate sooner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (range && cacheRef.current.has(rangeCacheKey(range))) {
      setRows(cacheRef.current.get(rangeCacheKey(range)));
    }

    // fetchRows's setState calls all happen after its first `await`, so
    // this isn't a synchronous setState during render — but the static
    // reachability check behind this rule doesn't model async control
    // flow and can't tell the difference, hence the disable below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows();

    // Nothing to subscribe to without a configured client, or without an
    // active range (e.g. Custom selected but no dates picked yet) — a
    // null range means fetchRows() above already just cleared rows and
    // returned, so there's no query result a realtime subscription would
    // ever need to keep in sync. Returning here before openChannel()
    // skips channel setup entirely rather than opening one anyway and
    // immediately having nothing for it to do.
    if (!supabase || !range) return;

    function openChannel() {
      if (cancelled) return;
      // Date.now() alone can collide within the same millisecond when
      // React StrictMode double-invokes this effect in dev (mount ->
      // cleanup -> mount, synchronously) — if removeChannel() from the
      // cleanup hasn't fully unregistered the old channel by the time the
      // second mount calls supabase.channel() with the same name,
      // supabase-js can hand back the *same* already-subscribed channel
      // object, and calling .on() on it then throws "cannot add
      // postgres_changes callbacks ... after subscribe()". The random
      // suffix makes that name collision impossible.
      const ch = supabase
        .channel(`ni-prices-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "ni_prices" },
          () => {
            if (!cancelled) fetchRows();
          }
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            clearTimeout(reconnectTimerRef.current);
            // Only fetch here on a *re*connect. The very first SUBSCRIBED
            // fires milliseconds after the effect's own direct fetchRows()
            // call above, for the same range — there's no gap for
            // anything to have gone missing yet, so re-fetching here too
            // was pure duplicate work (confirmed live: it doubled All
            // time's ~11s load to ~22s, run sequentially thanks to the
            // in-flight coalescing above, or ~59 concurrent requests
            // without it). A real reconnect after a dropped connection is
            // exactly when something could genuinely have been missed,
            // so the catch-up still runs then.
            if (hasConnectedBefore) fetchRows();
            hasConnectedBefore = true;
          } else {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = setTimeout(() => {
              if (cancelled) return;
              if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
              }
              openChannel();
            }, 5000);
          }
        });
      channelRef.current = ch;
    }

    openChannel();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") fetchRows();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(reconnectTimerRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [range, fetchRows]);

  return { rows, loading, error, refetch: fetchRows };
}
