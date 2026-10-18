-- =====================================================================
-- v0.0.8.3 - Weekly quests that reward playing stronger opponents
--
-- WHY
--   The weekly quests so far reward showing up. These add a nudge towards
--   challenging better players, without making it about winning: a quest
--   counts when the match is played, win or lose.
--
-- NEW WEEKLY QUESTS (every player sees all of them every week)
--   Punch Up            +25 XP  Play someone rated 25+ above you.
--                               At the top (nobody rated 25+ above you) it becomes
--                               "Fair Fight or Mentor": a close match (within 100) or
--                               someone below you.
--   Reach               +40 XP  Play someone rated 100+ above you.
--   Be the Challenger   +20 XP  Send a challenge that gets played (a ladder
--                               challenge, or a round robin week's challenge match).
--
-- HOW IT DECIDES
--   * "Rated" is the ladder rating (Elo), never round robin points.
--   * Ladder AND round robin matches count (singles and doubles; for doubles the
--     other pair's average is compared with your own rating).
--   * The rating used is each player's rating when the match was played, read back
--     from elo_history, so a later swing in ratings cannot change old credit.
--   * Each opponent counts once per week per quest.
--   * Assigned round robin pairings do not count as "challenging".
--
-- WHAT THIS CHANGES
--   1. ladder_rating_at(): a player's ladder rating at a moment in time.
--   2. quest_match_facts(): one row per completed match in a period, with both
--      sides' ratings then (internal; not callable from the app).
--   3. Three quest_templates rows.
--   4. sync_quest_progress(): the live v0.0.6.4 version plus the three new rules
--      (nothing else in it is changed).
--   5. An index on elo_history so the lookups stay fast.
--
-- Requires v0.0.6.4. Idempotent: safe to run twice. Does not move anyone's XP by
-- itself: XP is awarded the next time /progress is opened and a quest is complete.
-- =====================================================================

do $$
begin
  -- 6.4 is the version that made the quest sync use match points; this migration
  -- replaces that exact function, so refuse to run on an older one.
  if to_regprocedure('public.sync_quest_progress(uuid)') is null
     or pg_get_functiondef('public.sync_quest_progress(uuid)'::regprocedure) not like '%rr_match_points%' then
    raise exception 'Run supabase-migration-v0.0.6.4.sql first (this replaces the quest function that version changed).';
  end if;
  if to_regclass('public.elo_history') is null or to_regclass('public.quest_templates') is null then
    raise exception 'quest_templates / elo_history are missing - run the earlier migrations first.';
  end if;
end $$;

-- 5. keep the "rating at that time" lookups fast
create index if not exists idx_elo_history_rating_at
  on public.elo_history (league_id, profile_id, recorded_at desc);

-- 1. A player's ladder rating at a moment: the newest rating recorded at or before
--    then, or the starting 1000 if they had not played yet. Pass the match's own id
--    to leave out the rating that match itself produced.
create or replace function public.ladder_rating_at(
  p_league_id uuid, p_profile_id uuid, p_at timestamptz, p_exclude_match uuid default null)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select e.rating from elo_history e
      where e.league_id = p_league_id and e.profile_id = p_profile_id
        and e.recorded_at <= p_at
        and (p_exclude_match is null or e.match_id is distinct from p_exclude_match)
      order by e.recorded_at desc, e.id desc
      limit 1),
    1000);
$$;

-- 2. Every completed match a player was in during [p_from, p_to), ladder and round
--    robin, with the ratings that applied then.
--      opp_key       who the opponent was (the pair, for doubles), so repeats count once
--      my_rating     the player's ladder rating then
--      opp_rating    the opponent's (average of the pair for doubles)
--      i_challenged  true if the player sent the challenge (ladder, or round robin
--                    'challenge' phase only)
create or replace function public.quest_match_facts(
  p_league_id uuid, p_profile_id uuid, p_from timestamptz, p_to timestamptz)
returns table (opp_key text, my_rating numeric, opp_rating numeric, i_challenged boolean)
language sql
stable
set search_path = public
as $$
  select
    case when m.challenger_id = p_profile_id then m.opponent_id::text else m.challenger_id::text end,
    public.ladder_rating_at(p_league_id, p_profile_id, m.completed_at, m.id)::numeric,
    public.ladder_rating_at(p_league_id,
      case when m.challenger_id = p_profile_id then m.opponent_id else m.challenger_id end,
      m.completed_at, m.id)::numeric,
    (m.challenger_id = p_profile_id)
  from matches m
  where m.league_id = p_league_id and m.status = 'completed'
    and m.completed_at >= p_from and m.completed_at < p_to
    and p_profile_id in (m.challenger_id, m.opponent_id)

  union all

  select
    (select string_agg(x::text, ',' order by x::text) from unnest(o.opps) x where x is not null),
    public.ladder_rating_at(p_league_id, p_profile_id, tm.completed_at)::numeric,
    (select avg(public.ladder_rating_at(p_league_id, x, tm.completed_at))
       from unnest(o.opps) x where x is not null),
    (tm.phase = 'challenge' and tm.challenger_id = p_profile_id)
  from tournament_matches tm
  join tournament_weeks tw on tw.id = tm.week_id
  join tournaments t on t.id = tw.tournament_id
  cross join lateral (
    select case when p_profile_id in (tm.player_a_id, tm.player_a2_id)
                then array[tm.player_b_id, tm.player_b2_id]
                else array[tm.player_a_id, tm.player_a2_id] end as opps
  ) o
  where t.league_id = p_league_id and tm.status = 'completed'
    and tm.completed_at >= p_from and tm.completed_at < p_to
    and p_profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id);
$$;

-- internal: only the quest sync (which runs as the table owner) needs these
revoke execute on function public.ladder_rating_at(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.quest_match_facts(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- 3. The quests
insert into public.quest_templates (key, cadence, title, description, criteria_type, target_count, xp_reward)
values
  ('weekly_punch_up',   'weekly', 'Punch Up',          'Play someone rated above you - win or lose',          'play_higher',      1, 25),
  ('weekly_reach',      'weekly', 'Reach',             'Play someone rated 100+ above you - win or lose',     'play_much_higher', 1, 40),
  ('weekly_challenger', 'weekly', 'Be the Challenger', 'Send a challenge that gets played',                   'send_challenge',   1, 20)
on conflict (key) do update
  set cadence = excluded.cadence, title = excluded.title, description = excluded.description,
      criteria_type = excluded.criteria_type, target_count = excluded.target_count,
      xp_reward = excluded.xp_reward, active = true;

-- 4. The quest sync: the v0.0.6.4 function with the three new rules added
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
  v_my_rating    numeric;
  v_is_top       boolean;
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
end;
$$;

grant execute on function public.sync_quest_progress(uuid) to authenticated;

-- Self-check
do $$
begin
  if (select count(*) from public.quest_templates
       where active and key in ('weekly_punch_up', 'weekly_reach', 'weekly_challenger')) <> 3 then
    raise exception 'the three new quests are not all in place';
  end if;
  if pg_get_functiondef('public.sync_quest_progress(uuid)'::regprocedure) not like '%play_much_higher%'
     or pg_get_functiondef('public.sync_quest_progress(uuid)'::regprocedure) not like '%play_after_loss%' then
    raise exception 'sync_quest_progress is not the expected version';
  end if;
  if has_function_privilege('authenticated', 'public.quest_match_facts(uuid,uuid,timestamptz,timestamptz)', 'execute') then
    raise exception 'quest_match_facts should not be callable from the app';
  end if;
  raise notice 'v0.0.8.3 OK: Punch Up, Reach and Be the Challenger are live (ladder and round robin).';
end $$;
