-- supabase-migration-v0.0.3.0.sql
-- Run in Supabase SQL Editor. This is the foundation for multi-sport
-- support — everything after this version (league switcher UI, per-league
-- stores, round robin) builds on top of what's created here.
--
-- Design decisions locked in for this migration:
--   - Leagues are OPT-IN: joining a specific league is an explicit action,
--     not automatic on signup. No more auto-create-players-row trigger.
--   - Admin is PER-LEAGUE via a new league_admins table. profiles.is_admin
--     is kept as a global super-admin flag (useful for you as app owner —
--     bootstrapping, managing leagues generally). A single helper function
--     is_league_admin(league_id) checks "super-admin OR admin of this
--     specific league" and replaces every is_admin check in existing RPCs.
--   - Any authenticated user may create a new league and becomes its first
--     admin + first member automatically (someone has to manage it before
--     anyone else can join). Easy to restrict to super-admins only later
--     if you'd rather gate league creation — just add an is_admin check
--     at the top of create_league() below.
--
-- BEFORE RUNNING: this SQL was drafted but never executed or tested
-- against your actual schema. Run this check first and eyeball the
-- result — it tells you exactly what's currently enforcing uniqueness
-- on players.profile_id, which section 3 below needs to remove cleanly:
--
--   select conname, contype, pg_get_constraintdef(oid)
--   from pg_constraint where conrelid = 'public.players'::regclass;
--
--   select indexname, indexdef
--   from pg_indexes where schemaname = 'public' and tablename = 'players';
--
-- If the unique-on-profile_id enforcement turns out to be a plain
-- `create unique index` rather than a table constraint (contype 'u'),
-- the original drop logic in section 3 would silently miss it, leaving
-- a second, older unique index around — which would then block a
-- player from ever joining a second league even after the new
-- (profile_id, league_id) constraint is added. Section 3 below drops
-- both forms defensively.

-- ═══════════════════════════════════════════════════════════════════
-- 1. New tables
-- ═══════════════════════════════════════════════════════════════════

create table public.leagues (
  id         uuid default uuid_generate_v4() primary key,
  name       text not null,               -- "Table Tennis"
  sport      text not null,               -- "table_tennis" — slug, used as a stable key
  icon       text not null default '🏆',  -- emoji shown in the switcher
  created_at timestamptz default now()
);

alter table public.leagues enable row level security;
create policy "Leagues are public" on leagues for select using (true);
-- No insert/update/delete policy on purpose — all writes go through
-- create_league() (SECURITY DEFINER, bypasses RLS), never directly.

