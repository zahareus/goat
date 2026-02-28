-- Telegram bot integration: new columns on profiles + lookup function
-- Run in Supabase SQL Editor

-- 1. New columns for Telegram linking
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_pending_chat_id BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_verify_code TEXT,
  ADD COLUMN IF NOT EXISTS telegram_verify_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_verify_attempts INT DEFAULT 0;

-- 2. Function to look up profile by email (used by bot with service role key)
CREATE OR REPLACE FUNCTION get_profile_by_email(lookup_email TEXT)
RETURNS TABLE (
  id UUID,
  team_name TEXT,
  telegram_chat_id BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.id, p.team_name, p.telegram_chat_id
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE LOWER(u.email) = LOWER(lookup_email)
  LIMIT 1;
$$;
