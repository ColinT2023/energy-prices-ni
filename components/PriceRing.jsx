"use client";

import { useEffect, useMemo, useState } from "react";
import {
  londonDayStart,
  settlementPeriodIndex,
  formatLondonTime,
  periodsInLondonDay,
} from "../lib/londonTime";
import { latestPerPeriod, AUCTION_LABEL } from "../lib/priceSeries";
import styles from "./PriceRing.module.css";

// Segment count is *not* a fixed 48: the UK/Ireland clock change days have
// 46 (spring forward, 01:00-02:00 skipped) or 50 (clocks back,
// 01:00-02:00 repeats) — see periodsInLondonDay. Every angle below is
// computed from the actual period count for today rather than assuming 48.
const GAP_DEG = 1.4;
const MAJOR_HOUR_LABELS = new Set(["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
const CENTRE = 190;
const OUTER_R = 130;
const INNER_R = 98;

const BAND_COLOUR = {
  low: "var(--low)",
  average: "var(--average)",
  peak: "var(--peak)",
};

function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const p1 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p3 = polarToCartesian(cx, cy, rInner, startAngle);
  const p4 = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

function periodLabel(startMs) {
  return `${formatLondonTime(startMs)}–${formatLondonTime(startMs + 30 * 60000)}`;
}

function gbpToPence(priceGbp) {
  // price_gbp is £/MWh (wholesale); the site displays p/kWh (retail-scale).
  // 1 MWh = 1000 kWh, so £/MWh -> p/kWh is a straight divide by 10.
  return priceGbp / 10;
}

/** Renders the Price Ring for "today" — pass it rows from useNiPrices('today'). */
export default function PriceRing({ rows }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const dayStart = useMemo(() => londonDayStart(0, now), [now]);
  const periods = useMemo(() => periodsInLondonDay(now), [now]);

  const segmentsByIndex = useMemo(() => {
    const byIndex = new Map();
    for (const row of latestPerPeriod(rows)) {
      const idx = settlementPeriodIndex(row.datetime, dayStart);
      if (idx >= 0 && idx < periods) byIndex.set(idx, row);
    }
    return byIndex;
  }, [rows, dayStart, periods]);

  // Major-hour label -> segment index lookup, walking only even indices
  // (every segment that starts a new local hour). Built from the actual
  // per-segment wall-clock label rather than a fixed 2-segments-per-hour
  // formula, since that formula only holds before any clock change today.
  const majorHourIndex = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < periods; i += 2) {
      const label = formatLondonTime(dayStart.getTime() + i * 30 * 60000);
      if (MAJOR_HOUR_LABELS.has(label)) map.set(label, i);
    }
    return map;
  }, [dayStart, periods]);

  const currentIndex = Math.min(settlementPeriodIndex(now, dayStart), periods - 1);
  const current = segmentsByIndex.get(currentIndex);
  const currentColour = current ? BAND_COLOUR[current.band] : "var(--text-muted)";

  const [activeIndex, setActiveIndex] = useState(null);

  function segmentTooltip(index, row) {
    const label = periodLabel(dayStart.getTime() + index * 30 * 60000);
    if (!row) return `${label} · not yet published`;
    return `${label} · ${gbpToPence(row.price_gbp).toFixed(1)}p · ${row.band}`;
  }

  return (
    <div className={styles.ringCol}>
      <div className={styles.ringWrap}>
        <svg viewBox="0 0 380 380" width="380" height="380">
          {Array.from({ length: periods }, (_, i) => {
            const row = segmentsByIndex.get(i);
            const startAngle = (360 / periods) * i - 90 + GAP_DEG / 2;
            const endAngle = (360 / periods) * (i + 1) - 90 - GAP_DEG / 2;
            const d = describeArc(CENTRE, CENTRE, OUTER_R, INNER_R, startAngle, endAngle);
            const isCurrent = i === currentIndex;
            return (
              <path
                key={i}
                d={d}
                fill={row ? BAND_COLOUR[row.band] : "var(--line)"}
                opacity={isCurrent ? 1 : 0.6}
                stroke={isCurrent ? "var(--now-stroke)" : "none"}
                strokeWidth={isCurrent ? 2 : 0}
                className={isCurrent ? "pulse-segment" : undefined}
                tabIndex={0}
                aria-label={segmentTooltip(i, row)}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex((a) => (a === i ? null : a))}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex((a) => (a === i ? null : a))}
              />
            );
          })}

          {Array.from({ length: periods / 2 }, (_, hourIdx) => {
            const i = hourIdx * 2; // segment index where this local hour starts
            const boundaryAngle = (360 / periods) * i - 90;
            const isMajor = MAJOR_HOUR_LABELS.has(formatLondonTime(dayStart.getTime() + i * 30 * 60000));
            const p1 = polarToCartesian(CENTRE, CENTRE, OUTER_R + 5, boundaryAngle);
            const p2 = polarToCartesian(CENTRE, CENTRE, isMajor ? OUTER_R + 14 : OUTER_R + 10, boundaryAngle);
            return (
              <line
                key={i}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={isMajor ? "var(--text-muted)" : "#4a4a4d"}
                strokeWidth={isMajor ? 1.4 : 1}
              />
            );
          })}

          {[...majorHourIndex.entries()].map(([label, i]) => {
            const boundaryAngle = (360 / periods) * i - 90;
            const lp = polarToCartesian(CENTRE, CENTRE, OUTER_R + 30, boundaryAngle);
            const cos = Math.cos((boundaryAngle * Math.PI) / 180);
            const sin = Math.sin((boundaryAngle * Math.PI) / 180);
            return (
              <text
                key={label}
                x={lp.x}
                y={lp.y}
                fill="var(--text-muted)"
                fontSize="11"
                className={styles.hourLabel}
                textAnchor={cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle"}
                dominantBaseline={sin > 0.3 ? "hanging" : sin < -0.3 ? "auto" : "middle"}
              >
                {label}
              </text>
            );
          })}

          {(() => {
            const nowAngle = (360 / periods) * (currentIndex + 0.5) - 90;
            const nowPos = polarToCartesian(CENTRE, CENTRE, OUTER_R + 20, nowAngle);
            return (
              <>
                <circle
                  cx={nowPos.x}
                  cy={nowPos.y}
                  r="8"
                  fill="var(--now-stroke)"
                  opacity="0.3"
                  className="pulse-segment"
                />
                <circle cx={nowPos.x} cy={nowPos.y} r="3.5" fill="var(--now-stroke)" />
              </>
            );
          })()}
        </svg>

        <div className={styles.ringCentre}>
          <div className={styles.price}>
            <span className={styles.priceDot} style={{ background: currentColour }} />
            {current ? `${gbpToPence(current.price_gbp).toFixed(1)}p` : "—"}
          </div>
          <div className={styles.unit}>
            per kWh{current ? ` · ${AUCTION_LABEL[current.auction] ?? current.auction}` : ""}
          </div>
          <div className={styles.period} style={{ color: currentColour }}>
            {periodLabel(dayStart.getTime() + currentIndex * 30 * 60000)} · now
          </div>
        </div>

        {activeIndex != null && (
          <div
            className={styles.tooltip}
            role="tooltip"
            style={(() => {
              const midAngle = (360 / periods) * (activeIndex + 0.5) - 90;
              const pos = polarToCartesian(CENTRE, CENTRE, OUTER_R + 46, midAngle);
              return { left: `${(pos.x / 380) * 100}%`, top: `${(pos.y / 380) * 100}%` };
            })()}
          >
            {segmentTooltip(activeIndex, segmentsByIndex.get(activeIndex))}
          </div>
        )}
      </div>

      <div className="legend">
        <div className="legend-item">
          <span className="swatch" style={{ background: "var(--low)" }} />
          Low
        </div>
        <div className="legend-item">
          <span className="swatch" style={{ background: "var(--average)" }} />
          Average
        </div>
        <div className="legend-item">
          <span className="swatch" style={{ background: "var(--peak)" }} />
          Peak
        </div>
      </div>
    </div>
  );
}
