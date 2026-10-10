-- ═══════════════════════════════════════════════════════════════════
-- v0.0.6.4 — Losing is worth 0 to 3; battle pass XP follows match points
--
-- WHY
--   v0.0.6.2 gave every loss at least 1 point, so a 0-4 loss still paid.
--   That let volume stand in for results. A loss now earns exactly the
--   games you won, capped at 3, and the battle pass uses the same rule.
--
-- RULE (round robin and bracket matches, singles and doubles)
--   Win                   4 points
--   Loss                  games won, 0 to 3   (0-4 earns 0, 3-4 earns 3)
--   Challenge matches     no points (unchanged)
--
-- BATTLE PASS (Play XP)
--   Each such match earns 4 XP per match point: a win is 16 XP, a 3-4
--   loss 12, 2-4 8, 1-4 4, 0-4 0. The weekly shape is unchanged: the
--   first 5 matches a week earn their own XP, later ones trickle at 2.
--   Ladder matches and challenge matches have no points, so they stay at
--   a flat 15 XP. Quest XP is untouched.
--
-- WHAT THIS CHANGES
--   1. rr_match_points(): the loss branch drops its floor of 1.
--   2. rr_points is recomputed for EVERY tournament, finished ones too
--      (same as the v0.0.6.2 backfill). Final placings already awarded
--      are not touched; only the points figure shown beside them moves.
--   3. sync_quest_progress(): Play XP uses the rule above, but only for
--      weeks from the week this migration is first run. Earlier weeks keep
--      the flat 15 XP per match they were already paid, so nobody's level
--      moves backwards. (The Play XP stream is recomputed from match
--      history on every sync, so this cut-off is what protects history.)
--      Matches already played in the current week are re-scored under the
--      new rule the next time /progress is opened.
--
-- Requires v0.0.6.3. Idempotent: safe to run twice (the cut-off week is
-- set the first time and never moved).
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.rr_score_is_legal(integer,integer)') is null then
    raise exception 'Run supabase-migration-v0.0.6.3.sql first (it creates rr_score_is_legal).';
  end if;
  if to_regclass('public.player_weekly_play_xp') is null
     or to_regprocedure('public.sync_quest_progress(uuid)') is null then
    raise exception 'Run supabase-migration-v0.0.5.1.sql first (it creates Play XP).';
  end if;
end $$;

-- ── 1. The rule ────────────────────────────────────────────────────
create or replace function public.rr_match_points(p_games_won int, p_games_lost int)
returns int
language sql
immutable
as $$
  select case when p_games_won > p_games_lost then 4
              else greatest(0, least(3, p_games_won)) end;
$$;

grant execute on function public.rr_match_points(int, int) to authenticated;

-- ── 2. Backfill rr_points under the new rule ───────────────────────
do $$
declare v_changed int;
begin
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
  raise notice 'rr_points changed for % participant row(s)', v_changed;
end $$;

-- ── 3. Play XP: remember which week the new rule starts ────────────
create table if not exists public.play_xp_rule (
  id             boolean primary key default true check (id),   -- one row only
  effective_from timestamptz not null
);
alter table public.play_xp_rule enable row level security;   -- read by the server function only

insert into public.play_xp_rule (id, effective_from)
values (true, date_trunc('week', now()))
on conflict (id) do nothing;

