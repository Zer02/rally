-- supabase-migration-v0.0.3.4.sql
-- Run in Supabase → SQL Editor, after v0.0.3.3.
--
-- This is the court-queue schema that the v0.0.3.4 README entry and the
-- last handoff both described as shipped — it wasn't actually committed.
-- The store (`useTournamentsStore`) and types (`TournamentMatch`,
-- `court`/`started_at`/'in_progress') already assume this exists. This
-- migration is what makes that true. Safe to run even if you're not sure
-- whether it was applied before — every statement is idempotent.
--
-- Adds:
--   - tournament_matches.court, .started_at, and an 'in_progress' status
--   - leagues.court_count (display-only, e.g. "Courts 1-5" — not enforced
--     server-side, set it manually per league via SQL for now, same as
--     bootstrapping is_admin)
--   - call_match_to_court(): admin-only, moves a pending match to a court.
--     Refuses if that court already has a live match on it in this
--     tournament — no auto-scheduler, but also no accidental double-booking.
--   - uncall_match(): admin-only, reverts a mis-called match back to pending.

alter table public.tournament_matches
  add column if not exists court      int,
  add column if not exists started_at timestamptz;

alter table public.tournament_matches drop constraint if exists tournament_matches_status_check;
alter table public.tournament_matches
  add constraint tournament_matches_status_check check (status in ('pending', 'in_progress', 'completed', 'bye'));

create index if not exists idx_tournament_matches_court
  on public.tournament_matches(tournament_id, court)
  where status = 'in_progress';

alter table public.leagues
  add column if not exists court_count int;


-- ═══════════════════════════════════════════════════════════════════
-- call_match_to_court(): admin-only. Moves a pending match onto a court.
-- Refuses if another match is already live on that court in the same
-- tournament — courts are assigned by availability, not a fixed plan,
-- so this is the one guardrail: don't let two matches think they're on
-- court 3 at once.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.call_match_to_court(
  p_match_id uuid,
  p_court    int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match     tournament_matches%rowtype;
  v_league_id uuid;
begin
  select * into v_match from tournament_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  select league_id into v_league_id from tournaments where id = v_match.tournament_id;
  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can call a match to a court';
  end if;

  if v_match.status <> 'pending' then
    raise exception 'Only a pending match can be called to a court';
  end if;

  if p_court is null or p_court < 1 then
    raise exception 'Invalid court number';
  end if;

  if exists (
    select 1 from tournament_matches
    where tournament_id = v_match.tournament_id
      and status = 'in_progress'
      and court = p_court
  ) then
    raise exception 'Court % already has a match in progress', p_court;
  end if;

  update tournament_matches
  set status     = 'in_progress',
      court      = p_court,
      started_at = now()
  where id = p_match_id;
end;
$$;

grant execute on function public.call_match_to_court(uuid, int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- uncall_match(): admin-only. Reverts a mis-called match back to pending
-- and clears its court/started_at, so it can be called again correctly.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.uncall_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match     tournament_matches%rowtype;
  v_league_id uuid;
begin
  select * into v_match from tournament_matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  select league_id into v_league_id from tournaments where id = v_match.tournament_id;
  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can uncall a match';
  end if;

  if v_match.status <> 'in_progress' then
    raise exception 'Only an in-progress match can be uncalled';
  end if;

  update tournament_matches
  set status     = 'pending',
      court      = null,
      started_at = null
  where id = p_match_id;
end;
$$;

grant execute on function public.uncall_match(uuid) to authenticated;
