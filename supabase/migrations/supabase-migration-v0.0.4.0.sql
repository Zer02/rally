-- supabase-migration-v0.0.4.0.sql
-- Run in Supabase → SQL Editor, after v0.0.3.11.
--
-- Doubles didn't exist in the schema at all before this — tournament_matches
-- only ever had two player slots. This adds a second slot per side
-- (player_a2_id / player_b2_id) and a `format` column, and updates
-- everything that writes match results to branch on format:
--   - report_tournament_match(): a doubles win/loss/points_for/
--     points_against applies identically to BOTH players on a team — the
--     match result is shared, same as agreed ("rolls into each player's
--     normal record"). rr_rating uses a standard simplified team-Elo:
--     each side's rating is the average of its two players, the Elo
--     delta is computed once from those team averages, and applied
--     identically to both players on that side.
--   - add_tournament_match(): now optionally takes a second player per
--     side. Provide both p_player_a2_id and p_player_b2_id for a doubles
--     match, or leave both null for singles (unchanged behavior).
--   - generate_court_matches(): the new smart generator. Give it the
--     attendees present and the number of courts; it computes the best
--     singles/doubles split to fill those courts, benches the fewest
--     people it can (prioritizing whoever's played the fewest matches
--     this season, then any newly-enrolled attendee), groups the rest by
--     current blended strength (points + rr_rating, same metric the
--     weekly pairing uses), and balances each doubles foursome as
--     strongest+weakest vs. the middle two. Attaches to the current
--     week — same as add_tournament_match(), it does not create a new
--     week itself, so it can be re-run for "next round" as many times as
--     needed in one session; ratings and match counts shift after every
--     completed match, so a re-run naturally produces a different mix
--     without any artificial randomization.
--
-- Deliberately NOT done here: rematch avoidance for the generator (the
-- weekly pairing's "don't repeat until everyone's played everyone"
-- rule). This tool is a quick "best matches right now" snapshot for a
-- live session, not a season-spanning fairness rotation — flagging the
-- omission rather than silently leaving it out.
--
-- Also included: a small consistency fix to start_tournament_week()'s
-- internal pairing-closeness metric, which was still using point
-- differential internally (points_for - points_against) even though
-- v0.0.3.11 retired differential everywhere else. Swapped to points_for,
-- same as the new generator uses. This was never a user-facing tiebreak
-- (it only ever affected who gets paired with whom, not standings), but
-- leaving it inconsistent didn't seem right once noticed.

alter table public.tournament_matches
  add column if not exists format       text not null default 'singles',
  add column if not exists player_a2_id uuid references public.profiles(id),
  add column if not exists player_b2_id uuid references public.profiles(id);

alter table public.tournament_matches drop constraint if exists tournament_matches_format_check;
alter table public.tournament_matches
  add constraint tournament_matches_format_check check (format in ('singles', 'doubles'));


-- ═══════════════════════════════════════════════════════════════════
-- report_tournament_match(): same auth/validation as before, now
-- branches on format for how results get applied.
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
  v_winner_side  text; -- 'a' or 'b'
  v_bonus_points constant int := 2;
  v_rr_k         constant numeric := 32;
  v_rating_a     numeric;
  v_rating_b     numeric;
  v_exp_a        numeric;
  v_score_a_elo  numeric;
  v_delta_a      numeric;
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
  where id = p_match_id;

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
end;
$$;

grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- add_tournament_match(): now optionally takes a partner per side.
-- Both p_player_a2_id and p_player_b2_id → doubles. Neither → singles
-- (unchanged behavior, unchanged call signature still works via defaults).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.add_tournament_match(
  p_tournament_id uuid,
  p_player_a_id   uuid,
  p_player_b_id   uuid,
  p_player_a2_id  uuid default null,
  p_player_b2_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
  v_week_id   uuid;
  v_match_id  uuid;
  v_format    text;
  v_ids       uuid[];
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can add a match';
  end if;

  if (p_player_a2_id is null) <> (p_player_b2_id is null) then
    raise exception 'Provide both partners for doubles, or neither for singles';
  end if;

  v_format := case when p_player_a2_id is not null then 'doubles' else 'singles' end;
  v_ids := array_remove(array[p_player_a_id, p_player_b_id, p_player_a2_id, p_player_b2_id], null);

  if array_length(v_ids, 1) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Each player can only appear once in a match';
  end if;

  select id into v_week_id
  from tournament_weeks
  where tournament_id = p_tournament_id
  order by week_number desc
  limit 1;

  if v_week_id is null then
    raise exception 'Start a week before adding a match';
  end if;

  insert into tournament_participants (tournament_id, profile_id)
  select p_tournament_id, pid from unnest(v_ids) as pid
  on conflict (tournament_id, profile_id) do nothing;

  insert into tournament_matches
    (tournament_id, phase, week_id, format, player_a_id, player_b_id, player_a2_id, player_b2_id, status)
  values
    (p_tournament_id, 'round_robin', v_week_id, v_format, p_player_a_id, p_player_b_id, p_player_a2_id, p_player_b2_id, 'pending')
  returning id into v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.add_tournament_match(uuid, uuid, uuid, uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- generate_court_matches(): the smart generator. See the file header
-- for the full design rationale.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.generate_court_matches(
  p_tournament_id uuid,
  p_attendee_ids  uuid[],
  p_court_count   int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id     uuid;
  v_week_id       uuid;
  v_n             int;
  v_best_d        int := 0;
  v_best_s        int := 0;
  v_best_players  int := -1;
  v_best_courts   int := -1;
  d               int;
  s               int;
  v_players_used  int;
  v_courts_used   int;
  v_remaining     int;
  v_bench_count   int;
  v_pool          uuid[];   -- players_used ids, ordered by blended strength (best first)
  v_bench         uuid[];
  v_pos           int;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_match_ids     uuid[] := array[]::uuid[];
  v_match_id      uuid;
  i               int;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can generate court matches';
  end if;

  v_n := coalesce(array_length(p_attendee_ids, 1), 0);
  if v_n < 2 then
    raise exception 'Need at least 2 attendees';
  end if;

  if p_court_count is null or p_court_count < 1 then
    raise exception 'Need at least 1 court';
  end if;

  select id into v_week_id
  from tournament_weeks
  where tournament_id = p_tournament_id
  order by week_number desc
  limit 1;

  if v_week_id is null then
    raise exception 'Start a week before generating court matches';
  end if;

  insert into tournament_participants (tournament_id, profile_id)
  select p_tournament_id, pid from unnest(p_attendee_ids) as pid
  on conflict (tournament_id, profile_id) do nothing;

  -- Best (doubles courts, singles courts) split: maximize players
  -- playing first, then courts used, preferring more singles on ties
  -- (arbitrary but deterministic — no strong reason either way).
  for d in 0 .. least(p_court_count, v_n / 4) loop
    v_remaining := v_n - 4 * d;
    s := least(v_remaining / 2, p_court_count - d);
    v_players_used := 4 * d + 2 * s;
    v_courts_used  := d + s;

    if v_players_used > v_best_players
       or (v_players_used = v_best_players and v_courts_used > v_best_courts)
       or (v_players_used = v_best_players and v_courts_used = v_best_courts and d < v_best_d) then
      v_best_players := v_players_used;
      v_best_courts  := v_courts_used;
      v_best_d       := d;
      v_best_s       := s;
    end if;
  end loop;

  v_bench_count := v_n - v_best_players;

  -- Who plays: prioritize whoever has played the fewest matches this
  -- season (newly-enrolled attendees are 0-0, so they play first).
  -- Whoever's played the most already makes up the bench, if anyone has to.
  with prioritized as (
    select tp.profile_id,
           (tp.wins + tp.losses) as matches_played,
           row_number() over (order by (tp.wins + tp.losses) asc, tp.profile_id) as priority
    from tournament_participants tp
    where tp.tournament_id = p_tournament_id
      and tp.profile_id = any(p_attendee_ids)
  )
  select
    array_agg(profile_id) filter (where priority <= v_best_players),
    array_agg(profile_id) filter (where priority > v_best_players)
  into v_pool, v_bench
  from prioritized;

  -- Order the playing pool by current blended strength (points_for, then
  -- rr_rating — same metric the weekly pairing uses), strongest first.
  with ranked as (
    select tp.profile_id,
           (row_number() over (order by tp.points_for desc, tp.wins desc, tp.profile_id)
            + row_number() over (order by tp.rr_rating desc, tp.profile_id)) / 2.0 as blended_rank
    from tournament_participants tp
    where tp.tournament_id = p_tournament_id
      and tp.profile_id = any(v_pool)
  )
  select array_agg(profile_id order by blended_rank asc, profile_id)
  into v_pool
  from ranked;

  v_pos := 1;

  -- Doubles pods: 4 consecutive players from the top of the pool,
  -- balanced strongest+weakest vs. the middle two.
  for i in 1 .. v_best_d loop
    v_p1 := v_pool[v_pos];     -- strongest in this pod
    v_p2 := v_pool[v_pos + 1];
    v_p3 := v_pool[v_pos + 2];
    v_p4 := v_pool[v_pos + 3]; -- weakest in this pod

    insert into tournament_matches
      (tournament_id, phase, week_id, format, player_a_id, player_a2_id, player_b_id, player_b2_id, status)
    values
      (p_tournament_id, 'round_robin', v_week_id, 'doubles', v_p1, v_p4, v_p2, v_p3, 'pending')
    returning id into v_match_id;

    v_match_ids := array_append(v_match_ids, v_match_id);
    v_pos := v_pos + 4;
  end loop;

  -- Singles pairs: 2 consecutive players each from what's left.
  for i in 1 .. v_best_s loop
    insert into tournament_matches
      (tournament_id, phase, week_id, format, player_a_id, player_b_id, status)
    values
      (p_tournament_id, 'round_robin', v_week_id, 'singles', v_pool[v_pos], v_pool[v_pos + 1], 'pending')
    returning id into v_match_id;

    v_match_ids := array_append(v_match_ids, v_match_id);
    v_pos := v_pos + 2;
  end loop;

  return jsonb_build_object(
    'week_id', v_week_id,
    'doubles_count', v_best_d,
    'singles_count', v_best_s,
    'match_ids', to_jsonb(v_match_ids),
    'benched_profile_ids', to_jsonb(coalesce(v_bench, array[]::uuid[]))
  );
end;
$$;

grant execute on function public.generate_court_matches(uuid, uuid[], int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- start_tournament_week(): unchanged pairing algorithm, one-line
-- consistency fix — the internal closeness metric now uses points_for
-- instead of point differential, matching v0.0.3.11 and the new
-- generator above. Never a user-facing tiebreak, just who gets paired
-- with whom.
-- ═══════════════════════════════════════════════════════════════════

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

  delete from tournament_matches
  where tournament_id = p_tournament_id
    and status in ('pending', 'in_progress');

  insert into tournament_participants (tournament_id, profile_id)
  select p_tournament_id, pid
  from unnest(p_attendee_ids) as pid
  on conflict (tournament_id, profile_id) do nothing;

  with ranked as (
    select
      tp.profile_id,
      (row_number() over (order by tp.points_for desc, tp.wins desc, tp.profile_id)
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
    end loop;
  end loop;

  return v_week_id;
end;
$$;

grant execute on function public.start_tournament_week(uuid, uuid[], int) to authenticated;
