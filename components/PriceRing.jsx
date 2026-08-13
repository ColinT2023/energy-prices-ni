"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNiPrices } from "../hooks/useNiPrices";
import { useProvisionalPrices } from "../hooks/useProvisionalPrices";
import { dayRange, TODAY_NOT_PUBLISHED_MESSAGE } from "../lib/priceRange";
import {
  londonMidnightUtc,
  londonYmd,
  settlementPeriodIndex,
  formatLondonTime,
  formatLongDate,
  shiftYmd,
  periodsInLondonDay,
} from "../lib/londonTime";
import { latestPerPeriod, mergeWithProvisional, AUCTION_LABEL, BAND_EXPLANATION } from "../lib/priceSeries";
import styles from "./PriceRing.module.css";

// Segment count is *not* a fixed 48: the UK/Ireland clock change days have
// 46 (spring forward, 01:00-02:00 skipped) or 50 (clocks back,
// 01:00-02:00 repeats) — see periodsInLondonDay. Every angle below is
// computed from the actual period count for the selected day rather than
// assuming 48.
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

/**
 * Price Ring for a single day — defaults to today, with previous/next day
 * arrows and a date picker to browse any earlier day back to the first
 * one with data. Owns its own data fetch (day-scoped, not the open-ended
 * "today onward" the rest of the page uses) so this stays self-contained.
 */
