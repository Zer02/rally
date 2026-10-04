-- supabase-migration-v0.0.6.2.sql
-- Run in Supabase → SQL Editor, after supabase-migration-v0.0.5.3.sql and
-- supabase-migration-v0.0.6.1.sql (this refuses to run without them).
--
-- Round robin POINTS. The leaderboard's bare number was a win count with
-- no label; this gives the round robin a real points system.
--
--   Win                    4 points
--   Loss                   the games you won, at least 1, at most 3
--                          (0-4 and 1-4 -> 1, 2-4 -> 2, 3-4 -> 3)
--   Doubles                both partners earn their side's points
--   Challenge matches      earn no match points (the +2 challenge bonus
--                          stays a last tiebreak only, as before)
--
--   Ranking: total points, then wins, then games won.
--
-- What this migration does:
--   1. tournament_participants.rr_points (stored, kept current by the
--      functions below).
--   2. rr_match_points(games_won, games_lost): the rule, defined once.
--   3. Backfill rr_points from every completed non-challenge match, in
--      every season (finished seasons keep their official placings; they
--      just gain a points figure).
--   4. Re-declares four functions, each otherwise identical to its latest
--      version:
--        report_tournament_match()  (v0.0.5.3) adds the match's points
--        remove_tournament_match()  (v0.0.6.1) takes them back
--        finalize_tournament()      (v0.0.3.11) seeds by points, wins, games
--        create_challenge()         (v0.0.3.11) "ranked above you" uses
--                                   the same order (feature is dormant)
--      start_tournament_week() / generate_court_matches() are untouched:
--      court pairing still blends season standing with rr_rating.
--   5. A self-check: every participant's stored rr_points is compared with
--      a fresh recount from the matches, and the migration stops with an
--      error if any differ (the SQL Editor runs a script as one transaction,
--      so nothing is left half-applied).

do $$
begin
  if to_regclass('public.rr_rating_history') is null then
    raise exception 'Run supabase-migration-v0.0.5.3.sql first (it creates rr_rating_history).';
  end if;
  if to_regprocedure('public.remove_tournament_match(uuid)') is null
     or to_regclass('public.match_removal_log') is null then
    raise exception 'Run supabase-migration-v0.0.6.1.sql first (it creates remove_tournament_match).';
  end if;
end $$;

alter table public.tournament_participants
  add column if not exists rr_points int not null default 0;

create or replace function public.rr_match_points(p_games_won int, p_games_lost int)
returns int
language sql
immutable
as $$
  select case when p_games_won > p_games_lost then 4
              else greatest(1, least(3, p_games_won)) end;
$$;

grant execute on function public.rr_match_points(int, int) to authenticated;

-- ── Backfill ───────────────────────────────────────────────────────
update public.tournament_participants tp
set rr_points = coalesce((
  select sum(case when tp.profile_id in (m.player_a_id, m.player_a2_id)
                  then public.rr_match_points(m.score_a, m.score_b)
                  else public.rr_match_points(m.score_b, m.score_a) end)
  from public.tournament_matches m
  where m.tournament_id = tp.tournament_id
    and m.status = 'completed' and m.phase <> 'challenge'
    and m.score_a is not null and m.score_b is not null
    and tp.profile_id in (m.player_a_id, m.player_a2_id, m.player_b_id, m.player_b2_id)
), 0)
where true;

-- ═══ report_tournament_match (v0.0.5.3 body + match points) ═══
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
grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;

-- ═══ remove_tournament_match (v0.0.6.1 body + match points) ═══
create or replace function public.remove_tournament_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match        tournament_matches%rowtype;
  v_tournament   tournaments%rowtype;
  v_a            uuid[];
  v_b            uuid[];
  v_winner_side  text;
  v_bonus_points constant int := 2;     -- same as report_tournament_match()
  v_rr_k         constant numeric := 32; -- same as report_tournament_match()
  v_ratings      jsonb := '{}'::jsonb;  -- player id -> rating as we replay
  v_affected     uuid[];
  v_pid          uuid;
  v_base         numeric;
  v_later        record;
  v_la           uuid[];
  v_lb           uuid[];
  v_avg_a        numeric;
  v_avg_b        numeric;
  v_exp_a        numeric;
  v_delta_a      numeric;
  v_new          numeric;
  v_replayed     int := 0;
  v_names_a      text;
  v_names_b      text;
  v_summary      text;
  v_actor_name   text;
