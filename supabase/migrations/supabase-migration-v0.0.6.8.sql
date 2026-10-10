-- ═══════════════════════════════════════════════════════════════════
-- v0.0.6.8 — Round robin matches are first to 6 games
--
-- WHY
--   Scores could only go up to 4 (4-0 to 4-3). Matches are now first to 6:
--   a finished match is 6-0, 6-1, 6-2, 6-3, 6-4 or 6-5 either way round.
--
-- WHAT THIS CHANGES
--   1. New rr_games_to_win() — the one place the target lives (6). Change
--      the number there and rr_score_is_legal() and the error message follow.
--   2. rr_score_is_legal(): one side exactly rr_games_to_win(), the other
--      0 to one less.
--   3. report_tournament_match(): same body as v0.0.6.3, but the "not a legal
--      score" message states the current target instead of a fixed 4.
--   4. An audit lists completed matches whose score is not legal under the
--      new rule (for example 4-2 results reported while the format was
--      first to 4). It changes nothing: those matches still count exactly as
--      before.
--
-- WHAT THIS DOES NOT CHANGE
--   Match points and battle pass XP are untouched: a win is 4 points, a loss
--   is the games you won up to 3, XP is 4 per point. With first to 6 that
--   means a 3-6, 4-6 and 5-6 loss all earn 3 points; say if you want the
--   loss scale stretched to use the new range.
--
-- Requires v0.0.6.3. Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.rr_score_is_legal(integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.3.sql first (it creates rr_score_is_legal).';
  end if;
  if to_regprocedure('public.report_tournament_match(uuid,integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.3.sql first (it creates report_tournament_match).';
  end if;
end $$;

-- ── 1. The target ──────────────────────────────────────────────────
create or replace function public.rr_games_to_win()
returns int
language sql
immutable
as $$ select 6; $$;

grant execute on function public.rr_games_to_win() to authenticated;

-- ── 2. What counts as a finished score ─────────────────────────────
create or replace function public.rr_score_is_legal(p_score_a int, p_score_b int)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (p_score_a = public.rr_games_to_win() and p_score_b between 0 and public.rr_games_to_win() - 1)
 or (p_score_b = public.rr_games_to_win() and p_score_a between 0 and public.rr_games_to_win() - 1),
    false);
$$;

grant execute on function public.rr_score_is_legal(int, int) to authenticated;

-- ═══ 3. report_tournament_match (v0.0.6.3 body, message uses the target) ═══
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
  -- which this covers). v0.0.6.8: the target comes from rr_games_to_win().
  if not public.rr_score_is_legal(p_score_a, p_score_b) then
    raise exception 'Not a legal score: a match is first to % games, so the winner must have exactly % and the loser 0 to %.',
      public.rr_games_to_win(), public.rr_games_to_win(), public.rr_games_to_win() - 1;
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
      -- v0.0.6.2: match points (4 for a win; since v0.0.6.4 a loss earns its
      -- games won, 0 to 3). Both partners in doubles get their side's.
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

-- ── 4. Audit: completed matches that are not a legal score under the new rule ──
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
      raise notice 'Not a first-to-% score on completed match %: % (%) % - %', public.rr_games_to_win(), r.id, r.season, r.phase, r.score_a, r.score_b;
    end if;
  end loop;
  if n = 0 then
    raise notice 'Score audit: every completed match is a legal first-to-% score.', public.rr_games_to_win();
  else
    raise notice 'Score audit: % completed match(es) are not first-to-% scores (first 25 listed above). They still count exactly as before; to re-enter one, Remove it and add it again.', n, public.rr_games_to_win();
  end if;
end $$;
