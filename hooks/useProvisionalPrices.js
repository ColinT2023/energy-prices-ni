"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const POLL_MS = 60000;

/**
 * Fetches ni_prices_provisional_banded rows within `range`, only when
 * `enabled` is true. Deliberately much simpler than useNiPrices: this is a
 * secondary, experimental feed a backend job itself only refreshes every
 * few minutes, polled on a plain interval rather than a realtime
 * subscription — no reconnect/coalescing machinery needed for something
 * this size, and callers gate `enabled` on both the toggle being on *and*
 * the day being viewed being today (see PriceRing/PriceHistorySection),
 * so this never fetches for a scope the feature doesn't apply to.
 */
export function useProvisionalPrices(enabled, range) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!enabled || !supabase || !range) {
      setRows([]);
      return;
    }

    let cancelled = false;

    async function fetchRows() {
      // range.to is null for "7 day"/"full" (open-ended), but set for
      // "today"/"tomorrow"/custom (see lib/priceRange.js) — bounded the
      // same way here as in useNiPrices, so provisional rows never leak
      // past whichever boundary the active scope actually has.
      let query = supabase
        .from("ni_prices_provisional_banded")
        .select("*")
        .gte("datetime", range.from)
        .order("datetime", { ascending: true });
      if (range.to) query = query.lt("datetime", range.to);
      const { data } = await query;
      if (!cancelled) setRows(data ?? []);
    }

    fetchRows();
    const interval = setInterval(fetchRows, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, range]);

  return rows;
}
