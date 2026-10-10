-- supabase-migration-v0.0.6.3.sql
-- Run in Supabase → SQL Editor, after supabase-migration-v0.0.6.2.sql
-- (this refuses to run without it).
--
-- SCORE-FORMAT VALIDATION. The format is first to 4 games, no-ad, so a
-- finished match is always 4-0, 4-1, 4-2 or 4-3 either way round. Until now
-- the database only checked "not a tie, not negative", so a typo like 7-2 or
-- 4-4 was accepted, and since v0.0.6.2 a loss earns points from the games
-- won, so a bad score also bends the standings.
--
-- What this migration does:
--   1. rr_score_is_legal(a, b): the rule, defined once (winner has exactly 4,
--      loser has 0 to 3).
--   2. Re-declares report_tournament_match() (v0.0.6.2 body, unchanged apart
--      from the check above) so an illegal score is rejected with a message
--      that says what a legal score is. Applies to every reported match.
--   3. Audit only: lists any ALREADY-COMPLETED match whose score is not
--      legal, as NOTICEs. Nothing is changed or blocked: existing results
--      keep counting, and an admin can fix one with Remove (Matches page)
--      then add the match again.
--
-- Not changed: add_tournament_match() takes no score (it only creates the
-- pending match), so there is nothing to validate there. Ladder matches use
-- per-game scores and a different format, and are not touched.

do $$
begin
  if to_regprocedure('public.rr_match_points(integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.2.sql first (it creates rr_match_points).';
  end if;
end $$;

create or replace function public.rr_score_is_legal(p_score_a int, p_score_b int)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (p_score_a = 4 and p_score_b between 0 and 3)
 or (p_score_b = 4 and p_score_a between 0 and 3),
    false);
$$;

grant execute on function public.rr_score_is_legal(int, int) to authenticated;

-- ═══ report_tournament_match (v0.0.6.2 body + score check) ═══
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
  -- which this covers). First to 4 games, no-ad.
  if not public.rr_score_is_legal(p_score_a, p_score_b) then
    raise exception 'Not a legal score: a match is first to 4 games, so the winner must have exactly 4 and the loser 0 to 3.';
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
      -- v0.0.6.2: match points (4 for a win; a loss earns its games won,
      -- minimum 1, maximum 3). Both partners in doubles get their side's.
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

-- ── Audit: completed matches whose score is not a legal first-to-4 result ──
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
      raise notice 'Illegal score on completed match %: % (%) % - %', r.id, r.season, r.phase, r.score_a, r.score_b;
    end if;
  end loop;
  if n = 0 then
    raise notice 'Score audit: every completed match has a legal first-to-4 score.';
  else
    raise notice 'Score audit: % completed match(es) have an illegal score (first 25 listed above). They still count; fix with Remove then re-add.', n;
  end if;
end $$;
