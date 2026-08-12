"use client";

import { useEffect, useMemo, useState } from "react";
import { useNiPrices } from "../hooks/useNiPrices";
import { presetRange } from "../lib/priceRange";
import { londonYmd } from "../lib/londonTime";
import PriceRing from "../components/PriceRing";
import PriceHistorySection from "../components/PriceHistorySection";

/**
 * "Today" as a query range, recomputed once the London calendar day
 * actually changes rather than frozen at first render — a tab left open
 * across midnight would otherwise keep querying from the *previous* day's
 * boundary forever, with the fetched range quietly growing by a day every
 * day the tab stays open. Checked once a minute, which is frequent enough
 * to catch the rollover promptly without any real cost.
 */
function useTodayRange() {
  const [dayKey, setDayKey] = useState(() => londonYmd(new Date()));
  useEffect(() => {
    const id = setInterval(() => setDayKey(londonYmd(new Date())), 60000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- presetRange("today") is pure; dayKey is the real dependency
  return useMemo(() => presetRange("today"), [dayKey]);
}

export default function HomePage() {
  const range = useTodayRange();
  const { rows, loading, error } = useNiPrices(range);

  return (
    <div className="page-wrap">
      <p className="eyebrow">NI Electricity · SEM Auctions</p>
      <h1>Northern Ireland energy prices</h1>

      <div className="hero">
        <PriceRing rows={rows} />
        <div className="hero-side">
          <p>
            Each segment is one half hourly settlement period today. Colour
            shows how that period compares to the last 7 days, blue for
            cheaper than normal, gold for typical, magenta for higher than
            normal. The lit segment is the current period.
          </p>
          {error && <p role="alert">Couldn&apos;t load live prices: {error}</p>}
          {loading && rows.length === 0 && !error && <p>Loading today&apos;s prices…</p>}
        </div>
      </div>

      <PriceHistorySection />
    </div>
  );
}