begin
  select * into v_match from tournament_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  select * into v_tournament from tournaments where id = v_match.tournament_id;

  if auth.uid() is null or not public.is_league_admin(v_tournament.league_id) then
    raise exception 'Only admins of this league can remove a match';
  end if;
  if v_match.status <> 'completed' then
    raise exception 'This match hasn''t been played yet. Remove it from the Round Robin page instead.';
  end if;
  if v_tournament.status <> 'round_robin' then
    raise exception 'This match is from a finished season, which is locked.';
  end if;
  if v_match.phase = 'bracket' then
    raise exception 'Bracket matches can''t be removed here.';
  end if;
  if v_match.score_a is null or v_match.score_b is null then
    raise exception 'This match has no recorded score.';
  end if;

  -- Serialise with anything else writing this season's standings (a score
  -- being reported at the same moment, or a second click on Remove), then
  -- make sure the match is still there.
  perform 1 from tournament_participants
   where tournament_id = v_match.tournament_id
   for update;
  perform 1 from tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found (it may have just been removed)';
  end if;

  v_a := array_remove(array[v_match.player_a_id, v_match.player_a2_id], null);
  v_b := array_remove(array[v_match.player_b_id, v_match.player_b2_id], null);
  v_winner_side := case when v_match.score_a > v_match.score_b then 'a' else 'b' end;

  -- For the log: "Jane 6-4 Tom" (or "Jane & Sam 6-4 Tom & Lee" for doubles).
  select string_agg(coalesce(p.display_name, p.username, '?'), ' & ' order by array_position(v_a, p.id))
    into v_names_a from profiles p where p.id = any(v_a);
  select string_agg(coalesce(p.display_name, p.username, '?'), ' & ' order by array_position(v_b, p.id))
    into v_names_b from profiles p where p.id = any(v_b);
  v_summary := format('%s %s-%s %s', coalesce(v_names_a, '?'), v_match.score_a, v_match.score_b, coalesce(v_names_b, '?'));

  if v_match.phase = 'challenge' then
    -- A challenge only ever gave its winner a bonus point (see
    -- report_tournament_match); it never touched wins or ratings.
    update tournament_participants
    set bonus_points = bonus_points - v_bonus_points
    where tournament_id = v_match.tournament_id
      and profile_id = (case when v_winner_side = 'a' then v_match.player_a_id else v_match.player_b_id end);
  else
    -- 1. Undo the standings. Mirror image of report_tournament_match().
    update tournament_participants
    set wins           = wins - (case when profile_id = any(v_a) and v_winner_side = 'a' then 1
                                      when profile_id = any(v_b) and v_winner_side = 'b' then 1
                                      else 0 end),
        losses         = losses - (case when profile_id = any(v_a) and v_winner_side = 'b' then 1
                                        when profile_id = any(v_b) and v_winner_side = 'a' then 1
                                        else 0 end),
        points_for     = points_for - (case when profile_id = any(v_a) then v_match.score_a
                                            when profile_id = any(v_b) then v_match.score_b
                                            else 0 end),
        points_against = points_against - (case when profile_id = any(v_a) then v_match.score_b
                                                when profile_id = any(v_b) then v_match.score_a
                                                else 0 end),
        -- v0.0.6.2: take back the match points the match gave out.
        rr_points      = rr_points - (case when profile_id = any(v_a) then public.rr_match_points(v_match.score_a, v_match.score_b)
                                           when profile_id = any(v_b) then public.rr_match_points(v_match.score_b, v_match.score_a)
                                           else 0 end)
    where tournament_id = v_match.tournament_id
      and profile_id = any(v_a || v_b);

    -- 2. Ratings. Everyone in the removed match, plus everyone in a match
    --    played after it, needs their rating re-worked out.
    select array_agg(distinct p) into v_affected
    from (
      select unnest(v_a || v_b) as p
      union
      select unnest(array_remove(array[tm.player_a_id, tm.player_a2_id, tm.player_b_id, tm.player_b2_id], null))
        from tournament_matches tm
       where tm.tournament_id = v_match.tournament_id
         and tm.status = 'completed' and tm.phase <> 'challenge'
         and tm.score_a is not null and tm.score_b is not null
         and tm.id <> p_match_id
         and (tm.completed_at, tm.created_at, tm.id) > (v_match.completed_at, v_match.created_at, v_match.id)
    ) s;

    -- Starting point for each: their rating right after the last match
    -- they played BEFORE the removed one.
    foreach v_pid in array v_affected loop
      v_base := null;
      select h.rating into v_base
        from rr_rating_history h
        join tournament_matches tm on tm.id = h.match_id
       where h.tournament_id = v_match.tournament_id
         and h.profile_id = v_pid
         and tm.id <> p_match_id
         and (tm.completed_at, tm.created_at, tm.id) < (v_match.completed_at, v_match.created_at, v_match.id)
       order by tm.completed_at desc, tm.created_at desc, tm.id desc
       limit 1;

      if v_base is null then
        -- No earlier match this season: they started at whatever their
        -- current rating minus every change recorded for them.
        select tp.rr_rating - coalesce((
                 select sum(h.delta) from rr_rating_history h
                  where h.tournament_id = v_match.tournament_id and h.profile_id = v_pid
               ), 0)
          into v_base
          from tournament_participants tp
         where tp.tournament_id = v_match.tournament_id and tp.profile_id = v_pid;
      end if;

      v_ratings := jsonb_set(v_ratings, array[v_pid::text], to_jsonb(coalesce(v_base, 1000)));
    end loop;

    -- Replay every later match, in the order it was played.
    for v_later in
      select * from tournament_matches tm
       where tm.tournament_id = v_match.tournament_id
         and tm.status = 'completed' and tm.phase <> 'challenge'
         and tm.score_a is not null and tm.score_b is not null
         and tm.id <> p_match_id
         and (tm.completed_at, tm.created_at, tm.id) > (v_match.completed_at, v_match.created_at, v_match.id)
       order by tm.completed_at, tm.created_at, tm.id
    loop
      v_la := array_remove(array[v_later.player_a_id, v_later.player_a2_id], null);
      v_lb := array_remove(array[v_later.player_b_id, v_later.player_b2_id], null);

      select avg((v_ratings ->> p::text)::numeric) into v_avg_a from unnest(v_la) p;
      select avg((v_ratings ->> p::text)::numeric) into v_avg_b from unnest(v_lb) p;

      v_exp_a   := 1.0 / (1.0 + power(10.0, (v_avg_b - v_avg_a) / 400.0));
      v_delta_a := v_rr_k * ((case when v_later.score_a > v_later.score_b then 1.0 else 0.0 end) - v_exp_a);

      foreach v_pid in array v_la || v_lb loop
        v_new := (v_ratings ->> v_pid::text)::numeric
                 + (case when v_pid = any(v_la) then v_delta_a else -v_delta_a end);
        v_ratings := jsonb_set(v_ratings, array[v_pid::text], to_jsonb(v_new));

        insert into rr_rating_history (tournament_id, profile_id, match_id, rating, delta, recorded_at)
        values (v_later.tournament_id, v_pid, v_later.id, v_new,
                case when v_pid = any(v_la) then v_delta_a else -v_delta_a end,
                coalesce(v_later.completed_at, v_later.created_at))
        on conflict (match_id, profile_id)
        do update set rating = excluded.rating, delta = excluded.delta;
      end loop;

      v_replayed := v_replayed + 1;
    end loop;

    foreach v_pid in array v_affected loop
      update tournament_participants
      set rr_rating = (v_ratings ->> v_pid::text)::numeric
      where tournament_id = v_match.tournament_id and profile_id = v_pid;
    end loop;
  end if;

  -- 3. Remove the match itself (rr_rating_history rows cascade).
  delete from tournament_matches where id = p_match_id;

  -- 4. Record it.
  select coalesce(display_name, username) into v_actor_name from profiles where id = auth.uid();

  insert into match_removal_log (removed_by, removed_by_name, tournament_id, tournament_name, match_summary, detail)
  values (
    auth.uid(), v_actor_name, v_tournament.id, v_tournament.name, v_summary,
    jsonb_build_object(
      'match_id',      v_match.id,
      'phase',         v_match.phase,
      'format',        v_match.format,
      'player_a_id',   v_match.player_a_id,
      'player_a2_id',  v_match.player_a2_id,
      'player_b_id',   v_match.player_b_id,
      'player_b2_id',  v_match.player_b2_id,
      'score_a',       v_match.score_a,
      'score_b',       v_match.score_b,
      'completed_at',  v_match.completed_at,
      'reported_by',   v_match.reported_by,
      'later_matches_recalculated', v_replayed
    )
  );

  return jsonb_build_object(
    'summary',    v_summary,
    'recalculated', v_replayed,
    'phase',      v_match.phase
  );
end;
$$;

grant execute on function public.remove_tournament_match(uuid) to authenticated;
grant execute on function public.remove_tournament_match(uuid) to authenticated;

-- ═══ finalize_tournament (v0.0.3.11 body, seeds by points) ═══
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
    select profile_id, rr_points, wins, points_for + bonus_points as adjusted_score
    from tournament_participants
    where tournament_id = p_tournament_id
  ),
  seeded as (
    select profile_id, adjusted_score,
           row_number() over (order by rr_points desc, wins desc, adjusted_score desc, profile_id) as seed
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
grant execute on function public.finalize_tournament(uuid) to authenticated;

-- ═══ create_challenge (v0.0.3.11 body, rank rule by points) ═══
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
           row_number() over (order by rr_points desc, wins desc, points_for desc) as rnk
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
grant execute on function public.create_challenge(uuid, uuid) to authenticated;


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
  raise notice 'rr_points backfill OK for % participant row(s)', (select count(*) from public.tournament_participants);
end $$;

