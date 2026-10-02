-- supabase-migration-v0.0.6.1.sql
-- Run in Supabase → SQL Editor, after confirming v0.0.5.3 is applied
-- (this uses rr_rating_history, which that migration creates).
--
-- Remove a PLAYED round robin match (admin only), for a score entered by
-- accident or entered wrong. The existing cancel_tournament_match() only
-- handles matches nobody has played yet; this handles completed ones.
--
-- Removing a played match isn't just a delete, because ratings are Elo and
-- Elo depends on the order matches happened in: a later match's rating
-- change was worked out from the ratings at that moment, which included the
-- removed match. So remove_tournament_match():
--
--   1. Undoes the match's effect on the standings: wins, losses, points for
--      and against (or the +2 bonus point, for a challenge match).
--   2. Takes each affected player's rating from just BEFORE the removed
--      match (read from rr_rating_history) and replays every later match
--      of that season, in the order it was played, with the same team-
--      average Elo as report_tournament_match() (K = 32). The new ratings
--      and changes are written back to rr_rating_history and to
--      tournament_participants.rr_rating. Matches played before the removed
--      one are never touched.
--   3. Deletes the match (its own rr_rating_history rows go with it).
--   4. Writes one row to match_removal_log, so there's a record of what was
--      removed and by whom (useful if the wrong one is removed: re-enter it).
--
-- Only matches in a season that is still running can be removed. A finished
-- season is locked (finalize_tournament has already written career records
-- from it), and bracket matches are refused.
--
-- Play XP needs no step here: sync_quest_progress() recomputes it from the
-- matches that exist, so it corrects itself the next time anyone opens
-- Progress.

do $$
begin
  if to_regclass('public.rr_rating_history') is null then
    raise exception 'Run supabase-migration-v0.0.5.3.sql first (it creates rr_rating_history).';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- match_removal_log — a record of removed matches. Readable by global
-- admins from the SQL Editor or the API; written only by the function
-- below, and never editable.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.match_removal_log (
  id              uuid default uuid_generate_v4() primary key,
  created_at      timestamptz not null default now(),
  removed_by      uuid references public.profiles(id) on delete set null,
  removed_by_name text,
  tournament_id   uuid references public.tournaments(id) on delete set null,
  tournament_name text,
  match_summary   text not null,
  detail          jsonb not null default '{}'::jsonb
);

comment on table public.match_removal_log is
  'Round robin matches removed by an admin after being played. match_summary reads like "Jane 6-4 Tom"; detail holds the players, score and timestamps so the match can be re-entered. Names are snapshots so rows stay readable after a profile or season is deleted.';

create index if not exists match_removal_log_created_idx
  on public.match_removal_log (created_at desc);

alter table public.match_removal_log enable row level security;

drop policy if exists "Global admins read match removal log" on public.match_removal_log;
create policy "Global admins read match removal log"
  on public.match_removal_log for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ));

-- No insert/update/delete policies on purpose: only the SECURITY DEFINER
-- function writes, and nothing can rewrite the log afterwards.
revoke insert, update, delete on public.match_removal_log from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- remove_tournament_match()
-- ═══════════════════════════════════════════════════════════════════

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
