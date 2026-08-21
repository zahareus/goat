-- odds_cache — de-vigged home-side weight per fixture from the-odds-api.
-- Why a table: Vercel functions are stateless, and the free tier is 500 calls a
-- MONTH shared with ledap. Without this, bot-picks would burn the quota on every
-- n8n tick and take ledap's odds down with it.
create table if not exists odds_cache (
  fixture_id integer primary key,
  weight_home numeric not null,
  fetched_at timestamptz not null default now()
);
alter table odds_cache enable row level security;
revoke all on odds_cache from anon, authenticated;
grant all on odds_cache to service_role;
