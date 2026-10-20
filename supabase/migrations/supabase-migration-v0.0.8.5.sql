-- =====================================================================
-- v0.0.8.5 - Tournaments: an admin-run knockout bracket, seeded from the rankings
--
-- WHY
--   Clubs want a one-off knockout event (the shape of a pro draw: seeds, byes,
--   a champion) that sits beside the weekly round robin without disturbing it.
--
-- WHAT THIS ADDS
--   Three new tables, deliberately separate from `tournaments`. A `tournaments`
--   row is a round robin SEASON: creating one restarts the battle pass and the
--   seasonal quests (pass_window_start reads it), so a knockout must never be one.
--     bracket_events    one knockout event (name, seeding basis, size, champion)
--     bracket_entrants  who entered, and the seed they were given (stored at generation)
--     bracket_matches   one row per match slot, every round
--   All three are readable by everyone and writable by nobody directly: the
--   app cannot insert, update or delete in them. Only the functions below write.
--
-- RULES
--   * Single elimination, 2 to 64 entrants, standard seeding (1 plays the lowest,
--     and the seeds are placed so 1 and 2 can only meet in the final). The bracket
--     is the next power of two; the top seeds get byes. 11 players make 16 slots,
--     and seeds 1 to 5 get byes.
--   * Seeding "ladder" ranks by the ladder rating (players.rating). Seeding
--     "round_robin" ranks by rr_rating from the newest round robin season the
--     player took part in; players with no round robin history rank after everyone
--     who has some, ordered by ladder rating. A tie breaks on the other rating,
--     then on profile id, so a draw is always the same for the same inputs.
--   * Scores follow the round robin rule (rr_score_is_legal): first to 4, or a
--     full set to 6, no ties.
--   * Only a league admin enters results. A result can be corrected until the
--     match it fed has been played.
--   * Tournament matches stand alone. They write nothing to players, matches,
--     elo_history, tournament_matches, XP, the pass or the quests.
--
-- FUNCTIONS
--   internal (nobody can call them from the app):
--     bracket_seed_order(size)           the standard seed layout for a bracket size
--     bracket_seed_players(...)          who gets which seed
--     bracket_place_winner(match_id)     move a winner into the next round (or crown them)
--   admin (league admins only, checked inside):
--     preview_bracket_seeds(...)         the draw, without saving anything
--     create_bracket_event(...)          generate and save a bracket
--     report_bracket_match(...)          enter or correct a result
--     delete_bracket_event(...)          remove an event
--
-- Requires v0.0.8.4. Idempotent: safe to run twice.
-- =====================================================================

-- Prerequisites. These test behaviour, not just existence: rr_score_is_legal has
-- existed since v0.0.6.3, so "it exists" proves nothing about the score rule.
do $$
begin
  if to_regprocedure('public.rr_score_is_legal(integer,integer)') is null
     or not coalesce(public.rr_score_is_legal(4, 3), false)
     or not coalesce(public.rr_score_is_legal(6, 5), false)
     or coalesce(public.rr_score_is_legal(4, 4), true)
     or coalesce(public.rr_score_is_legal(7, 5), true) then
    raise exception 'Run supabase-migration-v0.0.7.2.sql first (the score rule: first to 4, or a full set to 6, is not in place).';
  end if;
  if to_regprocedure('public.is_league_admin(uuid)') is null then
    raise exception 'Run supabase-migration-v0.0.3.0.sql first (it creates is_league_admin).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tournament_participants' and column_name = 'rr_rating') then
    raise exception 'Run supabase-migration-v0.0.3.7.sql first (it adds rr_rating).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'players' and column_name = 'pass_xp') then
    raise exception 'Run supabase-migration-v0.0.8.4.sql first (this release follows it).';
  end if;
end $$;

-- 1. Tables ------------------------------------------------------------
create table if not exists public.bracket_events (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  seeding       text not null check (seeding in ('ladder', 'round_robin')),
  bracket_size  int  not null check (bracket_size in (2, 4, 8, 16, 32, 64)),
  status        text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  champion_id   uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table if not exists public.bracket_entrants (
  event_id    uuid not null references public.bracket_events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  seed        int  not null check (seed >= 1),
  primary key (event_id, profile_id),
  unique (event_id, seed)
);

create table if not exists public.bracket_matches (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.bracket_events(id) on delete cascade,
  round        int  not null check (round >= 1),
  slot         int  not null check (slot >= 1),
  player_a_id  uuid references public.profiles(id) on delete set null,
  player_b_id  uuid references public.profiles(id) on delete set null,
  score_a      int,
  score_b      int,
  winner_id    uuid references public.profiles(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'completed', 'bye')),
  completed_at timestamptz,
  unique (event_id, round, slot)
);

