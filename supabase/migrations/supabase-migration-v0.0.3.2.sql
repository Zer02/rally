-- supabase-migration-v0.0.3.2.sql
-- Run in Supabase → SQL Editor, after v0.0.3.1.
--
-- First slice of the round-robin/tournament feature: schema + pairing
-- generation + score reporting. Deliberately does NOT include yet:
--   - computing the strength-of-schedule adjusted_score / final ranking
--     (needs the whole round robin finished first — next version)
--   - bracket generation / advancement (next version, after that)
-- A tournament is scoped to one league and kept fully separate from the
-- regular ladder — it does not touch players.rating, matches, or
-- finalize_match() at all.

create table public.tournaments (
  id           uuid default uuid_generate_v4() primary key,
  league_id    uuid not null references public.leagues(id) on delete cascade,
  name         text not null,
  status       text not null default 'round_robin' check (status in ('round_robin', 'bracket', 'completed')),
  created_at   timestamptz default now(),
  completed_at timestamptz
);

alter table public.tournaments enable row level security;
create policy "Tournaments are public" on public.tournaments for select using (true);
-- No insert/update/delete policy — only create_tournament() (SECURITY
-- DEFINER) writes here for now.

create table public.tournament_participants (
  id             uuid default uuid_generate_v4() primary key,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  wins           int not null default 0,
  losses         int not null default 0,
  points_for     int not null default 0,
  points_against int not null default 0,
  adjusted_score numeric,  -- filled in once the round robin is finalized (next version)
  seed           int,      -- filled in once the bracket is generated (later version)
  unique (tournament_id, profile_id)
);

alter table public.tournament_participants enable row level security;
create policy "Tournament participants are public" on public.tournament_participants for select using (true);

create table public.tournament_matches (
  id            uuid default uuid_generate_v4() primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  phase         text not null default 'round_robin' check (phase in ('round_robin', 'bracket')),
  round         int,  -- null for round robin; 1,2,3... for bracket rounds (later version)
  slot          int,  -- bracket position, used for auto-advancing winners (later version)
  player_a_id   uuid references public.profiles(id) on delete set null,
  player_b_id   uuid references public.profiles(id) on delete set null,
  score_a       int,
  score_b       int,
  winner_id     uuid references public.profiles(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'completed', 'bye')),
  reported_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz default now(),
  completed_at  timestamptz
);

alter table public.tournament_matches enable row level security;
create policy "Tournament matches are public" on public.tournament_matches for select using (true);

create index if not exists idx_tournaments_league_id            on public.tournaments(league_id);
create index if not exists idx_tournament_participants_tourney   on public.tournament_participants(tournament_id);
create index if not exists idx_tournament_matches_tourney        on public.tournament_matches(tournament_id);


-- ═══════════════════════════════════════════════════════════════════
-- create_tournament(): admin-only. Enrolls every current player in the
-- league and generates the full round-robin pairing list — every unique
-- pair of players, once each.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.create_tournament(p_league_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_player_ids    uuid[];
  v_n             int;
  i               int;
  j               int;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only admins of this league can start a tournament';
  end if;

  select array_agg(profile_id) into v_player_ids
  from players where league_id = p_league_id;

  v_n := coalesce(array_length(v_player_ids, 1), 0);
  if v_n < 2 then
    raise exception 'Need at least 2 players in the league to start a tournament';
  end if;

  insert into tournaments (league_id, name, status)
  values (p_league_id, p_name, 'round_robin')
  returning id into v_tournament_id;

  insert into tournament_participants (tournament_id, profile_id)
  select v_tournament_id, profile_id from players where league_id = p_league_id;

  -- Every unique pairing, once each.
  for i in 1 .. v_n loop
    for j in i + 1 .. v_n loop
      insert into tournament_matches (tournament_id, phase, player_a_id, player_b_id, status)
      values (v_tournament_id, 'round_robin', v_player_ids[i], v_player_ids[j], 'pending');
    end loop;
  end loop;

  return v_tournament_id;
end;
$$;

grant execute on function public.create_tournament(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- report_tournament_match(): either player in the match, or a league
-- admin, can report the score. Single game to 11, so this is a single
-- score line — no accept/dispute flow, straightforward self-report with
-- admin override available if two people disagree (same "referee mode"
-- pattern as the regular ladder's admin override).
-- ═══════════════════════════════════════════════════════════════════

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
  v_match     tournament_matches%rowtype;
  v_league_id uuid;
  v_winner    uuid;
  v_loser     uuid;
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
         and not public.is_league_admin(v_league_id)) then
    raise exception 'Not authorized to report this match';
  end if;

  v_winner := case when p_score_a > p_score_b then v_match.player_a_id else v_match.player_b_id end;
  v_loser  := case when p_score_a > p_score_b then v_match.player_b_id else v_match.player_a_id end;

  update tournament_matches
  set score_a      = p_score_a,
      score_b      = p_score_b,
      winner_id    = v_winner,
      status       = 'completed',
      reported_by  = auth.uid(),
      completed_at = now()
  where id = p_match_id;

  update tournament_participants
  set wins           = wins + (case when profile_id = v_winner then 1 else 0 end),
      losses         = losses + (case when profile_id = v_loser then 1 else 0 end),
      points_for     = points_for + (case when profile_id = v_match.player_a_id then p_score_a else p_score_b end),
      points_against = points_against + (case when profile_id = v_match.player_a_id then p_score_b else p_score_a end)
  where tournament_id = v_match.tournament_id
    and profile_id in (v_match.player_a_id, v_match.player_b_id);
end;
$$;

grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;
