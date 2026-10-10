-- supabase-migration-v0.0.3.10.sql
-- Run in Supabase → SQL Editor, after v0.0.3.9.
--
-- start_tournament_week() now clears the board before generating the new
-- week's pairings: any match still 'pending' or 'in_progress' from an
-- earlier week gets deleted the moment a new week starts. Replaces the
-- manual cancel-one-at-a-time workflow from v0.0.3.9 as the default —
-- cancel_tournament_match() is still there for trimming mid-week if
-- needed, this just means you don't have to remember to use it every
-- week. Same safety property as before: a pending/in_progress match has
-- never been counted in anyone's wins/losses/points/rr_rating, so
-- deleting it loses nothing but the fixture itself.
--
-- Only start_tournament_week() changes — same pairing algorithm as
-- v0.0.3.7, one delete statement added right after the week is created.

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

  -- Clear anything left over from a previous week that never got played —
  -- it's not happening now, the group's moved on. Only 'pending'/
  -- 'in_progress' are touched; 'completed' matches are real results and
  -- this never runs against them.
  delete from tournament_matches
  where tournament_id = p_tournament_id
    and status in ('pending', 'in_progress');

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
