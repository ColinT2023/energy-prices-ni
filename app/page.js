"use client";

import PriceRing from "../components/PriceRing";
import PriceHistorySection from "../components/PriceHistorySection";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <p className="eyebrow">NI Electricity · SEM Auctions</p>
      <h1>Northern Ireland energy prices</h1>

      <div className="hero">
        <PriceRing />
        <div className="hero-side">
          <p>
            Each segment is one half hourly settlement period. Colour shows
            how that period compares to the last 7 days, blue for cheaper
            than normal, gold for typical, magenta for higher than normal.
            Use the arrows or date picker above the ring to browse other
            days &mdash; the lit, pulsing segment only appears on today.
          </p>
        </div>
      </div>

      <PriceHistorySection />
    </div>
  );
}
