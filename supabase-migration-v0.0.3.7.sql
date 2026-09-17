-- supabase-migration-v0.0.3.7.sql
-- Run in Supabase → SQL Editor, after v0.0.3.4 (v0.0.3.5/3.6 added no SQL).
--
-- Replaces the weekly pairing algorithm. start_tournament_week() used to
-- generate a full round robin among attendees (every unique pair, once
-- each) — for an 8-person week that's 28 matches, way more than a 2-hour
-- session can play. This version instead targets a fixed number of
-- matches per attendee (admin sets it each week, ~4-6 fits a 2-hour
-- session) and pairs people by closeness in a blended ranking of:
--   - season points (points_for - points_against, same stat the
--     standings table already sorts by)
--   - a new round-robin-only Elo (rr_rating) — deliberately separate from
--     the main ladder's players.rating, since round robin should reflect
--     round robin form specifically, not the regular ladder
-- Rematches within the same season are avoided by default. The one
-- exception: once a player has already played (completed matches
-- against) every other attendee present that week, they're allowed to
-- repeat — otherwise they'd just sit out once they run out of new
-- opponents.
--
-- Self-contained: safe to run as long as v0.0.3.2/3.3/3.4 are already
-- applied. No changes to challenges or the court queue (both still exist
-- in the schema, just unused by the UI since v0.0.3.6).

alter table public.tournament_participants
  add column if not exists rr_rating numeric not null default 1000;


-- ═══════════════════════════════════════════════════════════════════
-- report_tournament_match(): unchanged behavior for wins/losses/points
-- and challenge bonus_points. Adds a standard Elo update to rr_rating
-- for round-robin matches only (K=32, seeded at 1000 to match the main
-- ladder's BASE_RATING scale, but otherwise fully independent — this
-- never touches players.rating).
-- ═══════════════════════════════════════════════════════════════════

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
  v_winner       uuid;
  v_loser        uuid;
  v_bonus_points constant int := 2;     -- points awarded to the winner of a challenge
  v_rr_k         constant numeric := 32; -- Elo K-factor for rr_rating
  v_rating_a     numeric;
  v_rating_b     numeric;
  v_exp_a        numeric;
  v_score_a_elo  numeric;
begin
  select * into v_match from tournament_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'Match not found';
  end if;
  if v_match.status = 'completed' then
    raise exception 'This match has already been reported';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Scores cannot tie';
  end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then
    raise exception 'Invalid score';
  end if;

  select league_id into v_league_id from tournaments where id = v_match.tournament_id;

  if auth.uid() is null
     or (auth.uid() <> v_match.player_a_id
         and auth.uid() <> v_match.player_b_id
         and not public.is_league_admin(v_league_id)) then
    raise exception 'Not authorized to report this match';
  end if;

  v_winner := case when p_score_a > p_score_b then v_match.player_a_id else v_match.player_b_id end;
  v_loser  := case when p_score_a > p_score_b then v_match.player_b_id else v_match.player_a_id end;

  update tournament_matches
  set score_a      = p_score_a,
      score_b      = p_score_b,
      winner_id    = v_winner,
      status       = 'completed',
      reported_by  = auth.uid(),
      completed_at = now()
  where id = p_match_id;

  if v_match.phase = 'challenge' then
    update tournament_participants
    set bonus_points = bonus_points + v_bonus_points
    where tournament_id = v_match.tournament_id
      and profile_id = v_winner;
  else
    update tournament_participants
    set wins           = wins + (case when profile_id = v_winner then 1 else 0 end),
        losses         = losses + (case when profile_id = v_loser then 1 else 0 end),
        points_for     = points_for + (case when profile_id = v_match.player_a_id then p_score_a else p_score_b end),
        points_against = points_against + (case when profile_id = v_match.player_a_id then p_score_b else p_score_a end)
    where tournament_id = v_match.tournament_id
      and profile_id in (v_match.player_a_id, v_match.player_b_id);

    select rr_rating into v_rating_a from tournament_participants
      where tournament_id = v_match.tournament_id and profile_id = v_match.player_a_id;
    select rr_rating into v_rating_b from tournament_participants
      where tournament_id = v_match.tournament_id and profile_id = v_match.player_b_id;

    v_exp_a       := 1.0 / (1.0 + power(10.0, (v_rating_b - v_rating_a) / 400.0));
    v_score_a_elo := case when v_winner = v_match.player_a_id then 1.0 else 0.0 end;

    update tournament_participants
    set rr_rating = rr_rating + v_rr_k * (v_score_a_elo - v_exp_a)
    where tournament_id = v_match.tournament_id and profile_id = v_match.player_a_id;

    update tournament_participants
    set rr_rating = rr_rating + v_rr_k * ((1 - v_score_a_elo) - (1 - v_exp_a))
    where tournament_id = v_match.tournament_id and profile_id = v_match.player_b_id;
  end if;
end;
$$;

grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- start_tournament_week(): now takes a target match count per attendee
-- instead of generating a full round robin. Pairs attendees round by
-- round, closest-blended-rank first, skipping repeat pairings within the
-- season unless one side has already played every other attendee present
-- this week. Some players may end up with fewer than the target if the
-- group is small or the math doesn't divide evenly — that's expected,
-- not a bug.
-- ═══════════════════════════════════════════════════════════════════

drop function if exists public.start_tournament_week(uuid, uuid[]);

