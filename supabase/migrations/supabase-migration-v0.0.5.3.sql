-- supabase-migration-v0.0.5.3.sql
-- Run in Supabase → SQL Editor, after v0.0.5.1 (safe to run before 5.2's
-- frontend files are in place — nothing here changes existing behaviour).
--
-- Round robin rating history. rr_rating has only ever stored its current
-- value, so the Profile page couldn't chart it the way the ladder's
-- elo_history charts the ladder rating. This adds rr_rating_history:
-- one row per player per completed round robin match, holding the
-- rating right after the match and the change it made.
--
--   1. rr_rating_history table (public read, like elo_history; written
--      only by report_tournament_match(), which is SECURITY DEFINER).
--   2. report_tournament_match() re-declared from its v0.0.4.0 body with
--      one addition at the end: the history insert. Scoring, wins/losses,
--      points and the rr_rating maths are untouched.
--   3. Backfill: existing completed matches are replayed in completed_at
--      order per season, using the same team-average Elo (K = 32, start
--      1000, challenge matches excluded) so the graph has history from day
--      one. Each replayed final rating is compared with the stored
--      tournament_participants.rr_rating; any mismatch is reported as a
--      NOTICE rather than failing the migration. Re-running is safe: the
--      table is cleared and rebuilt from the matches.

create table if not exists public.rr_rating_history (
  id            uuid default uuid_generate_v4() primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  match_id      uuid not null references public.tournament_matches(id) on delete cascade,
  rating        numeric not null,
  delta         numeric not null,
  recorded_at   timestamptz not null default now(),
  unique (match_id, profile_id)
);

alter table public.rr_rating_history enable row level security;
drop policy if exists "RR rating history is public" on public.rr_rating_history;
create policy "RR rating history is public" on public.rr_rating_history for select using (true);
-- No insert/update policy — the SECURITY DEFINER function only.

create index if not exists idx_rr_history_profile on public.rr_rating_history(profile_id, tournament_id, recorded_at);

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

-- ═══════════════════════════════════════════════════════════════════
-- Backfill by replaying history.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  v_m        record;
  v_ratings  jsonb;
  v_a        uuid[];
  v_b        uuid[];
  v_avg_a    numeric;
  v_avg_b    numeric;
  v_exp_a    numeric;
  v_delta_a  numeric;
  v_pid      uuid;
  v_new      numeric;
  v_t        uuid;
  v_bad      int := 0;
  v_rows     int := 0;
  v_rec      record;
begin
  delete from rr_rating_history;

  for v_t in select distinct tournament_id from tournament_matches
              where status = 'completed' and phase <> 'challenge' loop
    v_ratings := '{}'::jsonb;

    for v_m in
      select * from tournament_matches
       where tournament_id = v_t and status = 'completed' and phase <> 'challenge'
         and score_a is not null and score_b is not null
       order by completed_at, created_at, id
    loop
      v_a := array_remove(array[v_m.player_a_id, v_m.player_a2_id], null);
      v_b := array_remove(array[v_m.player_b_id, v_m.player_b2_id], null);

      -- average rating per side (1000 for anyone not seen yet)
      select avg(coalesce((v_ratings ->> p::text)::numeric, 1000)) into v_avg_a from unnest(v_a) p;
      select avg(coalesce((v_ratings ->> p::text)::numeric, 1000)) into v_avg_b from unnest(v_b) p;

      v_exp_a   := 1.0 / (1.0 + power(10.0, (v_avg_b - v_avg_a) / 400.0));
      v_delta_a := 32 * ((case when v_m.score_a > v_m.score_b then 1.0 else 0.0 end) - v_exp_a);

      foreach v_pid in array v_a || v_b loop
        v_new := coalesce((v_ratings ->> v_pid::text)::numeric, 1000)
                 + case when v_pid = any(v_a) then v_delta_a else -v_delta_a end;
        v_ratings := jsonb_set(v_ratings, array[v_pid::text], to_jsonb(v_new));

        insert into rr_rating_history (tournament_id, profile_id, match_id, rating, delta, recorded_at)
        values (v_t, v_pid, v_m.id, v_new,
                case when v_pid = any(v_a) then v_delta_a else -v_delta_a end,
                coalesce(v_m.completed_at, v_m.created_at))
        on conflict (match_id, profile_id) do nothing;
        v_rows := v_rows + 1;
      end loop;
    end loop;

    -- sanity check against what report_tournament_match() actually stored
    for v_rec in
      select profile_id, rr_rating from tournament_participants where tournament_id = v_t
    loop
      if v_ratings ? v_rec.profile_id::text
         and abs((v_ratings ->> v_rec.profile_id::text)::numeric - v_rec.rr_rating) > 0.01 then
        v_bad := v_bad + 1;
        raise notice 'rr_rating mismatch: tournament %, player %: replayed %, stored %',
          v_t, v_rec.profile_id, round((v_ratings ->> v_rec.profile_id::text)::numeric, 2), round(v_rec.rr_rating, 2);
      end if;
    end loop;
  end loop;

  raise notice 'rr_rating_history backfill: % rows written, % mismatching player(s)', v_rows, v_bad;
end $$;