-- ── 4. Play XP follows match points ────────────────────────────────
create or replace function public.sync_quest_progress(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now          timestamptz := now();
  v_week_start   timestamptz := date_trunc('week', v_now);
  v_week_end     timestamptz := v_week_start + interval '7 days';
  v_month_start  timestamptz := date_trunc('month', v_now);
  v_month_end    timestamptz := v_month_start + interval '1 month';
  v_season_id    uuid;
  v_season_start timestamptz;
  v_season_end   timestamptz;
  v_quest        record;
  v_player       record;
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_progress     int;
  v_existing     record;
  -- Play XP tunables (see header comment; tuned in the v0.0.5.1 balance model)
  c_play_xp      constant int := 15;  -- XP per match at the full rate
  c_play_cap     constant int := 5;   -- matches per week at the full rate
  c_trickle_xp   constant int := 2;   -- XP per match beyond the cap
  c_xp_per_point constant int := 4;   -- v0.0.6.4: round robin XP = match points x this (win 16 .. 0-4 loss 0)
  v_rule_start   timestamptz;         -- weeks before this keep the old flat rate
  v_wk           record;
  v_target       int;
  v_prev         int;
begin
  select effective_from into v_rule_start from public.play_xp_rule;
  v_rule_start := coalesce(v_rule_start, date_trunc('week', now()));

  select id, created_at, coalesce(completed_at, 'infinity'::timestamptz)
    into v_season_id, v_season_start, v_season_end
    from tournaments
   where league_id = p_league_id and status <> 'completed'
   order by created_at desc
   limit 1;

  -- ── Play XP stream ────────────────────────────────────────────────
  -- Recomputed from match history for EVERY week (not just this one), so
  -- a week nobody opened /progress in still gets credited later. Each
  -- (player, week) row stores what has been awarded so far; we award only
  -- the difference, which keeps it idempotent and lets a cancelled match
  -- claw its XP back. Weeks in the table with no matches left are
  -- recomputed to 0 via the full join.
  for v_player in select profile_id from players where league_id = p_league_id loop
    for v_wk in
      select coalesce(m.wk, e.week_start) as wk, coalesce(m.n, 0) as n, coalesce(m.target, 0) as target
        from (
          -- Per week: the first c_play_cap matches (by completion time) earn
          -- their own XP, every later match earns the trickle rate.
          select wk, count(*)::int as n,
                 sum(case when rn <= c_play_cap then xp else c_trickle_xp end)::int as target
            from (
              select wk, xp,
                     row_number() over (partition by wk order by done_at, id) as rn
                from (
                  select date_trunc('week', completed_at) as wk, completed_at as done_at, id,
                         c_play_xp as xp
                    from matches
                   where league_id = p_league_id and status = 'completed' and completed_at is not null
                     and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
                  union all
                  select date_trunc('week', tm.completed_at), tm.completed_at, tm.id,
                         -- v0.0.6.4: round robin / bracket matches from the rule's
                         -- start week onward pay 4 XP per match point. Challenges,
                         -- ladder matches and earlier weeks stay at the flat rate.
                         case when tm.phase <> 'challenge'
                                   and tm.score_a is not null and tm.score_b is not null
                                   and date_trunc('week', tm.completed_at) >= v_rule_start
                              then c_xp_per_point * (case when v_player.profile_id in (tm.player_a_id, tm.player_a2_id)
                                                          then public.rr_match_points(tm.score_a, tm.score_b)
                                                          else public.rr_match_points(tm.score_b, tm.score_a) end)
                              else c_play_xp end
                    from tournament_matches tm
                    join tournament_weeks tw on tw.id = tm.week_id
                    join tournaments t on t.id = tw.tournament_id
                   where t.league_id = p_league_id and tm.status = 'completed' and tm.completed_at is not null
                     and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
                ) allm
            ) ranked
           group by wk
        ) m
        full join (
          select week_start from player_weekly_play_xp
           where league_id = p_league_id and profile_id = v_player.profile_id
        ) e on e.week_start = m.wk
    loop
      v_target := v_wk.target;

      select xp_awarded into v_prev from player_weekly_play_xp
       where league_id = p_league_id and profile_id = v_player.profile_id and week_start = v_wk.wk;
      v_prev := coalesce(v_prev, 0);

      insert into player_weekly_play_xp (league_id, profile_id, week_start, matches_counted, xp_awarded)
      values (p_league_id, v_player.profile_id, v_wk.wk, v_wk.n, v_target)
      on conflict (league_id, profile_id, week_start)
      do update set matches_counted = excluded.matches_counted, xp_awarded = excluded.xp_awarded;

      if v_target <> v_prev then
        update players set xp = greatest(xp + (v_target - v_prev), 0)
         where profile_id = v_player.profile_id and league_id = p_league_id;
      end if;
    end loop;
  end loop;

  for v_quest in select * from quest_templates where active loop

    if v_quest.cadence = 'weekly' then
      v_period_start := v_week_start; v_period_end := v_week_end;
    elsif v_quest.cadence = 'monthly' then
      v_period_start := v_month_start; v_period_end := v_month_end;
    else
      if v_season_id is null then continue; end if; -- no active season right now — skip seasonal quests this pass
      v_period_start := v_season_start; v_period_end := v_season_end;
    end if;

    for v_player in select profile_id from players where league_id = p_league_id loop
      v_progress := 0;

      if v_quest.criteria_type = 'play_matches' then
        select count(*) into v_progress from (
          select id from matches
           where league_id = p_league_id and status = 'completed'
             and completed_at >= v_period_start and completed_at < v_period_end
             and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
          union all
          select tm.id from tournament_matches tm
            join tournament_weeks tw on tw.id = tm.week_id
            join tournaments t on t.id = tw.tournament_id
           where t.league_id = p_league_id and tm.status = 'completed'
             and tm.completed_at >= v_period_start and tm.completed_at < v_period_end
             and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
        ) combined;

      elsif v_quest.criteria_type = 'distinct_opponents' then
        select count(distinct opp) into v_progress from (
          select case when challenger_id = v_player.profile_id then opponent_id else challenger_id end as opp
            from matches
           where league_id = p_league_id and status = 'completed'
             and completed_at >= v_period_start and completed_at < v_period_end
             and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
          union
          select unnest(array_remove(array[tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id], v_player.profile_id))
            from tournament_matches tm
            join tournament_weeks tw on tw.id = tm.week_id
            join tournaments t on t.id = tw.tournament_id
           where t.league_id = p_league_id and tm.status = 'completed'
             and tm.completed_at >= v_period_start and tm.completed_at < v_period_end
             and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
        ) opponents;

      elsif v_quest.criteria_type = 'play_lapsed_opponent' then
        -- v0.0.5.1: an opponent counts if you have NOT played them in the
        -- 30 days before this period began (never-played-before qualifies
        -- too). Unlike the old all-time check this can't be permanently
        -- exhausted in a small league.
        select count(*) into v_progress from (
          select distinct opp from (
            select case when challenger_id = v_player.profile_id then opponent_id else challenger_id end as opp
              from matches
             where league_id = p_league_id and status = 'completed'
               and completed_at >= v_period_start and completed_at < v_period_end
               and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
            union
            select unnest(array_remove(array[tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id], v_player.profile_id))
              from tournament_matches tm
              join tournament_weeks tw on tw.id = tm.week_id
              join tournaments t on t.id = tw.tournament_id
             where t.league_id = p_league_id and tm.status = 'completed'
               and tm.completed_at >= v_period_start and tm.completed_at < v_period_end
               and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
          ) this_period
          where opp is not null
            and not exists (
              select 1 from matches m2
               where m2.league_id = p_league_id and m2.status = 'completed'
                 and m2.completed_at >= v_period_start - interval '30 days' and m2.completed_at < v_period_start
                 and ((m2.challenger_id = v_player.profile_id and m2.opponent_id = this_period.opp)
                   or (m2.opponent_id = v_player.profile_id and m2.challenger_id = this_period.opp))
              union all
              select 1 from tournament_matches tm2
                join tournament_weeks tw2 on tw2.id = tm2.week_id
                join tournaments t2 on t2.id = tw2.tournament_id
               where t2.league_id = p_league_id and tm2.status = 'completed'
                 and tm2.completed_at >= v_period_start - interval '30 days' and tm2.completed_at < v_period_start
                 and v_player.profile_id in (tm2.player_a_id, tm2.player_b_id, tm2.player_a2_id, tm2.player_b2_id)
                 and this_period.opp in (tm2.player_a_id, tm2.player_b_id, tm2.player_a2_id, tm2.player_b2_id)
            )
        ) lapsed_opponents;

      elsif v_quest.criteria_type = 'play_weeks' then
        select count(distinct wk) into v_progress from (
          select date_trunc('week', completed_at) as wk from matches
           where league_id = p_league_id and status = 'completed'
             and completed_at >= v_period_start and completed_at < v_period_end
             and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
          union
          select date_trunc('week', tm.completed_at) from tournament_matches tm
            join tournament_weeks tw on tw.id = tm.week_id
            join tournaments t on t.id = tw.tournament_id
           where t.league_id = p_league_id and tm.status = 'completed'
             and tm.completed_at >= v_period_start and tm.completed_at < v_period_end
             and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
        ) weeks;

      elsif v_quest.criteria_type = 'play_doubles' then
        select count(*) into v_progress
          from tournament_matches tm
          join tournament_weeks tw on tw.id = tm.week_id
          join tournaments t on t.id = tw.tournament_id
         where t.league_id = p_league_id and tm.status = 'completed' and tm.format = 'doubles'
           and tm.completed_at >= v_period_start and tm.completed_at < v_period_end
           and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id);

      elsif v_quest.criteria_type = 'rr_distinct_weeks' then
        select count(distinct tm.week_id) into v_progress
          from tournament_matches tm
          join tournament_weeks tw on tw.id = tm.week_id
         where tw.tournament_id = v_season_id and tm.status = 'completed'
           and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id);

      elsif v_quest.criteria_type = 'play_after_loss' then
        select count(*) into v_progress from (
          select 1 where exists (
            select 1 from matches lm
             where lm.league_id = p_league_id and lm.status = 'completed'
               and lm.completed_at >= v_period_start and lm.completed_at < v_period_end
               and lm.winner_id is not null and lm.winner_id <> v_player.profile_id
               and (lm.challenger_id = v_player.profile_id or lm.opponent_id = v_player.profile_id)
               and exists (
                 select 1 from matches nm
                  where nm.league_id = p_league_id and nm.status = 'completed'
                    and nm.completed_at > lm.completed_at and nm.completed_at < v_period_end
                    and (nm.challenger_id = v_player.profile_id or nm.opponent_id = v_player.profile_id)
               )
          )
        ) x;
      end if;

      select * into v_existing from player_quest_progress
       where league_id = p_league_id and profile_id = v_player.profile_id
         and quest_template_id = v_quest.id and period_start = v_period_start;

      if v_existing.id is null then
        insert into player_quest_progress
          (league_id, profile_id, quest_template_id, period_start, period_end, progress_count)
        values (p_league_id, v_player.profile_id, v_quest.id, v_period_start, v_period_end, v_progress)
        returning * into v_existing;
      else
        update player_quest_progress set progress_count = v_progress where id = v_existing.id;
        v_existing.progress_count := v_progress;
      end if;

      if v_existing.completed_at is null and v_progress >= v_quest.target_count then
        update player_quest_progress
           set completed_at = v_now, xp_awarded = v_quest.xp_reward
         where id = v_existing.id;
        update players set xp = xp + v_quest.xp_reward
         where profile_id = v_player.profile_id and league_id = p_league_id;
      end if;

    end loop;
  end loop;
end;
$$;
grant execute on function public.sync_quest_progress(uuid) to authenticated;

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
  raise notice 'v0.0.6.4 OK: rr_points consistent for % participant row(s); new Play XP rule starts week of %',
    (select count(*) from public.tournament_participants),
    (select effective_from from public.play_xp_rule);
end $$;
