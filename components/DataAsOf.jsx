"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatLondonFullDateTime } from "../lib/londonTime";

/**
 * "Prices available through <latest settlement period>", kept live via
 * its own realtime subscription on ni_prices — deliberately independent
 * of the Ring/chart's own subscriptions rather than threaded through
 * useNiPrices, since this only ever needs a single MAX(datetime) value,
 * not a scoped row set.
 *
 * Reads max(datetime) — the latest settlement period actually covered by
 * the data — not max(inserted_at), which is when a row was written to
 * the table. Those can diverge a lot: right after a backfill,
 * inserted_at is "just now" for every row regardless of how old the
 * priced periods are, which read as "data as of today" sitting directly
 * above an empty today-only Ring — technically accurate, but backwards
 * from what actually explains the empty ring to a visitor.
 */
export default function DataAsOf() {
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function fetchLatest() {
      const { data } = await supabase
        .from("ni_prices")
        .select("datetime")
        .order("datetime", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) setLatest(data[0].datetime);
    }

    fetchLatest();

    // Random suffix so the channel name can never collide across React
    // StrictMode's dev-mode double-invoke of this effect (see the same
    // fix in useNiPrices for why a bare Date.now() name once crashed the
    // page here).
    const channel = supabase
      .channel(`data-as-of-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ni_prices" }, () => {
        if (!cancelled) fetchLatest();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (!latest) return null;

  return <p className="eyebrow">Prices available through {formatLondonFullDateTime(latest)}</p>;
}
