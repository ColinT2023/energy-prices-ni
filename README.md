# NI Energy Prices

A single-purpose site showing Northern Ireland's SEM electricity auction
prices: what the price is right now, and how it compares to recent normal.
Data comes straight from SEMOpx's published EA-001 market results — not an
estimate or a forecast.

## How it fits together

```
SEMOpx EA-001 reports
        │
        ▼
GitHub Actions (every 30 min)  ──  scripts/ingest_incremental.py
        │  upsert on (datetime, market)
        ▼
Supabase Postgres  ──  supabase/schema.sql
  ni_prices (raw rows)  →  ni_prices_banded (view, trailing-7d band calc)
        │  fetch + realtime subscription (anon key, RLS read-only)
        ▼
Next.js (this app)
  Price Ring · Price history chart · Table view · Excel export · Help page
```

See `claude_code_brief.md` for the original build brief and design spec.

## Local development

```
npm install
```

Create `.env.local` (see `.env.example`) with your Supabase project's URL
and anon key — get these from Supabase → Project Settings → API. Setting up
the Supabase project itself (schema, credentials) is covered in
[`supabase/README.md`](./supabase/README.md).

```
npm run dev
```

## Ingestion pipeline

The scheduled sync (`.github/workflows/ingest.yml`) needs two repo secrets
set under Settings → Secrets and variables → Actions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS — never put this in `.env.local`
  or anywhere client-side)

For the one-off historical backfill (`scripts/backfill.py`), copy
`scripts/.env.example` to `scripts/.env` with the same two values and run:

```
pip install -r scripts/requirements.txt
python scripts/backfill.py
```

Run this once, before the scheduled workflow has anything to build on top
of. After that, `ingest_incremental.py` (run by the workflow) picks up from
wherever the `ingestion_state` watermark left off.

## Deploying

Hosted on Vercel. Connect this repo, then set the same two frontend env
vars as `.env.local` in the Vercel project settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Nothing else is required — the ingestion workflow runs independently on
GitHub Actions regardless of where the frontend is hosted.

## Project layout

- `app/` — Next.js App Router pages (`/` and `/help`)
- `components/` — Price Ring, chart, table, and section-level UI
- `lib/` — Supabase client, timezone/settlement-period math, Excel export,
  data-shaping helpers shared between components
- `hooks/useNiPrices.js` — scoped fetch + realtime subscription
- `scripts/` — Python ingestion (backfill + incremental) and its shared parser
- `supabase/schema.sql` — database schema, view, and RLS policies
