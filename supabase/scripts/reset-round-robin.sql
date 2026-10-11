-- reset-round-robin.sql
-- ONE-TIME operational script — not an app migration, don't run this on a
-- season you actually care about, it's a hard delete. Run manually in
-- Supabase SQL Editor whenever you want to clear out test data or start a
-- season over from scratch.
--
-- `tournaments` cascades to everything else (tournament_participants,
-- tournament_weeks, tournament_matches all reference it on delete
-- cascade), so deleting the season row is enough — nothing else needs a
-- separate delete.

-- 1. Find the league and/or season you want to clear.
select id, name from leagues order by name;
select id, name, status, created_at from tournaments order by created_at desc;

-- 2a. Wipe ONE specific season (recommended — leaves other seasons/leagues alone)
-- delete from tournaments where id = 'PASTE_TOURNAMENT_ID_HERE';

-- 2b. Wipe EVERY round robin season for one league
-- delete from tournaments where league_id = 'PASTE_LEAGUE_ID_HERE';

-- 2c. Wipe every round robin season across every league (rarely what you want)
-- delete from tournaments;
