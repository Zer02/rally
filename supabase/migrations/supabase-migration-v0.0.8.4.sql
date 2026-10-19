-- =====================================================================
-- v0.0.8.4 - The battle pass belongs to the season, and spam pays less and less
--
-- WHY
--   The pass was sized for a year (Level 10 at 9,000 XP) and XP never reset, so
--   it could not be "completed in a season". This makes the pass per season and
--   sizes it for one (see src/lib/xp.ts). It also makes repeat grinding worth
--   less, especially against the same opponent, without ever making it worthless.
--
-- WHAT THIS CHANGES
--   1. players.pass_xp: XP earned in the current round robin season. players.xp
--      stays the lifetime total and is not touched. Nothing is reset or deleted:
--      pass_xp is worked out from the two XP ledgers (weekly play XP and quest
--      rewards) for everything since the week the newest round robin season
--      was created, and it restarts by itself when the next season is created.
--      With no season yet it is the whole history.
--   2. Play XP now shrinks with volume and with repeats (from next Monday, so no
--      past week is re-rated):
--        matches in the week     1-5: 100%   6-8: 50%   9-12: 25%   13+: 10%
--        meetings with the same  1st: 100%   2nd: 50%   3rd: 25%    4th+: 10%
--        opponent that week (an opposing pair counts as one opponent)
--      The two multiply, and a match worth anything still pays at least 1 XP.
--      Ladder and round robin share the count. A round robin loss worth 0 stays 0.
--   3. sync_quest_progress(): the live v0.0.8.3 version with the new play XP rule
--      and a pass_xp refresh at the end (nothing else in it is changed).
--
-- Requires v0.0.8.3. Idempotent: safe to run twice.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.quest_match_facts(uuid,uuid,timestamptz,timestamptz)') is null then
    raise exception 'Run supabase-migration-v0.0.8.3.sql first (this replaces the quest function that version changed).';
  end if;
end $$;

-- 1. Pass XP
alter table public.players add column if not exists pass_xp int not null default 0;

-- The pass restarts with each round robin season: it counts from the start of the
-- week the newest season was created.
create or replace function public.pass_window_start(p_league_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select date_trunc('week', t.created_at) from tournaments t
      where t.league_id = p_league_id order by t.created_at desc limit 1),
    '-infinity'::timestamptz);
$$;

