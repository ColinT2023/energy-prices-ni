"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * Earliest and latest datetime across the combined official/provisional
 * dataset — the actual extent of what this site has data for, not an
 * assumed/hardcoded season (the "Date filter" bug and the hardcoded
 * "Full 2026" label both trace back to exactly that kind of assumption).
 * Shared by the Ring's date-picker lower bound, the chart's "All time"
 * caption, and the Help page's coverage note, so there's one query and
 * one value behind all three rather than several independently-computed
 * dates that could silently disagree.
 *
 * Earliest comes from ni_prices alone — provisional rows only ever cover
 * today plus a short trailing window into yesterday (see
 * TRAILING_PERIODS_FROM_YESTERDAY in provisional_common.py), so official
 * always has the true earliest row. Latest is the max of both tables:
 * whichever is more current depends on exactly where the official
 * pipeline currently stands relative to provisional's own polling.
 *
 * Returns raw datetime strings (or null before the first fetch resolves,
 * or if either table is genuinely empty), not pre-formatted — callers
 * derive whatever shape they need (a londonYmd for a date input's min,
 * a formatted display string, a day count) from the same two values.
 */
export function useDataCoverage() {
  const [coverage, setCoverage] = useState({ earliest: null, latest: null });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function fetchCoverage() {
      const [earliestRes, officialLatestRes, provisionalLatestRes] = await Promise.all([
        supabase.from("ni_prices").select("datetime").order("datetime", { ascending: true }).limit(1),
        supabase.from("ni_prices").select("datetime").order("datetime", { ascending: false }).limit(1),
        supabase.from("ni_prices_provisional").select("datetime").order("datetime", { ascending: false }).limit(1),
      ]);
      if (cancelled) return;

      const earliest = earliestRes.data?.[0]?.datetime ?? null;
      const officialLatest = officialLatestRes.data?.[0]?.datetime ?? null;
      const provisionalLatest = provisionalLatestRes.data?.[0]?.datetime ?? null;
      const latest = [officialLatest, provisionalLatest].filter(Boolean).sort().at(-1) ?? null;

      setCoverage({ earliest, latest });
    }

    fetchCoverage();
    return () => {
      cancelled = true;
    };
  }, []);

  return coverage;
}
