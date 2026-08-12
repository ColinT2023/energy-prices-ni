"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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
 */
export function useNiPrices(range) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const channelRef = useRef(null);
  const reconnectTimerRef = useRef(null);

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

    // No setLoading(true) here: this is called directly from an effect
    // body (both on mount and on range change), and setting state
    // synchronously before the first await in that path triggers React's
    // cascading-render warning. `loading` starts true for the initial
    // mount and simply isn't reset for later range changes — the old
    // range's rows stay on screen until the new ones arrive, which reads
    // better than a flash back to a loading state anyway.
    let query = supabase
      .from("ni_prices_banded")
      .select("*")
      .gte("datetime", range.from)
      .order("datetime", { ascending: true });
    if (range.to) query = query.lt("datetime", range.to);

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setRows(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => {
    let cancelled = false;

    // fetchRows's setState calls all happen after its first `await`, so
    // this isn't a synchronous setState during render — but the static
    // reachability check behind this rule doesn't model async control
    // flow and can't tell the difference, hence the disable below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows();

    if (!supabase) return; // nothing to subscribe to without a configured client

    function openChannel() {
      if (cancelled) return;
      const ch = supabase
        .channel(`ni-prices-${Date.now()}`)
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
            fetchRows(); // catch up on anything missed while (re)connecting
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
