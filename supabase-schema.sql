-- ================================================
-- GOAT App — Supabase Schema
-- Greatest Of All Time — Fantasy Match Picker
-- ================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------
-- PLAYERS (FPL bootstrap cache)
-- Refreshed daily via n8n workflow
-- ------------------------------------------------
CREATE TABLE players (
  element_id   INTEGER PRIMARY KEY,
  code         INTEGER NOT NULL,         -- used for photo URL
  name         TEXT    NOT NULL,
  short_name   TEXT,                     -- e.g. "Salah"
  team_id      INTEGER NOT NULL,
  team_short   TEXT,                     -- e.g. "LIV"
  position     TEXT    NOT NULL CHECK (position IN ('GKP', 'DEF', 'MID', 'FWD')),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------
-- FIXTURES (per gameweek)
-- Refreshed daily via n8n workflow
-- ------------------------------------------------
CREATE TABLE fixtures (
  id             INTEGER PRIMARY KEY,    -- FPL fixture id
  gw             INTEGER NOT NULL,
  home_team_id   INTEGER NOT NULL,
  home_short     TEXT    NOT NULL,       -- e.g. "LIV"
  away_team_id   INTEGER NOT NULL,
  away_short     TEXT    NOT NULL,       -- e.g. "WHU"
  kickoff_time   TIMESTAMPTZ,
  status         TEXT    DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'live', 'ft')),
  home_score     INTEGER DEFAULT 0,
  away_score     INTEGER DEFAULT 0,
  minutes        INTEGER DEFAULT 0,      -- current match minute
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fixtures_gw ON fixtures(gw);

-- ------------------------------------------------
-- BPS RESULTS (per fixture, live + final)
-- Updated every 5 min during GW by n8n workflow
-- ------------------------------------------------
CREATE TABLE results (
  fixture_id   INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  element_id   INTEGER NOT NULL REFERENCES players(element_id) ON DELETE CASCADE,
  bps          INTEGER DEFAULT 0,
  is_goat      BOOLEAN DEFAULT FALSE,    -- highest BPS in this fixture
  is_final     BOOLEAN DEFAULT FALSE,    -- FT confirmed, BPS locked
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (fixture_id, element_id)
);

CREATE INDEX idx_results_fixture ON results(fixture_id);
CREATE INDEX idx_results_goat    ON results(fixture_id, is_goat) WHERE is_goat = TRUE;

-- ------------------------------------------------
-- USER PROFILES
-- Created on first sign-in
-- ------------------------------------------------
CREATE TABLE profiles (
  id           UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_name    TEXT    NOT NULL DEFAULT 'My Team',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------
-- PICKS (1 pick per fixture per user)
-- Locked at kickoff_time per fixture
-- ------------------------------------------------
CREATE TABLE picks (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fixture_id   INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  element_id   INTEGER NOT NULL REFERENCES players(element_id),
  gw           INTEGER NOT NULL,
  locked       BOOLEAN DEFAULT FALSE,   -- TRUE after kickoff
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, fixture_id)          -- 1 pick per match per user
);

CREATE INDEX idx_picks_user_gw ON picks(user_id, gw);
CREATE INDEX idx_picks_fixture  ON picks(fixture_id);

-- ------------------------------------------------
-- GW CONFIG (current gameweek control)
-- Managed manually or by n8n
-- ------------------------------------------------
CREATE TABLE gw_config (
  gw           INTEGER PRIMARY KEY,
  is_active    BOOLEAN DEFAULT FALSE,
  picks_open   BOOLEAN DEFAULT TRUE,
  deadline     TIMESTAMPTZ,
  label        TEXT                     -- e.g. "Premier League — Gameweek 28"
);

-- ================================================
-- ROW LEVEL SECURITY
-- ================================================

ALTER TABLE players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixtures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gw_config ENABLE ROW LEVEL SECURITY;

-- Public read access (anon + auth)
CREATE POLICY "Public read players"   ON players   FOR SELECT USING (TRUE);
CREATE POLICY "Public read fixtures"  ON fixtures  FOR SELECT USING (TRUE);
CREATE POLICY "Public read results"   ON results   FOR SELECT USING (TRUE);
CREATE POLICY "Public read gw_config" ON gw_config FOR SELECT USING (TRUE);
CREATE POLICY "Public read profiles"  ON profiles  FOR SELECT USING (TRUE);

-- Picks: any authenticated user can read all picks (needed for standings)
CREATE POLICY "Authenticated read all picks" ON picks FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "Users insert own picks"  ON picks FOR INSERT
  WITH CHECK (auth.uid() = user_id AND locked = FALSE);
CREATE POLICY "Users update own picks"  ON picks FOR UPDATE
  USING (auth.uid() = user_id AND locked = FALSE);
CREATE POLICY "Users delete own picks"  ON picks FOR DELETE
  USING (auth.uid() = user_id AND locked = FALSE);

-- Profiles: own row only
CREATE POLICY "Users manage own profile" ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- n8n service role bypasses RLS (uses service_role key)

-- ================================================
-- HELPER FUNCTION: auto-create profile on sign-up
-- ================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, team_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ================================================
-- SEED: initial GW config (update as needed)
-- ================================================
INSERT INTO gw_config (gw, is_active, picks_open, label)
VALUES (28, TRUE, TRUE, 'Premier League — Gameweek 28')
ON CONFLICT (gw) DO NOTHING;
