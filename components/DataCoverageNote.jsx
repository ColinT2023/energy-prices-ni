"use client";

import { useDataCoverage } from "../hooks/useDataCoverage";
import { formatLongDate, londonYmd, daySpanCount } from "../lib/londonTime";

/**
 * Coverage note for the (otherwise fully static) Help page — the same
 * earliest/latest datetime useDataCoverage also feeds the Ring's date
 * picker and the chart's "All time" caption, so this can't independently
 * drift from what those show; it's the same query and the same
 * daySpanCount, not a second calculation of the same fact.
 *
 * A small client-side island rather than making the Help page itself an
 * async server component that queries Supabase at request time —
 * consistent with how every other live-data read in this app already
 * works (PriceRing, DataAsOf, the chart itself all fetch client-side on
 * mount), rather than introducing the one exception to that pattern for
 * a single non-critical fact. The rest of the Help page renders
 * immediately as static content; this one paragraph appears a moment
 * later once its fetch resolves, same as DataAsOf already does on the
 * home page — renders nothing until it has a real value, never a
 * loading placeholder.
 */
export default function DataCoverageNote() {
  const { earliest, latest } = useDataCoverage();
  if (!earliest || !latest) return null;

  return (
    <p className="glossary-body">
      This site currently holds data from {formatLongDate(londonYmd(new Date(earliest)))} through{" "}
      {formatLongDate(londonYmd(new Date(latest)))} ({daySpanCount(earliest, latest)} days) — the same range the
      price history chart&rsquo;s All time view spans.
    </p>
  );
}
