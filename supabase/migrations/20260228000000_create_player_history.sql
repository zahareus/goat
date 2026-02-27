-- player_history: stores per-GW BPS data for player profiles
-- Populated by n8n Bootstrap workflow after each GW
CREATE TABLE IF NOT EXISTS player_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  element_id int NOT NULL,            -- FPL player ID
  fixture_id int NOT NULL,            -- FPL fixture ID
  round int NOT NULL,                 -- gameweek number
  opponent_team int,                  -- FPL team ID of opponent
  was_home boolean DEFAULT false,
  kickoff_time timestamptz,
  minutes int DEFAULT 0,
  bps int DEFAULT 0,
  total_points int DEFAULT 0,
  goals_scored int DEFAULT 0,
  assists int DEFAULT 0,
  clean_sheets int DEFAULT 0,
  yellow_cards int DEFAULT 0,
  red_cards int DEFAULT 0,
  UNIQUE(element_id, fixture_id)
);

-- Index for fast lookup by player
CREATE INDEX IF NOT EXISTS idx_ph_element ON player_history(element_id);

-- RLS: public read, service role write
ALTER TABLE player_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read player_history" ON player_history FOR SELECT USING (true);
