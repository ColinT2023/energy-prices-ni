"use client";

import PriceRing from "../components/PriceRing";
import PriceHistorySection from "../components/PriceHistorySection";
import DataAsOf from "../components/DataAsOf";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <div className="eyebrow-row">
        <p className="eyebrow">NI Electricity · SEM Auctions</p>
        <DataAsOf />
      </div>
      <h1>Northern Ireland energy prices</h1>

      <div className="hero">
        <PriceRing />
        <div className="hero-side">
          <p>
            Each segment is one half hourly settlement period. Use the arrows
            or date picker above the ring to browse other days &mdash; the
            lit, pulsing segment only appears on today. See the info icon
            next to the legend for how low, average, and peak are worked out.
          </p>
        </div>
      </div>

      <PriceHistorySection />
    </div>
  );
}
