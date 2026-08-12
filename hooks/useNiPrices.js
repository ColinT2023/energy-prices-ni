"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { londonDayStart } from "../lib/londonTime";

const FULL_SEASON_START = "2026-01-01T00:00:00Z";
const SCOPE_DAYS = { today: 1, "7day": 7 };

function scopeStartDate(scope) {
  const days = SCOPE_DAYS[scope];
  if (!days) return FULL_SEASON_START; // 'full'
  // "Today"/"7 day" are NI-local-day boundaries, not UTC ones — using UTC
  // midnight here would put the window an hour off for half the year
  // during BST.
  return londonDayStart(days - 1).toISOString();
}

/**
 * Fetches ni_prices_banded rows for the given scope ('today' | '7day' |
 * 'full') and keeps them live via a Supabase realtime subscription.
 *
 * Realtime events trigger a full re-fetch of the current scope rather than
 * patching the changed row in place. ni_prices_banded computes each row's
 * band from a trailing 7 day average, so a single new row can shift the
 * band of other already-loaded rows too — a single-row patch would leave
 * those stale on screen, so the whole window is re-pulled instead. That
 * also means reconnecting after a dropped connection needs no gap
 * reconciliation: the next successful fetch is already complete.
 */
export function useNiPrices(scope = "today") {
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

    // No setLoading(true) here: this is called directly from an effect
    // body (both on mount and on scope change), and setting state
    // synchronously before the first await in that path triggers React's
    // cascading-render warning. `loading` starts true for the initial
    // mount and simply isn't reset for later scope changes — the old
    // scope's rows stay on screen until the new ones arrive, which reads
    // better than a flash back to a loading state anyway.
    const { data, error: fetchError } = await supabase
      .from("ni_prices_banded")
      .select("*")
      .gte("datetime", scopeStartDate(scope))
      .order("datetime", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setRows(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, [scope]);

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
        .channel(`ni-prices-${scope}-${Date.now()}`)
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
  }, [scope, fetchRows]);

  return { rows, loading, error, refetch: fetchRows };
}
