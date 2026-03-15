-- Bot system migration for GOAT
-- Run via Supabase Dashboard SQL Editor

-- Add bot columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bot_strategy TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hours_before INTEGER DEFAULT 12;

-- Allow service_role to manage bot profiles (RLS bypass via service_role key)
-- No additional policies needed — service_role already bypasses RLS

-- Index for quick bot lookups
CREATE INDEX IF NOT EXISTS idx_profiles_bot ON profiles(is_bot) WHERE is_bot = true;