create table public.league_admins (
  league_id  uuid references public.leagues(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (league_id, profile_id)
);

alter table public.league_admins enable row level security;
create policy "League admins are public" on league_admins for select using (true);
-- Same as leagues — no direct insert/update/delete; managed via
-- create_league() or manually by you in the dashboard for now.


-- ═══════════════════════════════════════════════════════════════════
-- 2. Admin helper — replaces every raw is_admin check from here on
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.is_league_admin(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
      or exists (
        select 1 from league_admins
        where league_id = p_league_id and profile_id = auth.uid()
      );
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. Seed the existing app as its own league, so nothing existing breaks
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  v_default_league_id uuid;
begin
  insert into leagues (name, sport, icon)
  values ('Table Tennis', 'table_tennis', '🏓')
  returning id into v_default_league_id;

  -- Every current admin becomes an admin of this league specifically too,
  -- so nothing regresses for existing admins even once is_admin usage
  -- narrows to specific league checks elsewhere later.
  insert into league_admins (league_id, profile_id)
  select v_default_league_id, id from profiles where is_admin = true;

  -- ── players: add league_id, backfill, re-scope the unique constraint ──
  alter table public.players add column league_id uuid references public.leagues(id) on delete cascade;
  -- `where league_id is null` is required, not just cosmetic: Supabase
  -- rejects any bare UPDATE with no WHERE clause at all (protective
  -- extension, fires even inside this SECURITY DEFINER block) with
  -- "UPDATE requires a WHERE clause" (code 21000). Since league_id was
  -- just added as a nullable column above, every row qualifies anyway.
  update public.players set league_id = v_default_league_id where league_id is null;
  alter table public.players alter column league_id set not null;

  -- Drop whatever is currently enforcing uniqueness on profile_id alone.
  -- Covers BOTH forms defensively: a table constraint (contype 'u', the
  -- normal case for `unique(profile_id)`) and, just in case, a bare
  -- `create unique index` that never went through ADD CONSTRAINT and so
  -- wouldn't show up in pg_constraint at all. Skipping either form
  -- would leave old single-column uniqueness in place and silently
  -- block a player from ever joining a second league.
  execute coalesce((
    select string_agg(format('alter table public.players drop constraint %I;', conname), ' ')
    from pg_constraint
    where conrelid = 'public.players'::regclass and contype = 'u'
  ), 'select 1;');

  execute coalesce((
    select string_agg(format('drop index if exists public.%I;', indexname), ' ')
    from pg_indexes
    where schemaname = 'public' and tablename = 'players'
      and indexdef ilike '%unique%' and indexname not ilike '%pkey%'
  ), 'select 1;');

  alter table public.players
    add constraint players_profile_league_unique unique (profile_id, league_id);

  -- ── matches: add league_id, backfill ──
  alter table public.matches add column league_id uuid references public.leagues(id) on delete cascade;
  update public.matches set league_id = v_default_league_id where league_id is null;
  alter table public.matches alter column league_id set not null;

  -- ── elo_history: add league_id, backfill ──
  alter table public.elo_history add column league_id uuid references public.leagues(id) on delete cascade;
  update public.elo_history set league_id = v_default_league_id where league_id is null;
  alter table public.elo_history alter column league_id set not null;
end $$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. Retire the old auto-create-on-signup trigger — joining a league is
--    now an explicit action, not automatic
-- ═══════════════════════════════════════════════════════════════════

drop trigger if exists on_profile_created on public.profiles;
drop function if exists public.handle_new_profile();


-- ═══════════════════════════════════════════════════════════════════
-- 5. players: allow a user to insert their OWN row to join a league
-- ═══════════════════════════════════════════════════════════════════

create policy "Users join a league" on players for insert with check (auth.uid() = profile_id);


-- ═══════════════════════════════════════════════════════════════════
-- 6. matches: insert policy now checks per-league admin instead of global
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "Players create challenges" on matches;
create policy "Players create challenges" on matches for insert with check (
  auth.uid() = challenger_id
  or public.is_league_admin(league_id)
);


-- ═══════════════════════════════════════════════════════════════════
-- 7. create_league RPC — creates the league, makes the caller its first
--    admin AND first member, atomically
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

  return v_league_id;
end;
$$;

grant execute on function public.create_league(text, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 8. finalize_match: now league-aware. Looks up the match's own league_id
--    rather than trusting a client-supplied value, uses is_league_admin()
--    instead of a raw is_admin check, and scopes both player updates by
--    league_id (critical — a player can now have MULTIPLE rows, one per
--    league they've joined, so "where profile_id = X" alone could touch
--    the wrong row).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.finalize_match(
  p_match_id           uuid,
  p_winner_id          uuid,
  p_loser_id           uuid,
  p_winner_rating      numeric,
  p_winner_uncertainty numeric,
  p_winner_streak      int,
  p_loser_rating       numeric,
  p_loser_uncertainty  numeric,
  p_loser_streak       int,
  p_quality            numeric,
  p_challenger_delta   int,
  p_opponent_delta     int,
  p_challenger_score   text,
  p_opponent_score     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id from matches where id = p_match_id;
  if v_league_id is null then
    raise exception 'Match not found';
  end if;

  if auth.uid() is null
     or (auth.uid() <> p_winner_id
         and auth.uid() <> p_loser_id
         and not public.is_league_admin(v_league_id)) then
    raise exception 'Not authorized to finalize this match';
  end if;

  if not exists (
    select 1 from matches
    where id = p_match_id
      and status <> 'completed'
      and ((challenger_id = p_winner_id and opponent_id = p_loser_id)
        or (challenger_id = p_loser_id  and opponent_id = p_winner_id))
  ) then
    raise exception 'Match not found, already completed, or players do not match';
  end if;

  perform set_config('rally.internal_write', 'true', true);

  update matches
  set winner_id        = p_winner_id,
      challenger_score = p_challenger_score,
      opponent_score   = p_opponent_score,
      status           = 'completed',
      quality          = p_quality,
      challenger_delta = p_challenger_delta,
      opponent_delta   = p_opponent_delta,
      completed_at     = now()
  where id = p_match_id;

  update players
  set rating       = p_winner_rating,
      uncertainty  = p_winner_uncertainty,
      streak       = p_winner_streak,
      season_wins  = season_wins + 1,
      career_wins  = career_wins + 1,
      last_played  = now()
  where profile_id = p_winner_id and league_id = v_league_id;

  update players
  set rating        = p_loser_rating,
      uncertainty   = p_loser_uncertainty,
      streak        = p_loser_streak,
      season_losses = season_losses + 1,
      career_losses = career_losses + 1,
      last_played   = now()
  where profile_id = p_loser_id and league_id = v_league_id;

  insert into elo_history (profile_id, rating, match_id, league_id)
  values
    (p_winner_id, p_winner_rating, p_match_id, v_league_id),
    (p_loser_id,  p_loser_rating,  p_match_id, v_league_id);
end;
$$;

grant execute on function public.finalize_match(
  uuid, uuid, uuid, numeric, numeric, int, numeric, numeric, int,
  numeric, int, int, text, text
) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 9. reset_season: now takes a league_id and checks is_league_admin
--    instead of a global is_admin check. Signature changed, so the old
--    zero-arg version is dropped explicitly.
-- ═══════════════════════════════════════════════════════════════════

drop function if exists public.reset_season();

create or replace function public.reset_season(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only admins of this league can reset its season';
  end if;

  update players
  set season_wins = 0, season_losses = 0
  where league_id = p_league_id;
end;
$$;

grant execute on function public.reset_season(uuid) to authenticated;
