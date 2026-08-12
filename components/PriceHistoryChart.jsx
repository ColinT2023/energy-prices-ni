"use client";

import { useMemo } from "react";
import { dayAheadSeries, latestIntradaySeries } from "../lib/priceSeries";

// SVG stop-color doesn't reliably resolve CSS custom properties across
// renderers/exports, so the band hexes are duplicated here from the
// design tokens rather than referencing var(--low) etc.
const BAND_HEX = { low: "#0b7fc3", average: "#faba05", peak: "#e72c7a" };

const VIEW_W = 800;
const VIEW_H = 200;
const PAD_Y = 10;

function gbpToPence(priceGbp) {
  return priceGbp / 10;
}

function toPoints(rows) {
  return rows.map((row) => ({
    t: new Date(row.datetime).getTime(),
    price: gbpToPence(row.price_gbp),
    band: row.band,
  }));
}

function buildScales(points) {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.price);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  return {
    x: (t) => ((t - xMin) / xRange) * VIEW_W,
    y: (v) => VIEW_H - PAD_Y - ((v - yMin) / yRange) * (VIEW_H - PAD_Y * 2),
  };
}

function toPath(points, scales) {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${scales.x(p.t).toFixed(1)},${scales.y(p.price).toFixed(1)}`)
    .join(" ");
}

/**
 * Price history chart body: a solid neutral day-ahead line plus a latest-
 * intraday line whose stroke gradient follows the real price shape (each
 * point contributes its own band colour as a gradient stop) rather than a
 * fixed decorative gradient, so colour keeps meaning exactly one thing —
 * price level — everywhere on the page. Scope (Today/7 day/Full 2026) and
 * the chart/table toggle live in the parent PriceHistorySection; this
 * component just renders whatever rows it's given.
 */
export default function PriceHistoryChart({ rows }) {
  const dayAheadPoints = useMemo(() => toPoints(dayAheadSeries(rows)), [rows]);
  const intradayPoints = useMemo(() => toPoints(latestIntradaySeries(rows)), [rows]);
  const scales = useMemo(
    () => buildScales([...dayAheadPoints, ...intradayPoints]),
    [dayAheadPoints, intradayPoints]
  );

  return (
    <div className="chart-box">
      {!scales ? (
        <p className="placeholder-note">No data yet for this range.</p>
      ) : (
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="intradayGradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW_W} y2="0">
              {intradayPoints.map((p, i) => (
                <stop key={i} offset={`${((scales.x(p.t) / VIEW_W) * 100).toFixed(3)}%`} stopColor={BAND_HEX[p.band]} />
              ))}
            </linearGradient>
          </defs>
          <line x1="0" y1={VIEW_H * 0.25} x2={VIEW_W} y2={VIEW_H * 0.25} stroke="var(--line)" strokeWidth="1" />
          <line x1="0" y1={VIEW_H * 0.5} x2={VIEW_W} y2={VIEW_H * 0.5} stroke="var(--line)" strokeWidth="1" />
          <line x1="0" y1={VIEW_H * 0.75} x2={VIEW_W} y2={VIEW_H * 0.75} stroke="var(--line)" strokeWidth="1" />
          {dayAheadPoints.length > 1 && (
            <path d={toPath(dayAheadPoints, scales)} fill="none" stroke="var(--text)" strokeWidth="2" />
          )}
          {intradayPoints.length > 1 && (
            <path d={toPath(intradayPoints, scales)} fill="none" stroke="url(#intradayGradient)" strokeWidth="2.5" />
          )}
        </svg>
      )}
      <div className="auction-key">
        <span>
          <span className="line-sample" /> Day ahead
        </span>
        <span>
          <span className="line-sample" style={{ background: "linear-gradient(90deg,#0b7fc3,#faba05,#e72c7a)" }} />
          Latest intraday, coloured by price
        </span>
      </div>
    </div>
  );
}
