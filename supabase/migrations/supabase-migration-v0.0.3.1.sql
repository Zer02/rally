-- supabase-migration-v0.0.3.1.sql
-- Run in Supabase → SQL Editor, after v0.0.3.0.
--
-- v0.0.3.0 threaded league_id through players/matches/elo_history, but
-- left `seasons` and `season_records` (from v0.0.2.10) untouched — they
-- were still global. It also dropped the v0.0.2.10 reset_season() (which
-- archived standings before zeroing them) and replaced it with a
-- league-scoped version that went back to just zeroing, with no
-- archiving at all. This migration fixes both: seasons become per-league,
-- and reset_season() does archiving AND per-league scoping together.
--
-- Self-contained: this creates `seasons`/`season_records` from scratch if
-- v0.0.2.10 was never actually run (as opposed to assuming they already
-- exist and only ALTERing them), so it works whether or not that one
-- happened first.

-- ═══════════════════════════════════════════════════════════════════
-- 1. seasons / season_records: create if they don't exist yet (in case
--    v0.0.2.10 was never actually run — this migration no longer
--    depends on it), add league_id if missing, backfill to the seeded
--    Table Tennis league (the only league that can have existing season
--    history, since nothing else existed before now)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.seasons (
  id            uuid default uuid_generate_v4() primary key,
  season_number serial,
  started_at    timestamptz default now(),
  ended_at      timestamptz
);

alter table public.seasons add column if not exists league_id uuid references public.leagues(id) on delete cascade;
alter table public.seasons enable row level security;
drop policy if exists "Seasons are public" on public.seasons;
create policy "Seasons are public" on public.seasons for select using (true);
-- No insert/update/delete policy — only reset_season()/create_league()
-- (both SECURITY DEFINER) write here.

create table if not exists public.season_records (
  id         uuid default uuid_generate_v4() primary key,
  season_id  uuid references public.seasons(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  wins       int not null default 0,
  losses     int not null default 0,
  created_at timestamptz default now(),
  unique (season_id, profile_id)
);

alter table public.season_records add column if not exists league_id uuid references public.leagues(id) on delete cascade;
alter table public.season_records enable row level security;
drop policy if exists "Season records are public" on public.season_records;
create policy "Season records are public" on public.season_records for select using (true);

do $$
declare
  v_default_league_id uuid;
begin
  select id into v_default_league_id from leagues where sport = 'table_tennis' limit 1;
  if v_default_league_id is null then
    raise exception 'Table Tennis league not found — has supabase-migration-v0.0.3.0.sql been run yet?';
  end if;

  -- Backfills existing rows if v0.0.2.10 was run previously; does nothing
  -- (0 rows) if the tables were just created fresh above.
  update public.seasons set league_id = v_default_league_id where league_id is null;
  alter table public.seasons alter column league_id set not null;

  update public.season_records set league_id = v_default_league_id where league_id is null;
  alter table public.season_records alter column league_id set not null;

  -- Table Tennis needs an open season to point at as "Current season".
  -- Either it already has one (backfilled above) or the tables were just
  -- created fresh and it needs its first one.
  if not exists (select 1 from seasons where league_id = v_default_league_id) then
    insert into seasons (league_id) values (v_default_league_id);
  end if;
end $$;

create index if not exists idx_seasons_league_id on public.seasons(league_id);
create index if not exists idx_season_records_league_id on public.season_records(league_id);

-- Helps performance now that players/matches/elo_history are queried by
-- league_id on every page load.
create index if not exists idx_players_league_id     on public.players(league_id);
create index if not exists idx_matches_league_id      on public.matches(league_id);
create index if not exists idx_elo_history_league_id  on public.elo_history(league_id);


-- ═══════════════════════════════════════════════════════════════════
-- 2. reset_season(p_league_id): archive + close out + reopen, scoped to
--    one league. Replaces both the v0.0.2.10 version (global, no league
--    concept existed yet) and the v0.0.3.0 version (per-league, but lost
--    the archiving step).
-- ═══════════════════════════════════════════════════════════════════

drop function if exists public.reset_season(uuid);
drop function if exists public.reset_season();

create or replace function public.reset_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_season_id uuid;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only admins of this league can reset its season';
  end if;

  select id into v_active_season_id
  from seasons
  where league_id = p_league_id and ended_at is null
  order by started_at desc limit 1;

  -- Safety net — every league should already have an open season row
  -- (seeded by this migration for Table Tennis, and by create_league()
  -- for any league created after it), but don't fail the reset if one
  -- is somehow missing.
  if v_active_season_id is null then
    insert into seasons (league_id) values (p_league_id) returning id into v_active_season_id;
  end if;

  insert into season_records (season_id, league_id, profile_id, wins, losses)
  select v_active_season_id, p_league_id, profile_id, season_wins, season_losses
  from players
  where league_id = p_league_id
  on conflict (season_id, profile_id) do update
    set wins = excluded.wins, losses = excluded.losses
    where true;

  update seasons set ended_at = now() where id = v_active_season_id;
  insert into seasons (league_id) values (p_league_id);

  update players
  set season_wins = 0, season_losses = 0
  where league_id = p_league_id;
end;
$$;

grant execute on function public.reset_season(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 3. create_league(): also open that league's first season, so a brand
--    new league has something for "Current season" to point at
--    immediately instead of only after the first reset.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.create_league(p_name text, p_sport text, p_icon text default '🏆')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to create a league';
  end if;

  insert into leagues (name, sport, icon)
  values (p_name, p_sport, coalesce(p_icon, '🏆'))
  returning id into v_league_id;

  insert into league_admins (league_id, profile_id) values (v_league_id, auth.uid());
  insert into players (profile_id, league_id) values (auth.uid(), v_league_id);
  insert into seasons (league_id) values (v_league_id);

  return v_league_id;
end;
$$;

grant execute on function public.create_league(text, text, text) to authenticated;
