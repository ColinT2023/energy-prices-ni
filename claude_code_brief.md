# NI Energy Prices — build brief

## What this is

A public, single purpose website showing Northern Ireland's SEM electricity
auction prices. Not a news site, not an NIW product, a personal project in
the same family as Peak Flow Diary. The job of the page is to answer one
question at a glance: what's the electricity price right now, and how does
that compare to recent normal.

## Data source

SEMOpx Website Report API, report `DPuG_ID=EA-001` ("ETS Market Results").
No authentication required.

- Report list: `https://reports.semopx.com/api/v1/documents/static-reports?DPuG_ID=EA-001&Date=>=YYYY-MM-DD&page=N&page_size=100&sort_by=PublishTime&order_by=ASC`
- Individual report file: `https://reports.semopx.com/documents/[ResourceName]`

Report files are semicolon delimited text (not standard CSV), with repeated
blocks per market area:

```
Auction;SEM-IDA2
Auction name;PWR-SEM-GB-D
Auction date time;2026-08-11T07:00:00Z
Publication date time;2026-08-11T07:30:00Z
FX rates
EUR;GBP;0,85631101
Market;NI-IDA2
Index prices;30;EUR
2026-08-11T10:00:00Z;2026-08-11T10:30:00Z;...
132,32;118,30;...
Index prices;30;GBP
2026-08-11T10:00:00Z;...
113,31;101,30;...
Index volumes;30
2026-08-11T10:00:00Z;...
<volumes, not currently used>
Market;ROI-IDA2
...repeats...
```

Decimal separator is a comma, not a full stop. Only `Market` blocks starting
with `NI` are relevant. Working parser and backfill logic already exists in
`build_ni_price_table.py`, reuse that logic rather than rewriting it.

Auction types and their approximate daily publish windows (for polling
purposes, not for hardcoding a fixed schedule, always check
`PublishTime` rather than assuming):

| Auction | Meaning | Roughly published |
|---|---|---|
| SEM-DA | Day ahead | Afternoon, previous day |
| SEM-IDA1 | Intraday 1 | Evening, previous day |
| SEM-IDA2 | Intraday 2 | Early morning, same day |
| SEM-IDA3 | Intraday 3 | Early afternoon, same day |

## Ingestion pipeline

**GitHub Actions scheduled workflow**, running every 30 minutes:

1. Query the EA-001 report list, filtered to reports with `PublishTime`
   after the last successful run (store this watermark in the database or
   as a workflow artifact)
2. Download and parse each new report using the existing Python logic
3. Upsert rows into Supabase, keyed on a unique constraint so re-running
   never duplicates data
4. Log a summary (rows written, any parse failures) so failures are
   visible without needing to check the site itself

Use the Supabase Python client (`supabase-py`) or plain `psycopg2` against
the Postgres connection string, whichever is simpler to wire up. Store the
Supabase service role key as a GitHub Actions secret, never commit it.

## Database schema (Supabase Postgres)

```sql
create table ni_prices (
  id bigint generated always as identity primary key,
  datetime timestamptz not null,
  market text not null,        -- e.g. NI-DA, NI-IDA1, NI-IDA2, NI-IDA3
  auction text not null,       -- e.g. SEM-DA, SEM-IDA1
  price_eur numeric,
  price_gbp numeric,
  source_file text not null,
  inserted_at timestamptz not null default now(),
  unique (datetime, market)
);

create index on ni_prices (datetime);
```

The `unique (datetime, market)` constraint is what makes ingestion safely
re-runnable, use `ON CONFLICT (datetime, market) DO UPDATE` so a later
auction's revision for the same period overwrites the earlier one.

### Rolling band calculation

Low / average / peak bands are relative to the trailing 7 day average, not
a fixed threshold and not the day's own min/max (this was a deliberate
decision, see reasoning below). Compute this at query time with a view
rather than storing it, so it's always current:

```sql
create or replace view ni_prices_banded as
select
  p.*,
  avg(p.price_gbp) over (
    order by p.datetime
    range between interval '7 days' preceding and interval '1 second' preceding
  ) as trailing_7d_avg,
  case
    when p.price_gbp < 0.85 * avg(p.price_gbp) over (
      order by p.datetime range between interval '7 days' preceding and interval '1 second' preceding
    ) then 'low'
    when p.price_gbp > 1.15 * avg(p.price_gbp) over (
      order by p.datetime range between interval '7 days' preceding and interval '1 second' preceding
    ) then 'peak'
    else 'average'
  end as band
from ni_prices p
where p.market like 'NI%';
```

