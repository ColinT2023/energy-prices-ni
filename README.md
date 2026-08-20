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

### Known pattern: a daily watermark stall, not a bug — usually ~24h, occasionally longer

Observed over 6 consecutive days (13–18 Aug 2026), via `ni_prices.inserted_at`
gaps, direct polling of the actual report URL, and the workflow's own run
logs: the watermark reliably freezes at least once a day, then clears in
one batch. Gaps between successful advances: 23.9h, 24.0h, 24.2h, 25.5h —
each resolving around 00:00–01:40 UTC — **then one instance (16→18 Aug)
took ~39.5h**, confirmed by directly polling the stuck report's real CSV
URL every 20 minutes from 2026-08-17T10:03Z until it finally returned real
content at 2026-08-18T02:17:36Z, against a report whose own filename
timestamp claimed generation at 2026-08-16T10:55:01Z. Revise the "usually
~24h" expectation accordingly — it's not a hard ceiling, and a next
occurrence running past 24h isn't on its own a sign of a new problem,
though a *repeat* of the ~39.5h case (or worse) would be worth treating as
the pattern genuinely getting worse rather than one long outlier.

The cause each time: at least one SEMOpx EA-001 report (so far, `SEM-DA`
specifically — the one report type guaranteed to appear exactly once a day)
sits *listed* on SEMOpx's report API but its actual file content isn't
downloadable yet (`GET .../documents/{ResourceName}` returns
`{"errorMessage":"","code":0}` instead of CSV). `ingest_incremental.py`
deliberately never advances the watermark past a run with any failure (see
its docstring), so the entire batch — not just the stuck report — is
retried every run until the stuck one finally resolves. That has always
happened eventually (the ~39.5h case included) — no instance so far has
required manual intervention — but "eventually" is no longer safely
described as "within about a day" given that outlier.

This is a real, currently-accepted trade-off, not something to silently
work around: the upside is a hard no-permanent-loss guarantee (nothing is
ever skipped, so a report that comes back after a stall still lands
correctly); the downside is that any single persistently-stuck report
freezes *all* forward progress, including for unrelated newer reports that
would otherwise succeed, for as long as it stays stuck. No bypass/skip
mechanism exists for this on purpose — a bypass that advanced the watermark
past a stuck report would drop it out of every future
`get_new_ea001_reports()` query and its data would be permanently missing
unless separately tracked, which is real added complexity that hasn't been
judged worth it against a pattern that has fully self-healed every day so
far.

If this pattern is ever being re-investigated: check whether it's still
resolving daily (healthy, matches this baseline) versus taking
increasingly longer, spanning multiple auction types instead of just
SEM-DA, or not resolving at all (worth actually addressing, unlike the
baseline case this note describes).

### Provisional ingestion's real trigger: a Cloudflare Worker, not GitHub's schedule

`ingest-provisional.yml` has no `schedule:` trigger — only `workflow_dispatch:`.
This is deliberate: measured directly this session, GitHub's own scheduler was
dropping roughly half (later measured closer to 80% once both ingestion
workflows were compared side by side) of this workflow's `*/15`-interval
triggers under load — a documented GitHub Actions limitation ("if the load is
sufficiently high enough, some queued jobs may be dropped"), not something a
tighter cron interval or a workflow-file change can fix from the inside.

Instead, a small Cloudflare Worker (`cloudflare/provisional-cron/`) runs on
its own Cron Trigger every 5 minutes and calls this workflow's
`workflow_dispatch` API directly — an endpoint that isn't subject to GitHub's
schedule-trigger queue, so it sidesteps the drop rather than trying to
outguess it. See `cloudflare/provisional-cron/wrangler.toml` for why 5
minutes specifically, and `cloudflare/provisional-cron/src/index.js` for the
dispatch call itself.

This depends on two things that live outside this repo and aren't part of
its own setup:

- A **Cloudflare account** hosting the Worker, with `GITHUB_DISPATCH_TOKEN`
  set as an encrypted Worker secret (`wrangler secret put
  GITHUB_DISPATCH_TOKEN`) — never committed, never in `wrangler.toml`.
- A **GitHub personal access token** (fine-grained, or classic with the
  `workflow` scope) with permission to dispatch workflows on this repo, used
  as that secret's value.

The official "Ingest NI prices" workflow (`ingest.yml`) is untouched — it
still uses GitHub's own `schedule:` trigger, and this Worker only ever calls
the provisional one.

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
