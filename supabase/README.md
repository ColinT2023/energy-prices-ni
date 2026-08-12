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
  band at query time from the trailing 7-day average
- Row level security: public read access on `ni_prices` (and therefore the
  view), no public write access anywhere

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
