-- Phase 0 of prize economy: close pick-after-kickoff exploit + username tracking
-- Blocker 1: picks write-policies trusted the client-supplied `locked` flag,
-- which nothing ever sets to TRUE — lock existed only in UI. Enforce kickoff in DB.
-- Blocker 2: username was captured once at signup and never refreshed;
-- payouts need a fresh @username on every login.

-- ---- Blocker 1: kickoff enforced by RLS ------------------------------------

DROP POLICY IF EXISTS "Users insert own picks" ON picks;
CREATE POLICY "Users insert own picks" ON picks FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM fixtures f
      WHERE f.id = fixture_id AND f.kickoff_time > NOW()
    )
  );

DROP POLICY IF EXISTS "Users update own picks" ON picks;
CREATE POLICY "Users update own picks" ON picks FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM fixtures f
      WHERE f.id = fixture_id AND f.kickoff_time > NOW()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM fixtures f
      WHERE f.id = fixture_id AND f.kickoff_time > NOW()
    )
  );

DROP POLICY IF EXISTS "Users delete own picks" ON picks;
CREATE POLICY "Users delete own picks" ON picks FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM fixtures f
      WHERE f.id = fixture_id AND f.kickoff_time > NOW()
    )
  );

-- picks.locked is now dead weight for RLS but kept for UI compatibility (Chesterton).

-- ---- Blocker 2: fresh username per login -----------------------------------

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
-- NOTE: anon column-grant on profiles must NOT include telegram_username.
-- profiles SELECT for anon stays scoped to (id, team_name, avatar_url, is_bot).
