-- NI Energy Prices — Supabase schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

-- ── Raw price rows ──────────────────────────────────────────────────────────
create table if not exists ni_prices (
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

create index if not exists ni_prices_datetime_idx on ni_prices (datetime);

-- ── Ingestion watermark ─────────────────────────────────────────────────────
-- Single-row table tracking the PublishTime of the last successfully
-- processed EA-001 report, so the scheduled ingestion workflow only fetches
-- reports newer than what it's already ingested. Kept in Postgres rather
-- than a GitHub Actions artifact so it survives independently of the
-- workflow run history and can't silently expire.
create table if not exists ingestion_state (
  id smallint primary key default 1,
  last_publish_time timestamptz,
  updated_at timestamptz not null default now(),
  constraint ingestion_state_singleton check (id = 1)
);

insert into ingestion_state (id, last_publish_time)
values (1, null)
on conflict (id) do nothing;

-- ── Rolling band view ────────────────────────────────────────────────────────
-- Low / average / peak by rank against the trailing 7 days of prices, not a
-- fixed percentage of their average: each row is compared to every
-- half-hourly price_gbp in the preceding 7 days (same window as before),
-- and banded by which third of that distribution it falls in — bottom
-- third low, top third peak, middle third average. Computed at query time
-- so it's always current rather than stored and going stale.
--
-- (Superseded the original ±15%-of-trailing-average threshold: that could
-- put nearly every price in "average" on a low-volatility week and don't
-- reliably carve out actual thirds the way a rank-based split does.
-- trailing_7d_avg is kept alongside the new trailing_7d_p33/p67 cutoffs —
-- nothing currently reads it, but it's harmless to leave for anyone
-- querying the view directly.)
create or replace view ni_prices_banded as
select
  p.*,
  avg(p.price_gbp) over w as trailing_7d_avg,
  percentile_cont(0.33) within group (order by p.price_gbp) over w as trailing_7d_p33,
  percentile_cont(0.67) within group (order by p.price_gbp) over w as trailing_7d_p67,
  case
    when p.price_gbp < percentile_cont(0.33) within group (order by p.price_gbp) over w then 'low'
    when p.price_gbp > percentile_cont(0.67) within group (order by p.price_gbp) over w then 'peak'
    else 'average'
  end as band
from ni_prices p
where p.market like 'NI%'
window w as (
  order by p.datetime
  range between interval '7 days' preceding and interval '1 second' preceding
);

-- ── Row level security ──────────────────────────────────────────────────────
-- Public read-only access for the anon key used by the frontend. Writes are
-- only ever performed by the GitHub Actions workflow using the service role
-- key, which bypasses RLS entirely, so no insert/update/delete policy is
-- granted to anon/authenticated here.
alter table ni_prices enable row level security;

create policy "Public read access"
  on ni_prices
  for select
  using (true);

grant select on ni_prices to anon, authenticated;
grant select on ni_prices_banded to anon, authenticated;

-- ingestion_state has RLS enabled with no policies at all, so it's
-- unreadable and unwritable by anon/authenticated — only the service role
-- (which bypasses RLS) can touch it.
alter table ingestion_state enable row level security;
