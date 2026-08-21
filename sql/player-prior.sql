-- player_prior — last completed season's aggregate BPS per player.
-- Why: FPL's element-summary endpoint only carries the CURRENT season, so after a
-- rollover player_history is empty and every bot strategy degrades to a coin flip
-- (happened live on GW1 2026/27). history_past gives season totals keyed by the
-- stable element_code, which is enough to rank players until real GWs accumulate.
create table if not exists player_prior (
  element_id integer primary key,
  code integer,
  season text,
  prior_minutes integer not null default 0,
  prior_bps integer not null default 0,
  prior_bps90 numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table player_prior enable row level security;
-- Supabase default privileges auto-grant anon on new tables; server-only table.
revoke all on player_prior from anon, authenticated;
grant all on player_prior to service_role;
