"use client";

import { useMemo, useState } from "react";
import { useDataCoverage } from "../hooks/useDataCoverage";
import {
  aggregateDaily,
  dayAheadSeries,
  latestIntradaySeries,
  WIDE_RANGE_DAYS,
  gbpToPence,
  formatPence,
  formatGbp,
  AUCTION_LABEL,
} from "../lib/priceSeries";
import {
  formatLondonTime,
  formatLondonDateTime,
  formatLongDate,
  londonYmd,
  londonMidnightUtc,
  daySpanCount,
} from "../lib/londonTime";

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
    // Only meaningful for a genuine single-period point — aggregateDaily's
    // output has no per-source-auction field (a day's average can blend
    // several different auctions), so this is undefined there, same as
    // any other row shape that doesn't carry one.
    auction: row.auction,
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
    xMin,
    xMax,
    yMax,
    yRange,
  };
}

const LONDON_TZ = "Europe/London";

/** "12 Aug" (or "12 Aug 2026" with `withYear`) — day-boundary/weekly ticks. */
function shortDateLabel(t, withYear) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
  }).format(new Date(t));
}

/** "Aug" (or "Aug 2026" with `withYear`) — monthly ticks on a wide range. */
function monthLabel(t, withYear) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    month: "short",
    year: withYear ? "numeric" : undefined,
  }).format(new Date(t));
}

/** `dateUtc` (a London-local midnight instant) advanced by `n` calendar
 * months, still landing on that later month's own London-local midnight —
 * used for monthly x-axis ticks on very wide ranges. */
function addMonthsLondon(dateUtc, n) {
  const [y, m] = londonYmd(dateUtc).split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) + n;
  const newY = Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  return londonMidnightUtc(new Date(`${newY}-${String(newM).padStart(2, "0")}-01T00:00:00Z`));
}

/** Smallest of the candidate hour intervals that keeps the tick count at
 * or under `maxTicks` across the given span — used for Today/7 day so tick
 * density scales down as the range widens rather than one fixed interval
 * being too sparse for a day or too crowded for a week. */
function chooseHourInterval(spanHours, maxTicks = 9) {
  const candidates = [1, 2, 3, 4, 6, 8, 12, 24];
  for (const h of candidates) {
    if (spanHours / h <= maxTicks) return h;
  }
  return 24;
}

/**
 * Ticks for Today/7 day (half-hourly, non-aggregated data): time-only at
 * each interval (e.g. "14:00"), except the first tick of each London-
 * local day, which shows the date instead (e.g. "14 Aug") — same idea as
 * SEMOpx's own chart, so a multi-day range doesn't repeat the date on
 * every tick while still making each day's start unambiguous. Interval
 * length is chosen to land near round hour-of-day marks (matching the
 * Ring's own major-hour set at 3h) without hardcoding per scope. Same
 * principle for the year: only on the range's first date label and
 * again wherever it actually changes, not on every one.
 *
 * Fixed-ms stepping from a real London midnight anchor — this can drift
 * up to an hour off a clean local-hour mark if the tick sequence itself
 * crosses a DST transition (twice a year), a cosmetic-only edge case not
 * worth the added complexity of re-deriving each step from wall-clock
 * arithmetic instead.
 */
function buildSubDayTicks(minT, maxT) {
  const spanHours = (maxT - minT) / 3600000;
  const stepMs = chooseHourInterval(spanHours) * 3600000;
  const ticks = [];
  let t = londonMidnightUtc(new Date(minT)).getTime();
  while (t < minT) t += stepMs;
  let lastYmd = null;
  let lastYear = null;
  for (; t <= maxT; t += stepMs) {
    const ymd = londonYmd(new Date(t));
    const isDayBoundary = ymd !== lastYmd;
    lastYmd = ymd;
    let label;
    let hasYear = false;
    if (isDayBoundary) {
      // Year shown on the range's first tick (lastYear starts null) and
      // again wherever it actually changes (a range crossing New Year's),
      // never on every date label — same "don't add noise until it's
      // needed" idea as the boundary bolding itself.
      const year = ymd.slice(0, 4);
      hasYear = year !== lastYear;
      label = shortDateLabel(t, hasYear);
      lastYear = year;
    } else {
      label = formatLondonTime(t);
    }
    ticks.push({ t, isDayBoundary, hasYear, label });
  }
  return ticks;
}