create index if not exists idx_bracket_events_league   on public.bracket_events(league_id);
create index if not exists idx_bracket_entrants_event  on public.bracket_entrants(event_id);
create index if not exists idx_bracket_matches_event   on public.bracket_matches(event_id);

alter table public.bracket_events   enable row level security;
alter table public.bracket_entrants enable row level security;
alter table public.bracket_matches  enable row level security;

drop policy if exists "Bracket events are public"   on public.bracket_events;
drop policy if exists "Bracket entrants are public" on public.bracket_entrants;
drop policy if exists "Bracket matches are public"  on public.bracket_matches;
create policy "Bracket events are public"   on public.bracket_events   for select using (true);
create policy "Bracket entrants are public" on public.bracket_entrants for select using (true);
create policy "Bracket matches are public"  on public.bracket_matches  for select using (true);

-- Read-only to the app: no policy allows a write, and the privileges are taken away
-- as a second lock (the same belt and braces as v0.0.8.0).
revoke insert, update, delete, truncate on public.bracket_events   from anon, authenticated;
revoke insert, update, delete, truncate on public.bracket_entrants from anon, authenticated;
revoke insert, update, delete, truncate on public.bracket_matches  from anon, authenticated;

-- 2. Internal helpers --------------------------------------------------
-- The standard seed layout for a bracket of p_size (2, 4, 8, ... 64): the seed in
-- each position, read in pairs (positions 1+2 meet in round 1, and so on).
-- 8 -> {1,8,4,5,2,7,3,6}: seed 1 plays 8, and 1 and 2 are on opposite halves.
create or replace function public.bracket_seed_order(p_size int)
returns int[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v int[] := array[1];
  w int[];
  n int := 1;
  i int;
begin
  if p_size not in (2, 4, 8, 16, 32, 64) then
    raise exception 'A bracket has 2, 4, 8, 16, 32 or 64 slots, not %.', p_size;
  end if;
  while n < p_size loop
    w := '{}';
    for i in 1..n loop
      w := w || v[i] || (2 * n + 1 - v[i]);
    end loop;
    v := w;
    n := n * 2;
  end loop;
  return v;
end;
$$;

-- Who gets which seed. `rating` is the number the seeding was based on (null for a
-- round robin draw when the player has no round robin history).
create or replace function public.bracket_seed_players(p_league_id uuid, p_seeding text, p_profile_ids uuid[])
returns table (profile_id uuid, seed int, rating numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_wanted int := (select count(distinct x) from unnest(p_profile_ids) x);
  v_found  int;
begin
  if p_seeding not in ('ladder', 'round_robin') then
    raise exception 'Seeding must be ladder or round_robin.';
  end if;

  select count(*) into v_found
    from players p
   where p.league_id = p_league_id and p.profile_id = any(p_profile_ids);
  if v_found <> v_wanted then
    raise exception 'Every entrant must be a member of this league.';
  end if;

  return query
  with cand as (
    select p.profile_id as pid,
           coalesce(p.rating, 1000)::numeric as ladder,
           (select tp.rr_rating
              from tournament_participants tp
              join tournaments t on t.id = tp.tournament_id
             where t.league_id = p_league_id and tp.profile_id = p.profile_id
             order by t.created_at desc, t.id desc
             limit 1)::numeric as rr
      from players p
     where p.league_id = p_league_id and p.profile_id = any(p_profile_ids)
  ),
  ranked as (
    select c.pid, c.ladder, c.rr,
           row_number() over (
             order by
               case when p_seeding = 'round_robin' then (c.rr is not null) else true end desc,
               case when p_seeding = 'round_robin' then c.rr else c.ladder end desc nulls last,
               case when p_seeding = 'round_robin' then c.ladder else c.rr end desc nulls last,
               c.pid
           )::int as sd
      from cand c
  )
  select r.pid, r.sd, case when p_seeding = 'round_robin' then r.rr else r.ladder end
    from ranked r
   order by r.sd;
end;
$$;

-- Move a finished match's winner into the next round (or crown them after the final).
-- Safe to call again after a correction: it overwrites the slot the winner fills.
create or replace function public.bracket_place_winner(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m          bracket_matches%rowtype;
  v_rounds   int;
  v_next_slot int;
begin
  select * into m from bracket_matches where id = p_match_id;
  if not found or m.winner_id is null then
    raise exception 'That match has no winner to place.';
  end if;

  select round(log(2, e.bracket_size))::int into v_rounds from bracket_events e where e.id = m.event_id;

  if m.round = v_rounds then
    update bracket_events
       set champion_id = m.winner_id,
           status = 'completed',
           completed_at = coalesce(completed_at, now())
     where id = m.event_id;
  else
    v_next_slot := (m.slot + 1) / 2;
    if m.slot % 2 = 1 then
      update bracket_matches set player_a_id = m.winner_id
       where event_id = m.event_id and round = m.round + 1 and slot = v_next_slot;
    else
      update bracket_matches set player_b_id = m.winner_id
       where event_id = m.event_id and round = m.round + 1 and slot = v_next_slot;
    end if;
  end if;
end;
$$;

-- 3. Admin functions ---------------------------------------------------
-- The draw, without saving anything: seed, player, rating used, bracket size, whether
-- that seed gets a bye.
create or replace function public.preview_bracket_seeds(p_league_id uuid, p_seeding text, p_profile_ids uuid[])
returns table (seed int, profile_id uuid, rating numeric, bracket_size int, has_bye boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n    int := (select count(distinct x) from unnest(p_profile_ids) x);
  v_size int := 2;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only a league admin can set up a tournament.';
  end if;
  if v_n < 2 or v_n > 64 then
    raise exception 'A tournament needs between 2 and 64 players (got %).', v_n;
  end if;
  while v_size < v_n loop v_size := v_size * 2; end loop;

  return query
    select s.seed, s.profile_id, s.rating, v_size, (s.seed <= v_size - v_n)
      from public.bracket_seed_players(p_league_id, p_seeding, p_profile_ids) s
     order by s.seed;
end;
$$;

create or replace function public.create_bracket_event(p_league_id uuid, p_name text, p_seeding text, p_profile_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n       int := (select count(distinct x) from unnest(p_profile_ids) x);
  v_size    int := 2;
  v_rounds  int;
  v_event   uuid := gen_random_uuid();
  v_order   int[];
  v_by_seed uuid[];
  r         record;
  i         int;
  a_seed    int;
  b_seed    int;
  a_id      uuid;
  b_id      uuid;
  m_id      uuid;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only a league admin can set up a tournament.';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Give the tournament a name.';
  end if;
  if p_seeding is null or p_seeding not in ('ladder', 'round_robin') then
    raise exception 'Seeding must be ladder or round_robin.';
  end if;
  if v_n < 2 or v_n > 64 then
    raise exception 'A tournament needs between 2 and 64 players (got %).', v_n;
  end if;
  if cardinality(p_profile_ids) <> v_n then
    raise exception 'Each player can enter only once.';
  end if;
  while v_size < v_n loop v_size := v_size * 2; end loop;
  v_rounds := round(log(2, v_size))::int;

  insert into bracket_events(id, league_id, name, seeding, bracket_size, created_by)
  values (v_event, p_league_id, btrim(p_name), p_seeding, v_size, auth.uid());

  -- Seeds are fixed here and stored; a later rating change does not redraw the bracket.
  v_by_seed := array_fill(null::uuid, array[v_size]);
  for r in select * from public.bracket_seed_players(p_league_id, p_seeding, p_profile_ids) loop
    insert into bracket_entrants(event_id, profile_id, seed) values (v_event, r.profile_id, r.seed);
    v_by_seed[r.seed] := r.profile_id;
  end loop;

  -- Every match slot, all rounds. Round 1 is filled from the seed layout;
  -- later rounds start empty and fill as winners are placed.
  v_order := public.bracket_seed_order(v_size);
  for i in 1..(v_size / 2) loop
    a_seed := v_order[2 * i - 1];
    b_seed := v_order[2 * i];
    a_id := v_by_seed[a_seed];
    b_id := v_by_seed[b_seed];
    m_id := gen_random_uuid();
    if a_id is not null and b_id is not null then
      insert into bracket_matches(id, event_id, round, slot, player_a_id, player_b_id)
      values (m_id, v_event, 1, i, a_id, b_id);
    else
      -- exactly one of the two is a real player (more than half the slots are filled)
      insert into bracket_matches(id, event_id, round, slot, player_a_id, player_b_id, winner_id, status, completed_at)
      values (m_id, v_event, 1, i, a_id, b_id, coalesce(a_id, b_id), 'bye', now());
    end if;
  end loop;
  for i in 2..v_rounds loop
    insert into bracket_matches(event_id, round, slot)
    select v_event, i, s from generate_series(1, v_size / (2 ^ i)::int) s;
  end loop;

  -- Byes advance straight away.
  for r in select id from bracket_matches where event_id = v_event and status = 'bye' loop
    perform public.bracket_place_winner(r.id);
  end loop;

  return v_event;
end;
$$;

create or replace function public.report_bracket_match(p_match_id uuid, p_score_a int, p_score_b int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m        bracket_matches%rowtype;
  e        bracket_events%rowtype;
  v_next   bracket_matches%rowtype;
  v_rounds int;
  v_winner uuid;
begin
  select * into m from bracket_matches where id = p_match_id for update;
  if not found then
    raise exception 'That match does not exist.';
  end if;
  select * into e from bracket_events where id = m.event_id;

  if not public.is_league_admin(e.league_id) then
    raise exception 'Only a league admin can enter tournament results.';
  end if;
  if m.status = 'bye' then
    raise exception 'That slot is a bye: there is nothing to score.';
  end if;
  if m.player_a_id is null or m.player_b_id is null then
    raise exception 'Both players are not known yet: the earlier round has to be played first.';
  end if;
  if p_score_a is null or p_score_b is null or not public.rr_score_is_legal(p_score_a, p_score_b) then
    raise exception 'That is not a finished score: first to 4 games (4-0 to 4-3), or a full set to 6 (6-0 to 6-5).';
  end if;

  -- A result can be corrected only while the match it fed has not been played.
  v_rounds := round(log(2, e.bracket_size))::int;
  if m.status = 'completed' and m.round < v_rounds then
    select * into v_next from bracket_matches
     where event_id = m.event_id and round = m.round + 1 and slot = (m.slot + 1) / 2;
    if v_next.status = 'completed' then
      raise exception 'That result cannot be changed: the winner has already played the next round.';
    end if;
  end if;

  v_winner := case when p_score_a > p_score_b then m.player_a_id else m.player_b_id end;

  update bracket_matches
     set score_a = p_score_a, score_b = p_score_b, winner_id = v_winner,
         status = 'completed', completed_at = now()
   where id = m.id;

  perform public.bracket_place_winner(m.id);
end;
$$;

create or replace function public.delete_bracket_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
begin
  select league_id into v_league from bracket_events where id = p_event_id;
  if v_league is null then
    raise exception 'That tournament does not exist.';
  end if;
  if not public.is_league_admin(v_league) then
    raise exception 'Only a league admin can delete a tournament.';
  end if;
  delete from bracket_events where id = p_event_id;   -- entrants and matches go with it
end;
$$;

-- 4. Who may call what -------------------------------------------------
-- Functions are executable by PUBLIC unless that is taken away, so do it explicitly.
revoke execute on function public.bracket_seed_order(int)                          from public, anon, authenticated;
revoke execute on function public.bracket_seed_players(uuid, text, uuid[])         from public, anon, authenticated;
revoke execute on function public.bracket_place_winner(uuid)                       from public, anon, authenticated;

revoke execute on function public.preview_bracket_seeds(uuid, text, uuid[])        from public, anon;
revoke execute on function public.create_bracket_event(uuid, text, text, uuid[])   from public, anon;
revoke execute on function public.report_bracket_match(uuid, int, int)             from public, anon;
revoke execute on function public.delete_bracket_event(uuid)                       from public, anon;
grant  execute on function public.preview_bracket_seeds(uuid, text, uuid[])        to authenticated;
grant  execute on function public.create_bracket_event(uuid, text, text, uuid[])   to authenticated;
grant  execute on function public.report_bracket_match(uuid, int, int)             to authenticated;
grant  execute on function public.delete_bracket_event(uuid)                       to authenticated;

-- Self-check -----------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.bracket_matches', 'insert')
     or has_table_privilege('authenticated', 'public.bracket_matches', 'update')
     or has_table_privilege('authenticated', 'public.bracket_events', 'delete')
     or has_table_privilege('anon', 'public.bracket_entrants', 'insert') then
    raise exception 'the app can still write to a bracket table';
  end if;
  if has_function_privilege('authenticated', 'public.bracket_place_winner(uuid)', 'execute')
     or has_function_privilege('anon', 'public.report_bracket_match(uuid,integer,integer)', 'execute') then
    raise exception 'a bracket function is callable by someone who should not have it';
  end if;
  if public.bracket_seed_order(8) <> array[1,8,4,5,2,7,3,6] then
    raise exception 'the seed layout is wrong';
  end if;
  raise notice 'v0.0.8.5 OK: knockout tournaments are in place (read-only tables, admin-only functions).';
end $$;
