"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatLondonFullDateTime, londonYmd } from "../lib/londonTime";
import { dayRange } from "../lib/priceRange";

/**
 * "Official prices available through <latest settlement period>", kept
 * live via its own realtime subscription on ni_prices — deliberately
 * independent of the Ring/chart's own subscriptions rather than threaded
 * through useNiPrices, since this only ever needs a single MAX(datetime)
 * value, not a scoped row set.
 *
 * Reads max(datetime) — the latest settlement period actually covered by
 * the data — not max(inserted_at), which is when a row was written to
 * the table. Those can diverge a lot: right after a backfill,
 * inserted_at is "just now" for every row regardless of how old the
 * priced periods are, which read as "data as of today" sitting directly
 * above an empty today-only Ring — technically accurate, but backwards
 * from what actually explains the empty ring to a visitor.
 *
 * Separately checks whether today has any provisional row at all —
 * reflects actual data availability, not the provisional toggle's on/off
 * state, so this is accurate even for someone who hasn't turned it on
 * yet: it's telling them there's something there if they want to look,
 * not just echoing a UI choice they already made themselves.
 *
 * Both subscriptions reconnect on drop, same pattern as useNiPrices: this
 * component's entire purpose is telling someone how current the data is,
 * so it's specifically the one place that must not silently go stale
 * itself if its channel ever drops.
 */
export default function DataAsOf() {
  const [latest, setLatest] = useState(null);
  const [todayHasProvisional, setTodayHasProvisional] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let hasConnectedBefore = false;
    // Plain closure variables, not useRef — this effect has no
    // dependencies and only ever runs once per mount (unlike useNiPrices's,
    // which re-runs on range changes and needs refs to survive that), so
    // there's no re-render for a ref to persist across.
    let channel = null;
    let reconnectTimer = null;

    async function fetchLatest() {
      const { data } = await supabase
        .from("ni_prices")
        .select("datetime")
        .order("datetime", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) setLatest(data[0].datetime);
    }

    fetchLatest();

    function openChannel() {
      if (cancelled) return;
      // Random suffix so the channel name can never collide across React
      // StrictMode's dev-mode double-invoke of this effect (see the same
      // fix in useNiPrices for why a bare Date.now() name once crashed the
      // page here).
      channel = supabase
        .channel(`data-as-of-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ni_prices" }, () => {
          if (!cancelled) fetchLatest();
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            clearTimeout(reconnectTimer);
            // Only re-fetch here on a genuine *re*connect — the very first
            // SUBSCRIBED fires right after the direct fetchLatest() call
            // above, so re-fetching then too would just be duplicate work.
            if (hasConnectedBefore) fetchLatest();
            hasConnectedBefore = true;
          } else {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (cancelled) return;
              if (channel) {
                supabase.removeChannel(channel);
                channel = null;
              }
              openChannel();
            }, 5000);
          }
        });
    }

    openChannel();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let hasConnectedBefore = false;
    let channel = null;
    let reconnectTimer = null;

    async function checkTodayProvisional() {
      const { from, to } = dayRange(londonYmd(new Date()));
      const { data } = await supabase
        .from("ni_prices_provisional")
        .select("datetime")
        .gte("datetime", from)
        .lt("datetime", to)
        .limit(1);
      if (!cancelled) setTodayHasProvisional(!!(data && data.length > 0));
    }

    checkTodayProvisional();

    function openChannel() {
      if (cancelled) return;
      channel = supabase
        .channel(`data-as-of-provisional-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ni_prices_provisional" }, () => {
          if (!cancelled) checkTodayProvisional();
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            clearTimeout(reconnectTimer);
            if (hasConnectedBefore) checkTodayProvisional();
            hasConnectedBefore = true;
          } else {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (cancelled) return;
              if (channel) {
                supabase.removeChannel(channel);
                channel = null;
              }
              openChannel();
            }, 5000);
          }
        });
    }

    openChannel();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, []);

  if (!latest) return null;

  return (
    <p className="eyebrow">
      Official prices available through {formatLondonFullDateTime(latest)}
      {todayHasProvisional ? " · today includes provisional prices, which may still change" : ""}
    </p>
  );
}
