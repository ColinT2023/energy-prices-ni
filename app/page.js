"use client";

import { useNiPrices } from "../hooks/useNiPrices";
import PriceRing from "../components/PriceRing";

export default function HomePage() {
  const { rows, loading, error } = useNiPrices("today");

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

      <p className="placeholder-note">
        Price history chart and table view land here in the next pass.
      </p>
    </div>
  );
}
