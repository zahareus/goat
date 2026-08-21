-- pick_slot — where in the pick window a bot submits, as a fraction 0..1.
--
-- hours_before was an absolute number of hours, which silently assumed a fixed gap
-- between rounds. Midweek rounds can open barely a day before kickoff: every bot
-- whose hours_before exceeded that gap then fired on the same tick and the whole
-- field appeared at once. A fraction stretches or compresses with the real window.
-- 0 = the moment picks open, 1 = last call (3h before the first kickoff).
alter table profiles add column if not exists pick_slot numeric(4,3);
