# Supabase setup

## 1. Create the project

Create a new project at [supabase.com](https://supabase.com) (free tier is
fine). Pick any region and a database password (you won't need the password
directly — the app talks to Supabase via its API keys, not a raw Postgres
connection).

## 2. Apply the schema

Open **SQL Editor → New query** in the Supabase dashboard, paste the full
contents of [`schema.sql`](./schema.sql), and run it. This creates:

- `ni_prices` — raw half-hourly price rows, unique on `(datetime, market)`
- `ingestion_state` — single-row watermark the ingestion workflow uses to
  know which reports it's already processed
- `ni_prices_banded` — a view over `ni_prices` computing the low/average/peak
  band at query time by ranking each row against the trailing 7 days of
  prices (bottom third low, top third peak, middle third average)
- `ni_prices_provisional` — unofficial price rows from `scripts/ingest_provisional.py`,
  entirely separate from `ni_prices`, never merged into it. Powers the
  "Show provisional prices" toggle on the site (off by default) — see that
  script and the table's comment in `schema.sql` for the full context.
- `ni_prices_provisional_banded` — same band logic as `ni_prices_banded`,
  applied to the provisional table, still judged against `ni_prices`' own
  trailing 7-day window rather than provisional's own (unconfirmed) history
- Row level security: public read access on `ni_prices` and
  `ni_prices_provisional` (and therefore their views), no public write
  access anywhere

Since `create or replace view` is idempotent, re-running the whole file is
always safe — including after pulling a schema.sql update like the switch
from a fixed ±15%-of-average threshold to the rank-based bands above,
which only touches the `ni_prices_banded` definition.

## 3. Collect credentials

From **Project Settings → API**, you'll need three values, used in two
different places:

| Value | Used by | How to share it |
|---|---|---|
| Project URL | Frontend (`NEXT_PUBLIC_SUPABASE_URL`) and ingestion workflow (`SUPABASE_URL`) | Safe to paste in chat |
| `anon` public key | Frontend (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Safe to paste in chat |
| `service_role` secret key | Ingestion workflow only (`SUPABASE_SERVICE_ROLE_KEY`) | **Do not paste in chat** — add it directly as a GitHub Actions secret (repo → Settings → Secrets and variables → Actions → New repository secret) |

The service role key bypasses row level security, so it must never end up in
the frontend bundle or in a chat log — only in the GitHub Actions secret and
your local `.env` when running the one-off backfill script.

## 4. Local env files

Once you have the Project URL and anon key, create `.env.local` in the
Next.js app root (see `.env.example`) and a `.env` next to the ingestion
scripts (see `scripts/.env.example`) for the backfill run.

## 5. Provisional ingestion kill switch (optional)

`.github/workflows/ingest-provisional.yml` reads a `PROVISIONAL_INGESTION_ENABLED`
repo **Variable** (Settings → Secrets and variables → Actions → Variables
tab — not a secret, it isn't sensitive). Leave it unset to run normally;
set it to `false` to stop the provisional job doing anything at all,
without a code deploy, if the undocumented endpoint it depends on ever
breaks or needs to be turned off.
