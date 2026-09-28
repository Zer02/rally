-- supabase-migration-v0.0.5.1.sql
-- Run in Supabase SQL Editor after confirming v0.0.5.0 is applied.
--
-- Battle pass rebalance. XP is its own measurement — it never touches
-- rating / rr_rating, and winning earns nothing extra. It exists so a
-- rec player who keeps showing up keeps feeling progress.
--
-- Two XP streams now:
--   1. Play XP   — 15 XP per completed match, full rate for the first 5
--                  matches each week, 2 XP per match after that. Volume
--                  matters but can't be farmed without limit.
--   2. Quest XP  — repeatable weekly/monthly/seasonal quests, all
--                  reachable at ~4 matches a week.
--
-- Balance target (modeled over a simulated year, 20-person league): a
-- player who plays ~4 matches/week and completes every quest and a
-- player who plays ~15 matches/week and ignores quests both land at
-- about 9,000-9,500 XP/year (~180/week); a 25/week grinder tops out
-- ~10% higher; a casual 2/week, 60%-attendance player earns about a
-- third of that. Level 10 (9,000 XP) is therefore ~1 year for a regular.
--
-- Also: Fresh Face is now "an opponent you haven't played in the last
-- 30 days" instead of "never played", so it can't be exhausted.
--
-- Manual step after running: none. Frontend files: src/lib/xp.ts,
-- src/stores/progress.ts, src/views/ProgressView.vue.

-- ═══════════════════════════════════════════════════════════════════
-- player_weekly_play_xp — what Play XP has been awarded per player per
-- week. Only ever written by sync_quest_progress().
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.player_weekly_play_xp (
  id              uuid default uuid_generate_v4() primary key,
  league_id       uuid not null references public.leagues(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  week_start      timestamptz not null,
  matches_counted integer not null default 0,
  xp_awarded      integer not null default 0,
  unique (league_id, profile_id, week_start)
);

alter table public.player_weekly_play_xp enable row level security;
drop policy if exists "Play XP is public" on public.player_weekly_play_xp;
create policy "Play XP is public" on public.player_weekly_play_xp for select using (true);
-- No insert/update policy — SECURITY DEFINER sync function only.

create index if not exists idx_pwpx_league_profile on public.player_weekly_play_xp(league_id, profile_id);

-- ═══════════════════════════════════════════════════════════════════
-- Retune the quest catalog (keys unchanged so existing progress rows
-- stay attached). weekly_double_header becomes "Hat Trick" (3 matches).
-- ═══════════════════════════════════════════════════════════════════

update public.quest_templates set xp_reward = 15 where key = 'weekly_show_up';
update public.quest_templates set title = 'Hat Trick', description = 'Play 3 matches this week', target_count = 3, xp_reward = 30
 where key = 'weekly_double_header';
update public.quest_templates
   set description = 'Play someone you haven''t played in the last 30 days',
       criteria_type = 'play_lapsed_opponent', xp_reward = 40
 where key = 'weekly_fresh_face';
update public.quest_templates set xp_reward = 80 where key = 'monthly_regular';
update public.quest_templates set xp_reward = 40 where key = 'monthly_social';
update public.quest_templates set xp_reward = 30 where key = 'monthly_mixer';
update public.quest_templates set xp_reward = 100 where key = 'seasonal_veteran';
update public.quest_templates set xp_reward = 30 where key = 'seasonal_bounce_back';

-- Re-value quests already completed under the old numbers, then rebuild
-- every player's XP from scratch = quest XP now. The Play XP table is
-- cleared so the first sync credits ALL past weeks fresh; that also makes
-- re-running this migration safe.
update public.player_quest_progress p
   set xp_awarded = q.xp_reward
  from public.quest_templates q
 where q.id = p.quest_template_id and p.completed_at is not null;

delete from public.player_weekly_play_xp;

update public.players pl
   set xp = coalesce((select sum(xp_awarded) from public.player_quest_progress p
                       where p.league_id = pl.league_id and p.profile_id = pl.profile_id), 0)
 where true;

-- ═══════════════════════════════════════════════════════════════════
-- sync_quest_progress(league_id) — now also awards Play XP (see the
-- "Play XP stream" block). Quest logic is unchanged except the Fresh
-- Face criteria. Idempotent and safe to call repeatedly.
--
-- Known limitation (carried over from v0.0.5.0): weekly/monthly QUEST
-- progress is only evaluated for the current period, so a quest earned
-- in a week nobody opened /progress is not back-filled. Play XP is
-- back-filled; quests are not.
-- ═══════════════════════════════════════════════════════════════════

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
  v_wk           record;
  v_target       int;
  v_prev         int;
begin
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
      select coalesce(m.wk, e.week_start) as wk, coalesce(m.n, 0) as n
        from (
          select wk, count(*)::int as n from (
            select date_trunc('week', completed_at) as wk from matches
             where league_id = p_league_id and status = 'completed' and completed_at is not null
               and (challenger_id = v_player.profile_id or opponent_id = v_player.profile_id)
            union all
            select date_trunc('week', tm.completed_at) from tournament_matches tm
              join tournament_weeks tw on tw.id = tm.week_id
              join tournaments t on t.id = tw.tournament_id
             where t.league_id = p_league_id and tm.status = 'completed' and tm.completed_at is not null
               and v_player.profile_id in (tm.player_a_id, tm.player_b_id, tm.player_a2_id, tm.player_b2_id)
          ) allm group by wk
        ) m
        full join (
          select week_start from player_weekly_play_xp
           where league_id = p_league_id and profile_id = v_player.profile_id
        ) e on e.week_start = m.wk
    loop
      v_target := c_play_xp * least(v_wk.n, c_play_cap) + c_trickle_xp * greatest(v_wk.n - c_play_cap, 0);

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
