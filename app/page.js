"use client";

import { useState } from "react";
import PriceRing from "../components/PriceRing";
import PriceHistorySection from "../components/PriceHistorySection";
import DataAsOf from "../components/DataAsOf";
import ProvisionalToggle from "../components/ProvisionalToggle";

export default function HomePage() {
  // Off by default, shared between the Ring and the chart (not the table
  // or export — see PriceHistorySection). Neither component restricts
  // provisional data to any particular day or scope; the backend decides
  // how far back it can actually reach.
  const [provisionalEnabled, setProvisionalEnabled] = useState(false);

  return (
    <div className="page-wrap">
      <div className="eyebrow-row">
        <p className="eyebrow">
          NI Electricity · SEM Auctions · Source:{" "}
          <a
            href="https://www.semopx.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="external-link"
          >
            SEMOpx
          </a>
        </p>
        <DataAsOf />
      </div>
      <h1>Northern Ireland energy prices</h1>

      <div className="hero">
        <PriceRing provisionalEnabled={provisionalEnabled} onEnableProvisional={() => setProvisionalEnabled(true)} />
        <div className="hero-side">
          <ProvisionalToggle enabled={provisionalEnabled} onChange={setProvisionalEnabled} />
          <p>
            Each segment is one half hourly settlement period. Use the arrows
            or date picker above the ring to browse other days &mdash; the
            lit, pulsing segment only appears on today. See the info icon
            next to the legend for how low, typical, and peak are worked out.
          </p>
        </div>
      </div>

      <PriceHistorySection
        provisionalEnabled={provisionalEnabled}
        onEnableProvisional={() => setProvisionalEnabled(true)}
      />
    </div>
  );
}