create or replace function public.start_tournament_week(
  p_tournament_id  uuid,
  p_attendee_ids   uuid[],
  p_target_matches int default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id   uuid;
  v_week_id     uuid;
  v_week_number int;
  v_n           int;
  v_ids         uuid[];
  v_exhausted   boolean[];
  v_assigned    int[];
  v_used        boolean[];
  v_pairs_keys  text[] := array[]::text[];
  v_round       int;
  i             int;
  v_p_idx       int;
  v_best_idx    int;
  v_key         text;
  v_played_before boolean;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can start a round robin week';
  end if;

  v_n := coalesce(array_length(p_attendee_ids, 1), 0);
  if v_n < 2 then
    raise exception 'Need at least 2 attendees to start a week';
  end if;

  if p_target_matches is null or p_target_matches < 1 or p_target_matches > 15 then
    raise exception 'Target matches per player must be between 1 and 15';
  end if;

  select coalesce(max(week_number), 0) + 1 into v_week_number
  from tournament_weeks where tournament_id = p_tournament_id;

  insert into tournament_weeks (tournament_id, week_number, created_by)
  values (p_tournament_id, v_week_number, auth.uid())
  returning id into v_week_id;

  -- Auto-enroll any attendee who isn't already a season participant.
  insert into tournament_participants (tournament_id, profile_id)
  select p_tournament_id, pid
  from unnest(p_attendee_ids) as pid
  on conflict (tournament_id, profile_id) do nothing;

  -- Blended rank (1 = strongest): average of rank-by-season-points and
  -- rank-by-rr_rating. "Exhausted" = already played every other attendee
  -- present this week (completed round-robin matches only).
  with ranked as (
    select
      tp.profile_id,
      (row_number() over (order by (tp.points_for - tp.points_against) desc, tp.wins desc, tp.profile_id)
       + row_number() over (order by tp.rr_rating desc, tp.profile_id)) / 2.0 as blended_rank,
      (
        select count(distinct case when m.player_a_id = tp.profile_id then m.player_b_id else m.player_a_id end)
        from tournament_matches m
        where m.tournament_id = p_tournament_id
          and m.phase = 'round_robin'
          and m.status = 'completed'
          and (m.player_a_id = tp.profile_id or m.player_b_id = tp.profile_id)
          and (case when m.player_a_id = tp.profile_id then m.player_b_id else m.player_a_id end) = any(p_attendee_ids)
      ) >= (v_n - 1) as exhausted
    from tournament_participants tp
    where tp.tournament_id = p_tournament_id
      and tp.profile_id = any(p_attendee_ids)
  )
  select array_agg(profile_id order by blended_rank asc, profile_id),
         array_agg(exhausted  order by blended_rank asc, profile_id)
  into v_ids, v_exhausted
  from ranked;

  v_assigned := array_fill(0, array[v_n]);

  for v_round in 1 .. p_target_matches loop
    v_used := array_fill(false, array[v_n]);

    loop
      -- Pick the next player still short of their target this round,
      -- preferring whoever has the fewest matches assigned so far.
      v_p_idx := null;
      for i in 1 .. v_n loop
        if not v_used[i] and v_assigned[i] < p_target_matches then
          if v_p_idx is null or v_assigned[i] < v_assigned[v_p_idx] then
            v_p_idx := i;
          end if;
        end if;
      end loop;

      exit when v_p_idx is null;
      v_used[v_p_idx] := true;

      -- Find the closest-ranked valid partner: not already paired this
      -- week, and not a season rematch unless one side is exhausted.
      v_best_idx := null;
      for i in 1 .. v_n loop
        if i = v_p_idx or v_used[i] or v_assigned[i] >= p_target_matches then
          continue;
        end if;

        v_key := least(v_ids[v_p_idx], v_ids[i])::text || '_' || greatest(v_ids[v_p_idx], v_ids[i])::text;
        if v_key = any(v_pairs_keys) then
          continue;
        end if;

        v_played_before := exists (
          select 1 from tournament_matches m
          where m.tournament_id = p_tournament_id
            and m.phase = 'round_robin'
            and m.status = 'completed'
            and ((m.player_a_id = v_ids[v_p_idx] and m.player_b_id = v_ids[i])
              or (m.player_a_id = v_ids[i] and m.player_b_id = v_ids[v_p_idx]))
        );

        if v_played_before and not v_exhausted[v_p_idx] and not v_exhausted[i] then
          continue;
        end if;

        if v_best_idx is null
           or v_assigned[i] < v_assigned[v_best_idx]
           or (v_assigned[i] = v_assigned[v_best_idx] and abs(i - v_p_idx) < abs(v_best_idx - v_p_idx)) then
          v_best_idx := i;
        end if;
      end loop;

      if v_best_idx is not null then
        v_used[v_best_idx] := true;
        v_assigned[v_p_idx]    := v_assigned[v_p_idx] + 1;
        v_assigned[v_best_idx] := v_assigned[v_best_idx] + 1;
        v_pairs_keys := array_append(
          v_pairs_keys,
          least(v_ids[v_p_idx], v_ids[v_best_idx])::text || '_' || greatest(v_ids[v_p_idx], v_ids[v_best_idx])::text
        );

        insert into tournament_matches (tournament_id, phase, week_id, player_a_id, player_b_id, status)
        values (p_tournament_id, 'round_robin', v_week_id, v_ids[v_p_idx], v_ids[v_best_idx], 'pending');
      end if;
      -- else: v_p_idx gets a bye this round (no valid partner left) —
      -- already marked used, so the loop moves on without them.
    end loop;
  end loop;

  return v_week_id;
end;
$$;

grant execute on function public.start_tournament_week(uuid, uuid[], int) to authenticated;
