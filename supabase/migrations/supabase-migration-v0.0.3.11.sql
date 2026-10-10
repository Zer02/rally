-- supabase-migration-v0.0.3.11.sql
-- Run in Supabase → SQL Editor, after v0.0.3.10.
--
-- Differential is out of every tiebreak. Wins stays the primary ranking
-- everywhere; the tiebreak (and challenge's "ranked above you" check) is
-- now total games won (points_for) instead of points_for - points_against.
--
-- finalize_tournament() gets simplified along with it: the old
-- strength-of-schedule-weighted-differential formula is gone. Final seed
-- is now just (wins desc, points_for + bonus_points desc) — same
-- ordering as the live standings, plus challenge bonus points as a flat
-- top-up like before. adjusted_score keeps its name and its job (it's
-- still "the number used to seed"), it's just computed more simply now.
--
-- create_challenge()'s "only challenge someone ranked above you" check
-- uses the same new ordering, for consistency (challenges are unused in
-- the UI as of v0.0.3.6, but the RPC stays correct in case that changes).

create or replace function public.finalize_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can finalize the season';
  end if;

  with final as (
    select profile_id, wins, points_for + bonus_points as adjusted_score
    from tournament_participants
    where tournament_id = p_tournament_id
  ),
  seeded as (
    select profile_id, adjusted_score,
           row_number() over (order by wins desc, adjusted_score desc, profile_id) as seed
    from final
  )
  update tournament_participants tp
  set adjusted_score = s.adjusted_score,
      seed           = s.seed
  from seeded s
  where tp.tournament_id = p_tournament_id
    and tp.profile_id = s.profile_id;

  -- Career round-robin record, read from the seed just written above.
  update players pl
  set rr_seasons_played = pl.rr_seasons_played + 1,
      rr_titles         = pl.rr_titles + (case when tp.seed = 1 then 1 else 0 end),
      rr_best_finish     = least(coalesce(pl.rr_best_finish, tp.seed), tp.seed)
  from tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and pl.profile_id = tp.profile_id
    and pl.league_id  = v_league_id;

  update tournaments
  set status = 'completed',
      completed_at = now()
  where id = p_tournament_id;
end;
$$;

grant execute on function public.finalize_tournament(uuid) to authenticated;


create or replace function public.create_challenge(
  p_tournament_id uuid,
  p_challenged_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger      uuid := auth.uid();
  v_week_id         uuid;
  v_challenger_rank int;
  v_challenged_rank int;
  v_existing        int;
  v_match_id        uuid;
begin
  if v_challenger is null then
    raise exception 'Must be signed in to issue a challenge';
  end if;
  if v_challenger = p_challenged_id then
    raise exception 'Cannot challenge yourself';
  end if;

  if not exists (
    select 1 from tournament_participants
    where tournament_id = p_tournament_id and profile_id = v_challenger
  ) then
    raise exception 'You are not a participant in this season';
  end if;

  if not exists (
    select 1 from tournament_participants
    where tournament_id = p_tournament_id and profile_id = p_challenged_id
  ) then
    raise exception 'That player is not a participant in this season';
  end if;

  select id into v_week_id from tournament_weeks
  where tournament_id = p_tournament_id
  order by week_number desc
  limit 1;

  if v_week_id is null then
    raise exception 'No week has been started yet for this season';
  end if;

  select count(*) into v_existing
  from tournament_matches
  where tournament_id = p_tournament_id
    and phase = 'challenge'
    and week_id = v_week_id
    and challenger_id = v_challenger;

  if v_existing > 0 then
    raise exception 'You have already used your challenge for this week';
  end if;

  with ranked as (
    select profile_id,
           row_number() over (order by wins desc, points_for desc) as rnk
    from tournament_participants
    where tournament_id = p_tournament_id
  )
  select
    (select rnk from ranked where profile_id = v_challenger),
    (select rnk from ranked where profile_id = p_challenged_id)
  into v_challenger_rank, v_challenged_rank;

  if v_challenger_rank is null or v_challenged_rank is null or v_challenged_rank >= v_challenger_rank then
    raise exception 'You can only challenge a player currently ranked above you';
  end if;

  insert into tournament_matches
    (tournament_id, phase, week_id, challenger_id, player_a_id, player_b_id, status)
  values
    (p_tournament_id, 'challenge', v_week_id, v_challenger, v_challenger, p_challenged_id, 'pending')
  returning id into v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.create_challenge(uuid, uuid) to authenticated;