The ±15% thresholds are a starting point, not fixed, tune them once real
data is flowing and the band distribution can actually be checked against
what looks useful.

Why rolling 7 day rather than the alternatives: a per-day relative scale
would mislead on a calm, low-volatility day, painting its top segments as
"peak" even though they're cheap by any normal standard. A fixed year
round threshold goes the other way, on a genuinely expensive week the
whole ring turns uniformly red and stops helping with within-day
decisions. Trailing 7 days drifts with the season while preserving useful
day to day contrast.

## Frontend

Next.js, hosted on Vercel, Supabase client for both the initial data fetch
and a real time subscription so the page updates live when the ingestion
job writes new rows (same pattern as Peak Flow Diary).

### Pages

- **Home**: the Price Ring, current price, price history chart, table
  view, all described below
- **Help**: the glossary content already drafted in `ni_energy_glossary.md`

### Design tokens

```
--bg: #1C1C1E
--bg-raised: #29292C
--line: #3D3D40
--text: #F2F2F0
--text-muted: #9A9A9E
--low: #0B7FC3      (blue)
--average: #FABA05  (gold)
--peak: #E72C7A     (magenta)
```

Type: Space Grotesk (display, price number and page title), Inter (body
copy), IBM Plex Mono (labels, meta text, all numeric data, tabular
figures).

No NIW logo anywhere. The colour palette is derived from the NIW 2025
PowerPoint theme by deliberate choice, kept separate from any implication
of NIW endorsement.

Colour is reserved for exactly one meaning throughout, price level. Every
other visual distinction (structure, current period, chart baseline) uses
neutral tones, white outlines, or dot/halo markers, never a new hue.

### The Price Ring

A working static reference build exists in `ni_price_ring_mock.html`,
follow its structure and token usage exactly, then add:

- **Hover tooltips** on each segment, showing the settlement period time,
  the price, and how it compares to the trailing 7 day average (e.g.
  "13:00–13:30 · 18.3p · average")
- Segments are one per half hourly settlement period (48 total), coloured
  by band, hour markers at the seam between each pair of half hourly
  segments, major labels at 00:00/03:00/06:00/09:00/12:00/15:00/18:00/21:00
- Current period gets a filled dot with a soft pulsing halo outside the
  ring (respect `prefers-reduced-motion`), distinct from the thin static
  hour ticks
- Centre shows the live price, a small dot matching the current segment's
  band colour, and the current settlement period, all in the same colour
  as the lit segment

### Price history chart

- Toggle: Today / 7 day / Full 2026, defaulting to Today
- Day ahead line: solid, neutral (`--text`)
- Latest intraday line: gradient stroke through `--low` → `--average` →
  `--peak` following the actual price shape, not a flat accent colour,
  this keeps colour meaning exactly one thing across the whole page

### Table view

A sortable table alongside the ring/chart view (toggle or tab between
visual and tabular), same Today/7 day/Full 2026 scope as the chart.
Columns: settlement period, auction, price (p/kWh), price (£/MWh), band.

### Excel export

Client side `.xlsx` export of whatever's currently in view (respecting the
active Today/7 day/Full 2026 selection), using a library like SheetJS.

### Accessibility and quality floor

- Responsive down to mobile
- Visible keyboard focus states throughout
- `prefers-reduced-motion` respected on the pulse animation
- Colour bands are not the only way to read price level, hover tooltips
  and the table view carry the same information as text/numbers

### Footer disclaimer

Carry this note, adapted from the drafted glossary:

> This site shows real auction results from SEMOpx, not an estimate or a
> forecast. Prices are pulled and converted automatically, so treat the
> figures as informational. Don't use this site as the sole basis for
> switching tariff, timing large energy use, or any financial decision.

## Reference files

- `build_ni_price_table.py` — working ingestion/parsing logic to adapt
  for the GitHub Actions workflow
- `ni_price_ring_mock.html` — static reference for the ring, tokens and
  layout
- `ni_energy_glossary.md` — help page content