/**
 * Ticks for All time/wide Custom (daily-aggregated data): date-only,
 * thinned to weekly or monthly depending on total span so a ~224 day
 * range doesn't render one label per point. Under 60 days uses
 * Monday-aligned weekly-ish steps (1/2/3/7/14/21/30 days, whichever keeps
 * the count readable); beyond that, calendar-month starts, stepping by
 * more than one month if even a monthly cadence would still be crowded
 * (only relevant once this site's history spans several years).
 */
function buildAggregatedTicks(minT, maxT) {
  const spanDays = (maxT - minT) / 86400000;
  const ticks = [];

  if (spanDays <= 60) {
    const candidates = [1, 2, 3, 7, 14, 21, 30];
    let intervalDays = 30;
    for (const d of candidates) {
      if (spanDays / d <= 9) {
        intervalDays = d;
        break;
      }
    }
    let cursor = londonMidnightUtc(new Date(minT));
    const daysToMonday = (8 - cursor.getUTCDay()) % 7; // London midnight's UTC weekday is safe here — London is never behind UTC
    cursor = londonMidnightUtc(new Date(cursor.getTime() + daysToMonday * 86400000));
    let lastYear = null;
    for (; cursor.getTime() <= maxT; cursor = londonMidnightUtc(new Date(cursor.getTime() + intervalDays * 86400000))) {
      if (cursor.getTime() >= minT) {
        const year = londonYmd(cursor).slice(0, 4);
        const hasYear = year !== lastYear;
        ticks.push({ t: cursor.getTime(), isDayBoundary: false, hasYear, label: shortDateLabel(cursor.getTime(), hasYear) });
        lastYear = year;
      }
    }
  } else {
    const stepMonths = Math.max(1, Math.ceil(spanDays / 30.44 / 9));
    const firstOfMonth = `${londonYmd(new Date(minT)).slice(0, 7)}-01T00:00:00Z`;
    let cursor = londonMidnightUtc(new Date(firstOfMonth));
    while (cursor.getTime() < minT) cursor = addMonthsLondon(cursor, stepMonths);
    let lastYear = null;
    for (; cursor.getTime() <= maxT; cursor = addMonthsLondon(cursor, stepMonths)) {
      const year = londonYmd(cursor).slice(0, 4);
      const hasYear = year !== lastYear;
      ticks.push({ t: cursor.getTime(), isDayBoundary: false, hasYear, label: monthLabel(cursor.getTime(), hasYear) });
      lastYear = year;
    }
  }
  return ticks;
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
      intradayAuction: null,
      intradayBand: null,
    });
  }
  for (const p of intradayPoints) {
    const existing = byTime.get(p.t);
    if (existing) {
      existing.intraday = p.price;
      existing.intradayGbp = p.priceGbp;
      existing.intradayProvisional = p.provisional;
      existing.intradayAuction = p.auction;
      existing.intradayBand = p.band;
    } else {
      byTime.set(p.t, {
        t: p.t,
        dayAhead: null,
        dayAheadGbp: null,
        dayAheadProvisional: false,
        intraday: p.price,
        intradayGbp: p.priceGbp,
        intradayProvisional: p.provisional,
        intradayAuction: p.auction,
        intradayBand: p.band,
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

/** "Intraday 1"/"Intraday 2"/"Intraday 3" for the visible tooltip — same
 * AUCTION_LABEL ("intraday 1" etc.) the rest of the site already uses,
 * just capitalised to match "Day ahead"'s casing alongside it. Falls
 * back to the generic "Intraday" for an aggregated point, which has no
 * single source auction (a day's average can blend more than one). */
function intradayDisplayLabel(auction) {
  const label = auction && AUCTION_LABEL[auction];
  return label ? label[0].toUpperCase() + label.slice(1) : "Intraday";
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
    // The specific auction that won the cascade for this exact point, not
    // just "intraday" generically — the composite line can switch which
    // underlying auction it's drawing from at different points across the
    // day, so knowing which one applies here is what lets someone
    // cross-check this exact value against SEMOpx's own per-auction tabs.
    const intradayLabel = (point.intradayAuction && AUCTION_LABEL[point.intradayAuction]) || "intraday";
    parts.push(
      `${intradayLabel} ${formatPence(point.intradayGbp)}p · £${formatGbp(point.intradayGbp)}/MWh${suffix}${point.intradayProvisional ? " (provisional)" : ""}`
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
 * chart/table toggle, and the series toggle (`seriesFilter`: "intraday" |
 * "both" — no standalone "day ahead" option, since Both already carries
 * an unchanged day-ahead line) all live in the parent PriceHistorySection;
 * this component just renders whatever rows it's given, for whichever
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
  const xTicks = useMemo(() => {
    if (!scales) return [];
    return isAggregated ? buildAggregatedTicks(scales.xMin, scales.xMax) : buildSubDayTicks(scales.xMin, scales.xMax);
  }, [scales, isAggregated]);
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

  // The dataset's real extent, not the currently-viewed scope's own span
  // (already visible from the x-axis itself) — shown only alongside the
  // aggregation note (All time/wide Custom), where "how far back does
  // this site's data actually go" is the relevant question. Same
  // earliest/latest this hook also feeds the Ring's date picker and the
  // Help page's coverage note, not a separate calculation of the same
  // fact three times over.
  const { earliest: coverageEarliest, latest: coverageLatest } = useDataCoverage();
  const coverageText =
    coverageEarliest && coverageLatest
      ? `Spanning ${dayLabel(new Date(coverageEarliest).getTime())} – ${dayLabel(new Date(coverageLatest).getTime())} (${daySpanCount(coverageEarliest, coverageLatest)} days).`
      : null;

  const [activeIndex, setActiveIndex] = useState(null);
  const activePoint = activeIndex != null ? tooltipPoints[activeIndex] : null;

  return (
    <div className="chart-box">
      {!scales ? (
        <p className="placeholder-note">{emptyMessage}</p>
      ) : (
        <>
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
            {xTicks
              .filter((tk) => tk.isDayBoundary)
              .map((tk) => (
                <line
                  key={`day-${tk.t}`}
                  x1={scales.x(tk.t)}
                  x2={scales.x(tk.t)}
                  y1={PAD_Y}
                  y2={VIEW_H - PAD_Y}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
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
                  {/* Matches the intraday line's own gradient at this exact
                      point (both keyed off the same per-point band), not a
                      fixed colour — the line's colour genuinely changes
                      along its length, so a static swatch would just be
                      wrong for most points it's shown next to. */}
                  <span className="chart-tooltip-swatch" style={{ background: BAND_HEX[activePoint.intradayBand] }} />
                  {intradayDisplayLabel(activePoint.intradayAuction)} · {formatPence(activePoint.intradayGbp)}p · £
                  {formatGbp(activePoint.intradayGbp)}/MWh
                  {isAggregated ? " avg" : ""}
                  {activePoint.intradayProvisional ? " · provisional" : ""}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="chart-x-labels">
          {xTicks.map((tk) => {
            const pct = (scales.x(tk.t) / VIEW_W) * 100;
            // Centred labels (the default) overflow their own edge once
            // close enough to 0%/100% — most visible on the first tick,
            // now that it can be as wide as "14 Aug 2026" rather than
            // just "14 Aug". Anchored left/right instead of centred once
            // within a label-width's-worth of either edge, so it grows
            // inward from the edge rather than spilling past it.
            const edgeAnchor = pct < 6 ? "start" : pct > 94 ? "end" : "middle";
            const classNames = ["chart-x-label"];
            if (tk.isDayBoundary) classNames.push("chart-x-label-boundary");
            if (tk.hasYear) classNames.push("chart-x-label-year");
            return (
              <span
                key={tk.t}
                className={classNames.join(" ")}
                style={{
                  left: `${pct}%`,
                  transform: edgeAnchor === "start" ? "translateX(0)" : edgeAnchor === "end" ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {tk.label}
              </span>
            );
          })}
        </div>
        </>
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
        {isAggregated && (
          <span className="chart-aggregation-note">
            Showing daily averages — select Today or 7 day for half-hourly detail.
            {coverageText ? ` ${coverageText}` : ""}
          </span>
        )}
        {hasProvisional && <span className="chart-provisional-note">Dashed = provisional, not yet official.</span>}
      </div>
    </div>
  );
}
