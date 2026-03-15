-- Create bot users in GOAT
-- Run each block in Supabase Dashboard SQL Editor
-- Step 1: Run bot-migration.sql first to add columns
-- Step 2: Create auth users for bots (one per bot)
-- Step 3: Update their profiles with bot flags

-- Example: Create 9 bots with different strategies and timing
-- Adjust team_name, bot_strategy, hours_before as needed

-- Available strategies:
--   form      — Random from top 3 by recent form (BPS last 6 GWs)
--   goat      — Random from top 3 by GOAT count
--   rank      — Random from top 3 by Bayesian avg rank
--   home      — Home team only, best by form
--   away      — Away team only, best by form
--   streak    — Players with rising BPS trend (last 3 GWs)
--   ironman   — Most minutes played this season
--   contrarian— Avoids popular picks, picks from top 5 unpicked
--   combo     — Weighted: form*0.4 + goats*0.3 + rank*0.3
--   fwd_only  — Forwards only, by form
--   mid_only  — Midfielders only, by form
--   def_only  — Defenders + GKPs only, by form
--   chaos     — Fully random available player

-- Step 2: Create auth users for bots
-- (Use Supabase Dashboard > Authentication > Add User for each)
-- Email pattern: bot-[name]@goatapp.club, password: BotGoat2026!
-- After creating users, get their UUIDs and update profiles below.

-- Step 3: After creating auth users, update their profiles:
-- Replace UUIDs with actual values from auth.users

/*
-- Template (uncomment and fill UUIDs):

UPDATE profiles SET
  team_name = 'FormMaster FC',
  is_bot = true,
  bot_strategy = 'form',
  hours_before = 18
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Crown Chasers',
  is_bot = true,
  bot_strategy = 'goat',
  hours_before = 12
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'The Algorithm',
  is_bot = true,
  bot_strategy = 'rank',
  hours_before = 8
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Home Sweet Home',
  is_bot = true,
  bot_strategy = 'home',
  hours_before = 6
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Road Warriors',
  is_bot = true,
  bot_strategy = 'away',
  hours_before = 14
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Hot Streak FC',
  is_bot = true,
  bot_strategy = 'streak',
  hours_before = 10
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Iron Squad',
  is_bot = true,
  bot_strategy = 'ironman',
  hours_before = 4
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Against The Grain',
  is_bot = true,
  bot_strategy = 'contrarian',
  hours_before = 2
WHERE id = 'UUID_HERE';

UPDATE profiles SET
  team_name = 'Balanced XI',
  is_bot = true,
  bot_strategy = 'combo',
  hours_before = 16
WHERE id = 'UUID_HERE';

*/
