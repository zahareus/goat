-- Add avatar_url column to profiles table
-- Stores Google OAuth avatar URL for manager profile display
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