export default function PriceRing({ provisionalEnabled = false, onEnableProvisional }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const todayYmd = useMemo(() => londonYmd(now), [now]);

  const [selectedDate, setSelectedDate] = useState(() => londonYmd(new Date()));
  const isToday = selectedDate === todayYmd;

  // Earliest navigable day — fetched once, not hardcoded, so this tracks
  // wherever the backfill/ingestion actually starts rather than an
  // assumed season-start date.
  const [earliestDate, setEarliestDate] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("ni_prices")
      .select("datetime")
      .order("datetime", { ascending: true })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data[0]) setEarliestDate(londonYmd(new Date(data[0].datetime)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Latest date actually present in ni_prices — day ahead auctions publish
  // in the afternoon for the *next* day's delivery, so by evening this can
  // genuinely be ahead of todayYmd. The nav ceiling below tracks whichever
  // is later, so tomorrow becomes reachable the moment its data exists
  // rather than being blocked by a hardcoded "today".
  const [latestDataDate, setLatestDataDate] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("ni_prices")
      .select("datetime")
      .order("datetime", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data[0]) setLatestDataDate(londonYmd(new Date(data[0].datetime)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Navigation ceiling — today by default, but never earlier than the
  // actual latest date with data, so this only ever moves forward past
  // today, never restricts below it (e.g. while ingestion is behind).
  const navUpperBound = latestDataDate && latestDataDate > todayYmd ? latestDataDate : todayYmd;

  const range = useMemo(() => dayRange(selectedDate), [selectedDate]);
  const { rows, loading, error } = useNiPrices(range);

  // Fetched unconditionally — not gated by provisionalEnabled — for
  // whichever day is selected, not just today. Two different things read
  // this: the empty state below needs to know whether provisional data
  // exists even while the toggle is off, so it can offer to turn it on
  // rather than just saying "nothing yet" when there's actually something
  // available; mergedRows still only folds it into what's rendered when
  // the toggle is actually on, so the Ring itself never shows provisional
  // data until someone turns it on — fetching it early doesn't change
  // that. (The backend's own nothing_left_to_poll() is what actually
  // decides how far back provisional data can exist, today plus a
  // bounded trailing window into yesterday, so this doesn't keep a second
  // copy of that boundary to predict it in advance — a day outside that
  // window just gets an empty result.)
  const provisionalRows = useProvisionalPrices(true, range);
  const mergedRows = useMemo(
    () => (provisionalEnabled ? mergeWithProvisional(rows, provisionalRows) : rows),
    [rows, provisionalRows, provisionalEnabled]
  );

  const dayStart = useMemo(() => londonMidnightUtc(new Date(selectedDate)), [selectedDate]);
  const periods = useMemo(() => periodsInLondonDay(new Date(selectedDate)), [selectedDate]);

  const segmentsByIndex = useMemo(() => {
    const byIndex = new Map();
    for (const row of latestPerPeriod(mergedRows)) {
      const idx = settlementPeriodIndex(row.datetime, dayStart);
      if (idx >= 0 && idx < periods) byIndex.set(idx, row);
    }
    return byIndex;
  }, [mergedRows, dayStart, periods]);

  // Major-hour label -> segment index lookup, walking only even indices
  // (every segment that starts a new local hour). Built from the actual
  // per-segment wall-clock label rather than a fixed 2-segments-per-hour
  // formula, since that formula only holds before any clock change that day.
  const majorHourIndex = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < periods; i += 2) {
      const label = formatLondonTime(dayStart.getTime() + i * 30 * 60000);
      if (MAJOR_HOUR_LABELS.has(label)) map.set(label, i);
    }
    return map;
  }, [dayStart, periods]);

  // "Now" only means anything on today's ring — a past day has no live
  // period, so there's nothing to highlight or pulse.
  const currentIndex = isToday ? Math.min(settlementPeriodIndex(now, dayStart), periods - 1) : null;
  const current = currentIndex != null ? segmentsByIndex.get(currentIndex) : undefined;
  const currentColour = current ? BAND_COLOUR[current.band] : "var(--text-muted)";

  const [activeIndex, setActiveIndex] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  function segmentTooltip(index, row) {
    const label = periodLabel(dayStart.getTime() + index * 30 * 60000);
    if (!row) return `${label} · no data`;
    const provisionalNote = row.provisional ? " · provisional, not yet official" : "";
    return `${label} · ${gbpToPence(row.price_gbp).toFixed(1)}p · ${row.band}${provisionalNote}`;
  }

  const canGoPrevious = !earliestDate || selectedDate > earliestDate;
  const canGoNext = selectedDate < navUpperBound;

  function goToPreviousDay() {
    const prev = shiftYmd(selectedDate, -1);
    if (!earliestDate || prev >= earliestDate) setSelectedDate(prev);
  }
  function goToNextDay() {
    const next = shiftYmd(selectedDate, 1);
    if (next <= navUpperBound) setSelectedDate(next);
  }

  const dayNav = (
    <div className={styles.dayNav}>
      <button
        type="button"
        className={styles.dayNavButton}
        onClick={goToPreviousDay}
        disabled={!canGoPrevious}
        aria-label="Previous day"
      >
        ‹
      </button>
      <input
        type="date"
        className={styles.dayNavInput}
        value={selectedDate}
        min={earliestDate || undefined}
        max={navUpperBound}
        onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
        aria-label="Select day"
      />
      <button
        type="button"
        className={styles.dayNavButton}
        onClick={goToNextDay}
        disabled={!canGoNext}
        aria-label="Next day"
      >
        ›
      </button>
    </div>
  );

  // Plain counts of what's actually rendered for the selected day, not
  // just whether each source has *any* data — two on/off dots looked
  // identical whether a day was 46 official + 2 provisional or an even
  // split, understating how much of a day is actually confirmed in
  // exactly the direction worth avoiding. Counted from segmentsByIndex
  // itself, the same map the ring's segments render from, so this always
  // matches what's on screen rather than what was merely fetched.
  const sourceCounts = useMemo(() => {
    let official = 0;
    let provisional = 0;
    for (const row of segmentsByIndex.values()) {
      if (row.provisional) provisional++;
      else official++;
    }
    return { official, provisional };
  }, [segmentsByIndex]);

  const sourceStatus = provisionalEnabled && (
    <div className="source-status">
      {sourceCounts.official} official
      {sourceCounts.provisional > 0 ? ` · ${sourceCounts.provisional} provisional` : ""}
    </div>
  );

  if (error) {
    return (
      <div className={styles.ringCol}>
        {dayNav}
        {sourceStatus}
        <div className={styles.ringWrap}>
          <div className={styles.emptyState}>
            <p role="alert">Couldn&apos;t load prices: {error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Normal for part of today specifically — day-ahead publishes the
  // afternoon before delivery, not at midnight — so that's a "check back
  // later" state, not an error. A past day with nothing recorded is a
  // genuine gap, worded differently. Either way this replaces the whole
  // ring rather than leaving 48 silent grey "no data" segments. When the
  // toggle's on, provisional rows are already merged into segmentsByIndex
  // above, so this only triggers when *neither* source has anything for
  // the day. When the toggle's off, though, official can be genuinely
  // empty while provisional (fetched unconditionally, see above) actually
  // has something — that's the one case with an actionable answer instead
  // of "check back later": offer to turn the toggle on right here, rather
  // than expecting someone to separately notice the header text or find
  // the checkbox themselves.
  if (!loading && segmentsByIndex.size === 0) {
    const provisionalPeriodCount = new Set(provisionalRows.map((row) => row.datetime)).size;
    const canOfferProvisional = isToday && !provisionalEnabled && provisionalPeriodCount > 0;
    return (
      <div className={styles.ringCol}>
        {dayNav}
        {sourceStatus}
        <div className={styles.ringWrap}>
          <div className={styles.emptyState}>
            {canOfferProvisional ? (
              <p>
                No confirmed prices yet, but {provisionalPeriodCount} provisional price
                {provisionalPeriodCount === 1 ? " is" : "s are"} available now.{" "}
                <button type="button" className="inline-link-button" onClick={onEnableProvisional}>
                  Show provisional prices
                </button>
              </p>
            ) : (
              <p>{isToday ? TODAY_NOT_PUBLISHED_MESSAGE : `No prices recorded for ${formatLongDate(selectedDate)}.`}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.ringCol}>
      {dayNav}
      {sourceStatus}
      <div className={styles.ringWrap}>
        <svg viewBox="0 0 380 380" width="100%" height="100%">
          {Array.from({ length: periods }, (_, i) => {
            const row = segmentsByIndex.get(i);
            const startAngle = (360 / periods) * i - 90 + GAP_DEG / 2;
            const endAngle = (360 / periods) * (i + 1) - 90 - GAP_DEG / 2;
            const d = describeArc(CENTRE, CENTRE, OUTER_R, INNER_R, startAngle, endAngle);
            const isCurrent = i === currentIndex;
            const isProvisional = !!row?.provisional;
            // Provisional segments get a dashed outline in their own band
            // colour and a dimmer fill — structurally different from a
            // confirmed segment, not just a label, so it can't be mistaken
            // for one at a glance or in a screenshot. The "now" highlight
            // (solid stroke) still wins visually when a segment is both
            // current and provisional, since "this is now" and "this is
            // unconfirmed" are two different things to communicate at once.
            return (
              <path
                key={i}
                d={d}
                fill={row ? BAND_COLOUR[row.band] : "var(--line)"}
                opacity={isCurrent ? (isProvisional ? 0.85 : 1) : isProvisional ? 0.4 : 0.6}
                stroke={isCurrent ? "var(--now-stroke)" : isProvisional ? BAND_COLOUR[row.band] : "none"}
                strokeWidth={isCurrent ? 2 : isProvisional ? 1.2 : 0}
                strokeDasharray={!isCurrent && isProvisional ? "3 2" : undefined}
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

          {currentIndex != null &&
            (() => {
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
            {isToday ? (
              <>
                <span className={styles.priceDot} style={{ background: currentColour }} />
                {current ? `${gbpToPence(current.price_gbp).toFixed(1)}p` : "—"}
              </>
            ) : (
              formatLongDate(selectedDate)
            )}
          </div>
          {isToday && (
            <>
              {current && <div className={styles.gbpPrice}>£{Math.round(current.price_gbp)}/MWh</div>}
              <div className={styles.unit}>
                per kWh{current ? ` · ${AUCTION_LABEL[current.auction] ?? current.auction}` : ""}
                {current?.provisional ? " · provisional" : ""}
              </div>
              <div className={styles.period} style={{ color: currentColour }}>
                {periodLabel(dayStart.getTime() + currentIndex * 30 * 60000)} · now
              </div>
            </>
          )}
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
        <span className="legend-info-wrap">
          <button
            type="button"
            className="info-button"
            aria-label="How low, average, and peak are worked out"
            onMouseEnter={() => setInfoOpen(true)}
            onMouseLeave={() => setInfoOpen(false)}
            onFocus={() => setInfoOpen(true)}
            onBlur={() => setInfoOpen(false)}
          >
            i
          </button>
          {infoOpen && (
            <span className="info-tooltip" role="tooltip">
              {BAND_EXPLANATION}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
