"use client";

import { useMemo, useState } from "react";
import { dayAheadSeries, latestIntradaySeries } from "../lib/priceSeries";
import { formatLondonTime, formatLondonDateTime } from "../lib/londonTime";

// SVG stop-color doesn't reliably resolve CSS custom properties across
// renderers/exports, so the band hexes are duplicated here from the
// design tokens rather than referencing var(--low) etc.
const BAND_HEX = { low: "#0b7fc3", average: "#faba05", peak: "#e72c7a" };

const VIEW_W = 800;
const VIEW_H = 200;
const PAD_Y = 10;
const GRIDLINE_FRACTIONS = [0.25, 0.5, 0.75];

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
    yMax,
    yRange,
  };
}

/** Inverse of scales.y at a given gridline fraction of the chart's height. */
function priceAtGridline(scales, fraction) {
  const y = VIEW_H * fraction;
  return scales.yMax - ((y - PAD_Y) / (VIEW_H - PAD_Y * 2)) * scales.yRange;
}

function toPath(points, scales) {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${scales.x(p.t).toFixed(1)},${scales.y(p.price).toFixed(1)}`)
    .join(" ");
}

/** One entry per settlement period with data on either line, so hovering
 * shows both day-ahead and intraday even where only one has a point. */
function buildTooltipPoints(dayAheadPoints, intradayPoints) {
  const byTime = new Map();
  for (const p of dayAheadPoints) {
    byTime.set(p.t, { t: p.t, dayAhead: p.price, intraday: null });
  }
  for (const p of intradayPoints) {
    const existing = byTime.get(p.t);
    if (existing) existing.intraday = p.price;
    else byTime.set(p.t, { t: p.t, dayAhead: null, intraday: p.price });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Tessellates the x-axis into one hit-zone per point, split at the
 * midpoint to each neighbour, so the whole plot width is hoverable. */
function buildHitZones(tooltipPoints, scales) {
  return tooltipPoints.map((p, i) => {
    const x = scales.x(p.t);
    const prevX = i > 0 ? scales.x(tooltipPoints[i - 1].t) : 0;
    const nextX = i < tooltipPoints.length - 1 ? scales.x(tooltipPoints[i + 1].t) : VIEW_W;
    const left = i > 0 ? (prevX + x) / 2 : 0;
    const right = i < tooltipPoints.length - 1 ? (x + nextX) / 2 : VIEW_W;
    return { ...p, x, left, width: Math.max(right - left, 0.01) };
  });
}

// Date on the start time only ("12 Aug 13:30–14:00") — the scope can span
// many days (7 day/Full 2026/Custom), so a bare time range like the
// Ring's (always a single day, disambiguated by its own date picker) is
// ambiguous here.
function periodLabel(t) {
  return `${formatLondonDateTime(t)}–${formatLondonTime(t + 30 * 60000)}`;
}

function tooltipText(point) {
  const parts = [periodLabel(point.t)];
  if (point.dayAhead != null) parts.push(`day ahead ${point.dayAhead.toFixed(1)}p`);
  if (point.intraday != null) parts.push(`intraday ${point.intraday.toFixed(1)}p`);
  return parts.join(" · ");
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
export default function PriceHistoryChart({ rows, emptyMessage = "No data yet for this range." }) {
  const dayAheadPoints = useMemo(() => toPoints(dayAheadSeries(rows)), [rows]);
  const intradayPoints = useMemo(() => toPoints(latestIntradaySeries(rows)), [rows]);
  const scales = useMemo(
    () => buildScales([...dayAheadPoints, ...intradayPoints]),
    [dayAheadPoints, intradayPoints]
  );
  const tooltipPoints = useMemo(
    () => buildTooltipPoints(dayAheadPoints, intradayPoints),
    [dayAheadPoints, intradayPoints]
  );
  const hitZones = useMemo(
    () => (scales ? buildHitZones(tooltipPoints, scales) : []),
    [tooltipPoints, scales]
  );

  const [activeIndex, setActiveIndex] = useState(null);
  const activePoint = activeIndex != null ? tooltipPoints[activeIndex] : null;

  return (
    <div className="chart-box">
      {!scales ? (
        <p className="placeholder-note">{emptyMessage}</p>
      ) : (
        <div className="chart-plot">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="intradayGradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW_W} y2="0">
                {intradayPoints.map((p, i) => (
                  <stop key={i} offset={`${((scales.x(p.t) / VIEW_W) * 100).toFixed(3)}%`} stopColor={BAND_HEX[p.band]} />
                ))}
              </linearGradient>
            </defs>
            {GRIDLINE_FRACTIONS.map((f) => (
              <line key={f} x1="0" y1={VIEW_H * f} x2={VIEW_W} y2={VIEW_H * f} stroke="var(--line)" strokeWidth="1" />
            ))}
            {dayAheadPoints.length > 1 && (
              <path d={toPath(dayAheadPoints, scales)} fill="none" stroke="var(--text)" strokeWidth="2" pointerEvents="none" />
            )}
            {intradayPoints.length > 1 && (
              <path
                d={toPath(intradayPoints, scales)}
                fill="none"
                stroke="url(#intradayGradient)"
                strokeWidth="2.5"
                pointerEvents="none"
              />
            )}
            {activePoint && (
              <line
                x1={scales.x(activePoint.t)}
                y1={PAD_Y}
                x2={scales.x(activePoint.t)}
                y2={VIEW_H - PAD_Y}
                stroke="var(--text-muted)"
                strokeWidth="1"
                pointerEvents="none"
              />
            )}
            {hitZones.map((zone, i) => (
              <rect
                key={zone.t}
                x={zone.left}
                y="0"
                width={zone.width}
                height={VIEW_H}
                fill="transparent"
                tabIndex={0}
                aria-label={tooltipText(zone)}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex((a) => (a === i ? null : a))}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex((a) => (a === i ? null : a))}
              />
            ))}
          </svg>

          <div className="chart-y-labels">
            {GRIDLINE_FRACTIONS.map((f) => (
              <span key={f} className="chart-y-label" style={{ top: `${f * 100}%` }}>
                {priceAtGridline(scales, f).toFixed(1)}p
              </span>
            ))}
          </div>

          {activePoint && (
            <div
              className="chart-tooltip"
              role="tooltip"
              style={{
                // Clamped so the tooltip can't sit close enough to the
                // left edge to cover the y-axis price labels there (which
                // also live at the top of the chart, where the tooltip is
                // anchored) — plain percentage positioning let that happen
                // for the first few points.
                left: `clamp(130px, ${(scales.x(activePoint.t) / VIEW_W) * 100}%, calc(100% - 110px))`,
              }}
            >
              <div className="chart-tooltip-period">{periodLabel(activePoint.t)}</div>
              {activePoint.dayAhead != null && (
                <div>
                  <span className="chart-tooltip-swatch" style={{ background: "var(--text)" }} />
                  Day ahead {activePoint.dayAhead.toFixed(1)}p
                </div>
              )}
              {activePoint.intraday != null && (
                <div>
                  <span className="chart-tooltip-swatch" style={{ background: "var(--average)" }} />
                  Intraday {activePoint.intraday.toFixed(1)}p
                </div>
              )}
            </div>
          )}
        </div>
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