create or replace function public.refresh_pass_xp(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := public.pass_window_start(p_league_id);
begin
  update players p
     set pass_xp =
           coalesce((select sum(w.xp_awarded) from player_weekly_play_xp w
                      where w.league_id = p.league_id and w.profile_id = p.profile_id
                        and w.week_start >= v_start), 0)::int
         + coalesce((select sum(g.xp_awarded) from player_quest_progress g
                      where g.league_id = p.league_id and g.profile_id = p.profile_id
                        and g.completed_at is not null and g.completed_at >= v_start), 0)::int
   where p.league_id = p_league_id;
end;
$$;
revoke execute on function public.pass_window_start(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_pass_xp(uuid)   from public, anon, authenticated;

-- 2. Diminishing returns on play XP (the two factors live here, in one place)
create or replace function public.play_xp_volume_factor(p_nth_match_this_week int)
returns numeric
language sql
immutable
as $$
  select case when p_nth_match_this_week <= 5  then 1.0
              when p_nth_match_this_week <= 8  then 0.5
              when p_nth_match_this_week <= 12 then 0.25
              else 0.1 end;
$$;

create or replace function public.play_xp_repeat_factor(p_nth_meeting_this_week int)
returns numeric
language sql
immutable
as $$
  select case when p_nth_meeting_this_week <= 1 then 1.0
              when p_nth_meeting_this_week = 2  then 0.5
              when p_nth_meeting_this_week = 3  then 0.25
              else 0.1 end;
$$;
revoke execute on function public.play_xp_volume_factor(int) from public, anon, authenticated;
revoke execute on function public.play_xp_repeat_factor(int) from public, anon, authenticated;

-- the rule starts next Monday (weeks before it keep the old cap-and-trickle rate)
alter table public.play_xp_rule add column if not exists decay_from timestamptz;
update public.play_xp_rule
   set decay_from = date_trunc('week', now()) + interval '7 days'
 where decay_from is null;

-- 3. The quest sync: the v0.0.8.3 function with the new play XP rule and a pass refresh
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
  v_decay_start  timestamptz;         -- v0.0.8.4: weeks before this keep the old cap-and-trickle rate
  v_my_rating    numeric;
  v_is_top       boolean;
begin
  select effective_from, decay_from into v_rule_start, v_decay_start from public.play_xp_rule;
  v_decay_start := coalesce(v_decay_start, date_trunc('week', now()));
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
                 -- v0.0.8.4: from the rule's decay week on, every match pays its own XP times two
                 -- shrinking factors: how many matches you have already played this week, and how
                 -- many times you have already met this opponent this week (opposing pair, for
                 -- doubles). A match worth anything pays at least 1 XP, so volume never stops
                 -- counting, it just stops being worth it quickly. Earlier weeks keep the old rule:
                 -- the first c_play_cap at full rate, then a trickle.
                 sum(case
                       when wk < v_decay_start then (case when rn <= c_play_cap then xp else c_trickle_xp end)
                       when xp <= 0 then 0
                       else greatest(1, round(xp * public.play_xp_volume_factor(rn::int) * public.play_xp_repeat_factor(rep::int)))
                     end)::int as target
            from (
              select wk, xp, opp_key,
                     row_number() over (partition by wk order by done_at, id) as rn,
                     row_number() over (partition by wk, opp_key order by done_at, id) as rep
                from (
                  select date_trunc('week', completed_at) as wk, completed_at as done_at, id,
                         c_play_xp as xp,
                         case when challenger_id = v_player.profile_id then opponent_id::text else challenger_id::text end as opp_key
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
                              else c_play_xp end,
                         (select string_agg(x::text, ',' order by x::text)
                            from unnest(case when v_player.profile_id in (tm.player_a_id, tm.player_a2_id)
                                             then array[tm.player_b_id, tm.player_b2_id]
                                             else array[tm.player_a_id, tm.player_a2_id] end) x
                           where x is not null)
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
      elsif v_quest.criteria_type in ('play_higher', 'play_much_higher') then
        -- v0.0.8.3: rating-aware quests. Win or lose, ladder or round robin, an opponent
        -- counts by their LADDER rating when the match was played (not today's). Each
        -- opponent (or opposing doubles pair) counts once per period. The 25 / 100 point
        -- gaps are mirrored in src/lib/quests.ts - change both together.
        select rating into v_my_rating from players
         where league_id = p_league_id and profile_id = v_player.profile_id;
        -- "At the top": nobody in the league is rated 25+ above you right now. For them
        -- Punch Up becomes Fair Fight or Mentor: a close match (within 100) or anyone below.
        v_is_top := not exists (
          select 1 from players p2
           where p2.league_id = p_league_id and p2.rating >= v_my_rating + 25);
        select count(distinct f.opp_key) into v_progress
          from public.quest_match_facts(p_league_id, v_player.profile_id, v_period_start, v_period_end) f
         where case
                 when v_quest.criteria_type = 'play_much_higher' then f.opp_rating - f.my_rating >= 100
                 else f.opp_rating - f.my_rating >= 25
                      or (v_is_top and f.opp_rating - f.my_rating <= 100)
               end;

      elsif v_quest.criteria_type = 'send_challenge' then
        -- You sent the challenge for a match that got played: a ladder challenge, or a
        -- round robin week's challenge match. Assigned round robin pairings do not count.
        select count(distinct f.opp_key) into v_progress
          from public.quest_match_facts(p_league_id, v_player.profile_id, v_period_start, v_period_end) f
         where f.i_challenged;

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

  -- v0.0.8.4: this season's pass XP, for everyone in the league
  perform public.refresh_pass_xp(p_league_id);
end;
$$;

grant execute on function public.sync_quest_progress(uuid) to authenticated;

-- Everyone's pass XP, from what is already recorded
do $$
declare r record;
begin
  for r in select id from public.leagues loop
    perform public.refresh_pass_xp(r.id);
  end loop;
end $$;

-- Self-check
do $$
declare v_def text := pg_get_functiondef('public.sync_quest_progress(uuid)'::regprocedure);
begin
  if v_def not like '%refresh_pass_xp%' or v_def not like '%play_xp_repeat_factor%' or v_def not like '%play_much_higher%' then
    raise exception 'sync_quest_progress is not the expected version';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'pass_xp') then
    raise exception 'players.pass_xp is missing';
  end if;
  if (select decay_from from public.play_xp_rule) is null then
    raise exception 'the play XP decay start is not set';
  end if;
  if has_function_privilege('authenticated', 'public.refresh_pass_xp(uuid)', 'execute') then
    raise exception 'refresh_pass_xp should not be callable from the app';
  end if;
  raise notice 'v0.0.8.4 OK: the pass is per season, and play XP now shrinks with volume and repeats from %.',
    (select to_char(decay_from, 'YYYY-MM-DD') from public.play_xp_rule);
end $$;
