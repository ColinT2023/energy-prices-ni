"use client";

import { useMemo, useState } from "react";
import {
  aggregateDaily,
  dayAheadSeries,
  latestIntradaySeries,
  WIDE_RANGE_DAYS,
  gbpToPence,
  formatPence,
  formatGbp,
} from "../lib/priceSeries";
import { formatLondonTime, formatLondonDateTime, formatLongDate, londonYmd } from "../lib/londonTime";

// SVG stop-color doesn't reliably resolve CSS custom properties across
// renderers/exports, so the band hexes are duplicated here from the
// design tokens rather than referencing var(--low) etc.
const BAND_HEX = { low: "#0b7fc3", average: "#faba05", peak: "#e72c7a" };

const VIEW_W = 800;
const VIEW_H = 200;
const PAD_Y = 10;
const GRIDLINE_FRACTIONS = [0.25, 0.5, 0.75];

function toPoints(rows) {
  return rows.map((row) => ({
    t: new Date(row.datetime).getTime(),
    price: gbpToPence(row.price_gbp),
    priceGbp: row.price_gbp,
    band: row.band,
    provisional: !!row.provisional,
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

/** Same line as toPath, but as one small path per consecutive point pair
 * instead of one continuous path — only used when the series actually has
 * provisional points, so each segment touching one can be drawn dashed
 * without needing SVG's dasharray to somehow vary partway along a single
 * path. Segments where neither endpoint is provisional look identical to
 * the single-path version; this is strictly more expensive to render, so
 * toPath is still used whenever nothing needs the per-segment styling. */
function toPathSegments(points, scales) {
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    segments.push({
      key: `${a.t}`,
      d: `M${scales.x(a.t).toFixed(1)},${scales.y(a.price).toFixed(1)} L${scales.x(b.t).toFixed(1)},${scales.y(b.price).toFixed(1)}`,
      dashed: a.provisional || b.provisional,
    });
  }
  return segments;
}

/** One entry per settlement period with data on either line, so hovering
 * shows both day-ahead and intraday even where only one has a point. */
function buildTooltipPoints(dayAheadPoints, intradayPoints) {
  const byTime = new Map();
  for (const p of dayAheadPoints) {
    byTime.set(p.t, {
      t: p.t,
      dayAhead: p.price,
      dayAheadGbp: p.priceGbp,
      dayAheadProvisional: p.provisional,
      intraday: null,
      intradayGbp: null,
      intradayProvisional: false,
    });
  }
  for (const p of intradayPoints) {
    const existing = byTime.get(p.t);
    if (existing) {
      existing.intraday = p.price;
      existing.intradayGbp = p.priceGbp;
      existing.intradayProvisional = p.provisional;
    } else {
      byTime.set(p.t, {
        t: p.t,
        dayAhead: null,
        dayAheadGbp: null,
        dayAheadProvisional: false,
        intraday: p.price,
        intradayGbp: p.priceGbp,
        intradayProvisional: p.provisional,
      });
    }
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
// many days (7 day/All time/Custom), so a bare time range like the
// Ring's (always a single day, disambiguated by its own date picker) is
// ambiguous here.
function periodLabel(t) {
  return `${formatLondonDateTime(t)}–${formatLondonTime(t + 30 * 60000)}`;
}

/** "12 Aug 2026" for an aggregated daily point — a half-hourly range
 * reads as false precision once a point actually represents a day's
 * average. */
function dayLabel(t) {
  return formatLongDate(londonYmd(new Date(t)));
}

function pointLabel(t, isAggregated) {
  return isAggregated ? dayLabel(t) : periodLabel(t);
}

function tooltipText(point, isAggregated) {
  const parts = [pointLabel(point.t, isAggregated)];
  const suffix = isAggregated ? " avg" : "";
  if (point.dayAhead != null) {
    parts.push(
      `day ahead ${formatPence(point.dayAheadGbp)}p · £${formatGbp(point.dayAheadGbp)}/MWh${suffix}${point.dayAheadProvisional ? " (provisional)" : ""}`
    );
  }
  if (point.intraday != null) {
    parts.push(
      `intraday ${formatPence(point.intradayGbp)}p · £${formatGbp(point.intradayGbp)}/MWh${suffix}${point.intradayProvisional ? " (provisional)" : ""}`
    );
  }
  return parts.join(" · ");
}

/**
 * Price history chart body: a solid neutral day-ahead line plus a latest-
 * intraday line whose stroke gradient follows the real price shape (each
 * point contributes its own band colour as a gradient stop) rather than a
 * fixed decorative gradient, so colour keeps meaning exactly one thing —
 * price level — everywhere on the page. Scope (Today/7 day/All time), the
 * chart/table toggle, and the series toggle (`seriesFilter`: "dayAhead" |
 * "intraday" | "both") all live in the parent PriceHistorySection; this
 * component just renders whatever rows it's given, for whichever
 * series are selected.
 */
export default function PriceHistoryChart({
  rows,
  emptyMessage = "No data yet for this range.",
  seriesFilter = "both",
}) {
  const showDayAhead = seriesFilter !== "intraday";
  const showIntraday = seriesFilter !== "dayAhead";

  // Plotting every half-hourly row is the point for Today/7 day, but past
  // WIDE_RANGE_DAYS it's mostly noise (and a real render cost at ~29k
  // points for All time) — collapse to one point per day instead. Based
  // on the actual span of what was fetched, not the scope label, so a
  // wide Custom range gets the same treatment as All time.
  const isAggregated = useMemo(() => {
    if (rows.length < 2) return false;
    const times = rows.map((r) => new Date(r.datetime).getTime());
    const spanDays = (Math.max(...times) - Math.min(...times)) / (1000 * 60 * 60 * 24);
    return spanDays > WIDE_RANGE_DAYS;
  }, [rows]);

  // Hidden series contribute no points at all (not just an unrendered
  // path) — hiding a line also removes its values from the tooltip and
  // the axis scale, rather than just visually suppressing the stroke.
  const dayAheadPoints = useMemo(() => {
    if (!showDayAhead) return [];
    const series = dayAheadSeries(rows);
    return toPoints(isAggregated ? aggregateDaily(series) : series);
  }, [rows, showDayAhead, isAggregated]);
  const intradayPoints = useMemo(() => {
    if (!showIntraday) return [];
    const series = latestIntradaySeries(rows);
    return toPoints(isAggregated ? aggregateDaily(series) : series);
  }, [rows, showIntraday, isAggregated]);
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
  const hasProvisional = useMemo(
    () => dayAheadPoints.some((p) => p.provisional) || intradayPoints.some((p) => p.provisional),
    [dayAheadPoints, intradayPoints]
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
            {dayAheadPoints.length > 1 &&
              (dayAheadPoints.some((p) => p.provisional) ? (
                toPathSegments(dayAheadPoints, scales).map((seg) => (
                  <path
                    key={seg.key}
                    d={seg.d}
                    fill="none"
                    stroke="var(--text)"
                    strokeWidth="2"
                    strokeDasharray={seg.dashed ? "5 3" : undefined}
                    pointerEvents="none"
                  />
                ))
              ) : (
                <path d={toPath(dayAheadPoints, scales)} fill="none" stroke="var(--text)" strokeWidth="2" pointerEvents="none" />
              ))}
            {intradayPoints.length > 1 &&
              (intradayPoints.some((p) => p.provisional) ? (
                toPathSegments(intradayPoints, scales).map((seg) => (
                  <path
                    key={seg.key}
                    d={seg.d}
                    fill="none"
                    stroke="url(#intradayGradient)"
                    strokeWidth="2.5"
                    strokeDasharray={seg.dashed ? "5 3" : undefined}
                    pointerEvents="none"
                  />
                ))
              ) : (
                <path
                  d={toPath(intradayPoints, scales)}
                  fill="none"
                  stroke="url(#intradayGradient)"
                  strokeWidth="2.5"
                  pointerEvents="none"
                />
              ))}
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
                aria-label={tooltipText(zone, isAggregated)}
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
              <div className="chart-tooltip-period">{pointLabel(activePoint.t, isAggregated)}</div>
              {activePoint.dayAhead != null && (
                <div>
                  <span className="chart-tooltip-swatch" style={{ background: "var(--text)" }} />
                  Day ahead {formatPence(activePoint.dayAheadGbp)}p · £{formatGbp(activePoint.dayAheadGbp)}/MWh
                  {isAggregated ? " avg" : ""}
                  {activePoint.dayAheadProvisional ? " · provisional" : ""}
                </div>
              )}
              {activePoint.intraday != null && (
                <div>
                  <span className="chart-tooltip-swatch" style={{ background: "var(--average)" }} />
                  Intraday {formatPence(activePoint.intradayGbp)}p · £{formatGbp(activePoint.intradayGbp)}/MWh
                  {isAggregated ? " avg" : ""}
                  {activePoint.intradayProvisional ? " · provisional" : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="auction-key">
        {showDayAhead && (
          <span>
            <span className="line-sample" /> Day ahead
          </span>
        )}
        {showIntraday && (
          <span>
            <span className="line-sample" style={{ background: "linear-gradient(90deg,#0b7fc3,#faba05,#e72c7a)" }} />
            Latest intraday, coloured by price
          </span>
        )}
        {isAggregated && <span className="chart-aggregation-note">Showing daily averages — select Today or 7 day for half-hourly detail.</span>}
        {hasProvisional && <span className="chart-provisional-note">Dashed = provisional, not yet official.</span>}
      </div>
    </div>
  );
}
