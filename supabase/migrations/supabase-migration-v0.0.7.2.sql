-- ═══════════════════════════════════════════════════════════════════
-- v0.0.7.2 — Matches are first to 4, or a full set to 6
--
-- WHY
--   The club plays first to 4 games (no-ad) and, when other courts or
--   players are still playing, sometimes plays a full set to 6 instead.
--   v0.0.6.8 allowed only first to 6, which did not match how matches are
--   really played. Both are now legal, in the same season, match by match.
--
-- RULE
--   The score itself says which format was played. A result is legal if
--     - the winner has exactly 4 and the loser 0 to 3  (first to 4), or
--     - the winner has exactly 6 and the loser 0 to 5  (a full set to 6;
--       at 5-5 the next game wins, so 6-5 is a finished set).
--   Anything else (5-3, 7-5, 4-4 ...) is refused.
--   There is no format column and no season setting: nothing to choose
--   when reporting a match.
--
--   Match points: a win is 4. A loss earns 0 to 3 by how close it was,
--   relative to the target the winner reached:
--       round(3 * games won / (target - 1)), halves rounded up
--     first to 4 :  0-4 earns 0, 1-4 earns 1, 2-4 earns 2, 3-4 earns 3
--                   (exactly the scale first-to-4 matches always had)
--     set to 6   :  0-6 earns 0, 1-6 and 2-6 earn 1, 3-6 and 4-6 earn 2,
--                   5-6 earns 3
--   A loss one game short of the target earns 3 in either format.
--   Battle pass XP is still 4 per match point.
--
-- WHAT THIS CHANGES
--   1. rr_score_is_legal(): the rule above.
--   2. rr_match_points(): the proportional loss scale. The target is read
--      from the winner's score, so the function still takes (won, lost).
--   3. rr_games_to_win() is dropped (there is no longer one target).
--   4. report_tournament_match(): same body as v0.0.6.8, but the "not a
--      legal score" message describes both formats.
--   5. rr_points is recomputed for every tournament under the new scale
--      (the same backfill as v0.0.6.4). First-to-4 results keep exactly the
--      points they had. Matches already played to 6 under v0.0.6.8 are
--      re-scored: a 2-6, 3-6 or 4-6 loss now earns 1, 2 or 2 instead of
--      2, 3 or 3. The notices below say how many matches that is.
--   6. An audit lists completed matches whose score is not legal under the
--      rule. It changes nothing.
--
-- PLAY XP
--   Play XP is recomputed from match history every time /progress is
--   opened, so matches played to 6 in weeks the v0.0.6.4 rule already
--   covers are re-scored then (4 XP per point under the new scale). Weeks
--   before that rule keep their flat 15 XP per match, as before.
--
-- Requires v0.0.6.4. It replaces what v0.0.6.8 did, so it works whether or
-- not 6.8 was run. Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.rr_score_is_legal(integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.3.sql first (it creates rr_score_is_legal).';
  end if;
  if to_regprocedure('public.report_tournament_match(uuid,integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.3.sql first (it creates report_tournament_match).';
  end if;
  if to_regprocedure('public.rr_match_points(integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.4.sql first (it creates rr_match_points).';
  end if;
end $$;

-- ── 1. What counts as a finished score ─────────────────────────────
create or replace function public.rr_score_is_legal(p_score_a int, p_score_b int)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (p_score_a = 4 and p_score_b between 0 and 3)
 or (p_score_b = 4 and p_score_a between 0 and 3)
 or (p_score_a = 6 and p_score_b between 0 and 5)
 or (p_score_b = 6 and p_score_a between 0 and 5),
    false);
$$;

grant execute on function public.rr_score_is_legal(int, int) to authenticated;

-- ── 2. Match points ────────────────────────────────────────────────
-- A win is 4. A loss is round(3 * won / (target - 1)), halves up, where the
-- target is the winner's score (p_games_lost here), floored at 2 so the
-- function is defined for every pair of numbers; legal scores only ever
-- have a target of 4 or 6. (6*won + t-1) / (2*(t-1)) is that rounding in
-- whole-number arithmetic.
create or replace function public.rr_match_points(p_games_won int, p_games_lost int)
returns int
language sql
immutable
as $$
  select case when p_games_won > p_games_lost then 4
              else least(3, greatest(0,
                     (6 * p_games_won + greatest(p_games_lost, 2) - 1)
                     / (2 * (greatest(p_games_lost, 2) - 1)))) end;
$$;

grant execute on function public.rr_match_points(int, int) to authenticated;

-- ── 3. One target no longer exists ─────────────────────────────────
-- (This comes after 1 and 2 are redefined, and report_tournament_match below
-- no longer calls it.)
drop function if exists public.rr_games_to_win();

-- ═══ 4. report_tournament_match (v0.0.6.8 body, message describes both formats) ═══
create or replace function public.report_tournament_match(
  p_match_id uuid,
  p_score_a  int,
  p_score_b  int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match        tournament_matches%rowtype;
  v_league_id    uuid;
  v_winner_side  text; -- 'a' or 'b'
  v_bonus_points constant int := 2;
  v_rr_k         constant numeric := 32;
  v_rating_a     numeric;
  v_rating_b     numeric;
  v_exp_a        numeric;
  v_score_a_elo  numeric;
  v_delta_a      numeric;
  v_now          timestamptz;
begin
  select * into v_match from tournament_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'Match not found';
  end if;
  if v_match.status = 'completed' then
    raise exception 'This match has already been reported';
  end if;
  -- v0.0.6.3: score-format check (replaces the old tie / negative checks,
  -- which this covers). v0.0.7.2: first to 4, or a full set to 6.
  if not public.rr_score_is_legal(p_score_a, p_score_b) then
    raise exception 'Not a legal score: a match is first to 4 games, or a full set to 6. The winner must have exactly 4 and the loser 0 to 3, or the winner exactly 6 and the loser 0 to 5.';
  end if;

  select league_id into v_league_id from tournaments where id = v_match.tournament_id;

  if auth.uid() is null
     or (auth.uid() <> v_match.player_a_id
         and auth.uid() <> v_match.player_b_id
         and auth.uid() <> v_match.player_a2_id
         and auth.uid() <> v_match.player_b2_id
         and not public.is_league_admin(v_league_id)) then
    raise exception 'Not authorized to report this match';
  end if;

  v_winner_side := case when p_score_a > p_score_b then 'a' else 'b' end;

  update tournament_matches
  set score_a      = p_score_a,
      score_b      = p_score_b,
      winner_id    = case when v_winner_side = 'a' then v_match.player_a_id else v_match.player_b_id end,
      status       = 'completed',
      reported_by  = auth.uid(),
      completed_at = now()
  where id = p_match_id
  returning completed_at into v_now;

  if v_match.phase = 'challenge' then
    -- Challenges are always singles — apply exactly as before.
    update tournament_participants
    set bonus_points = bonus_points + v_bonus_points
    where tournament_id = v_match.tournament_id
      and profile_id = (case when v_winner_side = 'a' then v_match.player_a_id else v_match.player_b_id end);
    return;
  end if;

  -- Round robin (singles or doubles): wins/losses/points apply to every
  -- player on a side identically — the result is shared.
  update tournament_participants
  set wins           = wins + (case when (profile_id = v_match.player_a_id or profile_id = v_match.player_a2_id) and v_winner_side = 'a' then 1
                                     when (profile_id = v_match.player_b_id or profile_id = v_match.player_b2_id) and v_winner_side = 'b' then 1
                                     else 0 end),
      losses         = losses + (case when (profile_id = v_match.player_a_id or profile_id = v_match.player_a2_id) and v_winner_side = 'b' then 1
                                       when (profile_id = v_match.player_b_id or profile_id = v_match.player_b2_id) and v_winner_side = 'a' then 1
                                       else 0 end),
      points_for     = points_for + (case when profile_id = v_match.player_a_id or profile_id = v_match.player_a2_id then p_score_a
                                           when profile_id = v_match.player_b_id or profile_id = v_match.player_b2_id then p_score_b
                                           else 0 end),
      points_against = points_against + (case when profile_id = v_match.player_a_id or profile_id = v_match.player_a2_id then p_score_b
                                               when profile_id = v_match.player_b_id or profile_id = v_match.player_b2_id then p_score_a
                                               else 0 end),
      -- v0.0.6.2: match points (4 for a win; a loss earns 0 to 3 by how close it
      -- was, see rr_match_points). Both partners in doubles get their side's.
      rr_points      = rr_points + (case when profile_id = v_match.player_a_id or profile_id = v_match.player_a2_id then public.rr_match_points(p_score_a, p_score_b)
                                         when profile_id = v_match.player_b_id or profile_id = v_match.player_b2_id then public.rr_match_points(p_score_b, p_score_a)
                                         else 0 end)
  where tournament_id = v_match.tournament_id
    and profile_id in (v_match.player_a_id, v_match.player_b_id, v_match.player_a2_id, v_match.player_b2_id);

  -- rr_rating: team-average Elo. Singles is just the doubles case where a
  -- side's "team" is one player, so this covers both without branching.
  select avg(rr_rating) into v_rating_a from tournament_participants
    where tournament_id = v_match.tournament_id
      and profile_id in (v_match.player_a_id, v_match.player_a2_id);
  select avg(rr_rating) into v_rating_b from tournament_participants
    where tournament_id = v_match.tournament_id
      and profile_id in (v_match.player_b_id, v_match.player_b2_id);

  v_exp_a       := 1.0 / (1.0 + power(10.0, (v_rating_b - v_rating_a) / 400.0));
  v_score_a_elo := case when v_winner_side = 'a' then 1.0 else 0.0 end;
  v_delta_a     := v_rr_k * (v_score_a_elo - v_exp_a);

  update tournament_participants
  set rr_rating = rr_rating + v_delta_a
  where tournament_id = v_match.tournament_id
    and profile_id in (v_match.player_a_id, v_match.player_a2_id);

  update tournament_participants
  set rr_rating = rr_rating - v_delta_a
  where tournament_id = v_match.tournament_id
    and profile_id in (v_match.player_b_id, v_match.player_b2_id);

  -- v0.0.5.3: one history row per player per match (the rating AFTER the
  -- match plus the change), read by the Profile page's round robin graph.
  insert into rr_rating_history (tournament_id, profile_id, match_id, rating, delta, recorded_at)
  select v_match.tournament_id, tp.profile_id, v_match.id, tp.rr_rating,
         case when tp.profile_id in (v_match.player_a_id, v_match.player_a2_id) then v_delta_a else -v_delta_a end,
         v_now
    from tournament_participants tp
   where tp.tournament_id = v_match.tournament_id
     and tp.profile_id in (v_match.player_a_id, v_match.player_b_id, v_match.player_a2_id, v_match.player_b2_id);
end;
$$;

grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;

-- ── 5. Re-score rr_points under the new loss scale ─────────────────
do $$
declare v_changed int; v_rescored int;
begin
  -- Matches whose points differ from the old cap-at-3 scale: played to 6,
  -- and the loser took 2, 3 or 4 games.
  select count(*) into v_rescored
    from public.tournament_matches m
   where m.status = 'completed' and m.phase <> 'challenge'
     and m.score_a is not null and m.score_b is not null
     and greatest(m.score_a, m.score_b) = 6
     and least(m.score_a, m.score_b) in (2, 3, 4);

  with calc as (
    select tp.tournament_id, tp.profile_id,
           coalesce((
             select sum(case when tp.profile_id in (m.player_a_id, m.player_a2_id)
                             then public.rr_match_points(m.score_a, m.score_b)
                             else public.rr_match_points(m.score_b, m.score_a) end)
             from public.tournament_matches m
             where m.tournament_id = tp.tournament_id
               and m.status = 'completed' and m.phase <> 'challenge'
               and m.score_a is not null and m.score_b is not null
               and tp.profile_id in (m.player_a_id, m.player_a2_id, m.player_b_id, m.player_b2_id)
           ), 0) as pts
    from public.tournament_participants tp
  )
  update public.tournament_participants tp
     set rr_points = c.pts
    from calc c
   where c.tournament_id = tp.tournament_id and c.profile_id = tp.profile_id
     and tp.rr_points <> c.pts;
  get diagnostics v_changed = row_count;

  raise notice 'Re-scored: % completed match(es) were played to 6 and a loss in them (2-6, 3-6 or 4-6) now earns different points. First-to-4 results are unchanged.', v_rescored;
  raise notice 'rr_points changed for % participant row(s)', v_changed;
end $$;

-- ── 6. Audit: completed matches that are not a legal score ─────────
do $$
declare
  r   record;
  n   int := 0;
begin
  for r in
    select m.id, t.name as season, m.phase, m.score_a, m.score_b, m.completed_at
      from public.tournament_matches m
      join public.tournaments t on t.id = m.tournament_id
     where m.status = 'completed'
       and m.score_a is not null and m.score_b is not null
       and not public.rr_score_is_legal(m.score_a, m.score_b)
     order by m.completed_at
  loop
    n := n + 1;
    if n <= 25 then
      raise notice 'Not a first-to-4 or full-set-to-6 score on completed match %: % (%) % - %', r.id, r.season, r.phase, r.score_a, r.score_b;
    end if;
  end loop;
  if n = 0 then
    raise notice 'Score audit: every completed match is a legal first-to-4 or full-set-to-6 score.';
  else
    raise notice 'Score audit: % completed match(es) are not first-to-4 or full-set-to-6 scores (first 25 listed above). They still count exactly as before; to re-enter one, Remove it and add it again.', n;
  end if;
end $$;

-- ── Self-check ─────────────────────────────────────────────────────
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.tournament_participants tp
  where tp.rr_points <> coalesce((
    select sum(case when tp.profile_id in (m.player_a_id, m.player_a2_id)
                    then public.rr_match_points(m.score_a, m.score_b)
                    else public.rr_match_points(m.score_b, m.score_a) end)
    from public.tournament_matches m
    where m.tournament_id = tp.tournament_id
      and m.status = 'completed' and m.phase <> 'challenge'
      and m.score_a is not null and m.score_b is not null
      and tp.profile_id in (m.player_a_id, m.player_a2_id, m.player_b_id, m.player_b2_id)
  ), 0);
  if v_bad > 0 then
    raise exception 'rr_points self-check failed for % participant(s)', v_bad;
  end if;
  raise notice 'v0.0.7.2 OK: rr_points consistent for % participant row(s)',
    (select count(*) from public.tournament_participants);
end $$;
