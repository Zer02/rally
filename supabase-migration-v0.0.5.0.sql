-- supabase-migration-v0.0.5.0.sql
-- Run in Supabase SQL Editor after confirming v0.0.4.9 is applied.
--
-- The "battle pass" system: players earn XP by completing quests, most of
-- which reward showing up and variety rather than winning — the whole
-- point is a player on a losing streak should still feel real progress.
-- XP/level is per-league (matches how rating already works), not
-- account-wide.
--
-- Levels/titles are NOT a table here — same pattern as rating's TIERS
-- constant in src/lib/rating.ts, a small hardcoded client-side list
-- (src/lib/xp.ts) is simpler than a DB round-trip for static reference
-- data. Only what genuinely needs server-side computation from match
-- history lives in the database: the quest catalog and each player's
-- progress against it.

-- ═══════════════════════════════════════════════════════════════════
-- players.xp
-- ═══════════════════════════════════════════════════════════════════

alter table public.players add column if not exists xp integer not null default 0;

-- Same trust model as rating/rr_rating on this table already — no
-- column-level lockdown here either (would need a trigger or column-
-- level GRANT/REVOKE), consistent with the existing "Users update own
-- player" policy already allowing a player to touch any column on their
-- own row. xp is only ever meant to move via sync_quest_progress()
-- below, not a new class of risk this migration introduces.

-- ═══════════════════════════════════════════════════════════════════
-- quest_templates — the fixed v1 catalog. No admin editor in v1; this
-- is still a real table (not hardcoded in the sync function) so a
-- future admin-editable version doesn't need a schema rewrite, just a
-- new UI and RLS policy.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.quest_templates (
  id            uuid default uuid_generate_v4() primary key,
  key           text unique not null,
  cadence       text not null check (cadence in ('weekly', 'monthly', 'seasonal')),
  title         text not null,
  description   text not null,
  criteria_type text not null,
  target_count  integer not null,
  xp_reward     integer not null,
  active        boolean not null default true
);

alter table public.quest_templates enable row level security;
drop policy if exists "Quest templates are public" on public.quest_templates;
create policy "Quest templates are public" on public.quest_templates for select using (true);
-- No insert/update/delete policy — fixed catalog, seeded below only.

insert into public.quest_templates (key, cadence, title, description, criteria_type, target_count, xp_reward)
values
  ('weekly_show_up',      'weekly',   'Show Up',           'Play 1 match this week',                              'play_matches',       1, 25),
  ('weekly_double_header', 'weekly',  'Double Header',      'Play 2 matches this week',                            'play_matches',       2, 40),
  ('weekly_fresh_face',   'weekly',   'Fresh Face',         'Play someone you''ve never played before',            'play_new_opponent',  1, 50),
  ('monthly_regular',     'monthly',  'Regular',            'Play in 3 different weeks this month',                'play_weeks',         3, 100),
  ('monthly_social',      'monthly',  'Social Butterfly',   'Play 3 different opponents this month',               'distinct_opponents', 3, 75),
  ('monthly_mixer',       'monthly',  'Mix It Up',          'Play at least 1 doubles match this month',            'play_doubles',       1, 60),
  ('seasonal_veteran',    'seasonal', 'Season Veteran',     'Play in 5 round robin weeks this season',             'rr_distinct_weeks',  5, 150),
  ('seasonal_bounce_back','seasonal', 'Bounce Back',        'Play again after a loss',                             'play_after_loss',    1, 50)
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- player_quest_progress — one row per player per quest per period
-- instance. Only ever written by sync_quest_progress() below.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.player_quest_progress (
  id                uuid default uuid_generate_v4() primary key,
  league_id         uuid not null references public.leagues(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  quest_template_id uuid not null references public.quest_templates(id) on delete cascade,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  progress_count    integer not null default 0,
  completed_at      timestamptz,
  xp_awarded        integer not null default 0,
  unique (league_id, profile_id, quest_template_id, period_start)
);

alter table public.player_quest_progress enable row level security;
drop policy if exists "Quest progress is public" on public.player_quest_progress;
create policy "Quest progress is public" on public.player_quest_progress for select using (true);
-- No insert/update policy — sync_quest_progress() is SECURITY DEFINER
-- and bypasses RLS; nothing else should ever write here.

create index if not exists idx_pqp_league_profile on public.player_quest_progress(league_id, profile_id);

-- ═══════════════════════════════════════════════════════════════════
-- sync_quest_progress(league_id) — recomputes every active player's
-- progress on every active quest for the league, from actual match
-- history (both ladder `matches` and round-robin `tournament_matches`),
-- and awards XP the first time a quest crosses its target. Idempotent
-- and safe to call repeatedly — completed_at guards against a double
-- award, and progress_count is simply recomputed each call rather than
-- incremented, so a disputed/uncompleted match dropping back out of
-- "completed" status is reflected correctly too.
--
-- Deliberately a per-league bulk sync (loops every player) rather than
-- per-player — trivial cost at this app's scale (a few dozen players,
-- 8 quests), and far simpler to call from one place (ProgressView on
-- mount) than threading a sync call through every match-report path in
-- the app.
--
-- Known simplification: play_after_loss only looks at ladder `matches`,
-- not round-robin tournament_matches — kept bounded rather than fully
-- generalizing every criteria type across both match systems, similar
-- in spirit to generate_court_matches() deliberately not checking
-- season rematches.
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
begin
  select id, created_at, coalesce(completed_at, 'infinity'::timestamptz)
    into v_season_id, v_season_start, v_season_end
    from tournaments
   where league_id = p_league_id and status <> 'completed'
   order by created_at desc
   limit 1;

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

      elsif v_quest.criteria_type = 'play_new_opponent' then
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
                 and m2.completed_at < v_period_start
                 and ((m2.challenger_id = v_player.profile_id and m2.opponent_id = this_period.opp)
                   or (m2.opponent_id = v_player.profile_id and m2.challenger_id = this_period.opp))
              union all
              select 1 from tournament_matches tm2
                join tournament_weeks tw2 on tw2.id = tm2.week_id
                join tournaments t2 on t2.id = tw2.tournament_id
               where t2.league_id = p_league_id and tm2.status = 'completed'
                 and tm2.completed_at < v_period_start
                 and v_player.profile_id in (tm2.player_a_id, tm2.player_b_id, tm2.player_a2_id, tm2.player_b2_id)
                 and this_period.opp in (tm2.player_a_id, tm2.player_b_id, tm2.player_a2_id, tm2.player_b2_id)
            )
        ) new_opponents;

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
