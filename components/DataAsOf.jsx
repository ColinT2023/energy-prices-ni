"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatLondonFullDateTime } from "../lib/londonTime";

/**
 * "Data as of <latest inserted_at>", kept live via its own realtime
 * subscription on ni_prices — deliberately independent of the Ring/chart's
 * own subscriptions rather than threaded through useNiPrices, since this
 * only ever needs a single MAX(inserted_at) value, not a scoped row set.
 */
export default function DataAsOf() {
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function fetchLatest() {
      const { data } = await supabase
        .from("ni_prices")
        .select("inserted_at")
        .order("inserted_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) setLatest(data[0].inserted_at);
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

  return <p className="eyebrow">Data as of {formatLondonFullDateTime(latest)}</p>;
}
