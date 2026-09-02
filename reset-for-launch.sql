-- reset-for-launch.sql
-- ONE-TIME operational script — not an app migration, don't run this on a
-- live league later or you'll wipe real history. Run manually in Supabase
-- SQL Editor when you're ready to go live.
--
-- Deletes all match/rating history and resets every player back to a clean
-- starting state. Respects foreign keys: elo_history -> matches -> players.

-- 1. Wipe rating history (references matches + profiles)
delete from elo_history;

-- 2. Wipe all matches (pending, disputed, completed — everything)
delete from matches;

-- 3. Reset every player row back to starting values.
--    `uncertainty` is reset to its table default rather than a hardcoded
--    number — check `\d players` or the Table Editor if you want to confirm
--    what that default actually is.
update players
set rating        = 1000,
    uncertainty   = default,
    streak        = 0,
    season_wins   = 0,
    season_losses = 0,
    career_wins   = 0,
    career_losses = 0,
    last_played   = null;

-- Optional — only if `player1` / `player2` (or other test accounts) should
-- NOT be part of the real club. This deletes their profile + players rows.
-- Their auth.users row is separate; delete that from Authentication ->
-- Users in the dashboard if you want the login gone too.
--
-- delete from players  where profile_id in (select id from profiles where username in ('player1', 'player2'));
-- delete from profiles where username in ('player1', 'player2');
