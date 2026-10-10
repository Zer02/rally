-- supabase-migration-v0.0.2.5.sql
-- Run in Supabase SQL Editor. Replaces the finalize_match() function from
-- v0.0.2.4 with a version that checks the caller is authorized before
-- writing anything.
--
-- Why: finalize_match() runs as SECURITY DEFINER (bypasses RLS) and is
-- granted to all authenticated users. As written in v0.0.2.4, it trusted
-- whatever values the client sent with no check on WHO was calling it —
-- meaning any logged-in user could call it directly (e.g. via devtools)
-- with arbitrary ratings for themselves or anyone else. This version
-- requires the caller to be the winner, the loser, or an admin.

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
  v_caller_is_admin boolean;
begin
  select is_admin into v_caller_is_admin
  from profiles
  where id = auth.uid();

  if auth.uid() is null
     or (auth.uid() <> p_winner_id
         and auth.uid() <> p_loser_id
         and coalesce(v_caller_is_admin, false) = false) then
    raise exception 'Not authorized to finalize this match';
  end if;

  -- Match must actually belong to these two players and not already be completed
  if not exists (
    select 1 from matches
    where id = p_match_id
      and status <> 'completed'
      and ((challenger_id = p_winner_id and opponent_id = p_loser_id)
        or (challenger_id = p_loser_id  and opponent_id = p_winner_id))
  ) then
    raise exception 'Match not found, already completed, or players do not match';
  end if;

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
  where profile_id = p_winner_id;

  update players
  set rating        = p_loser_rating,
      uncertainty   = p_loser_uncertainty,
      streak        = p_loser_streak,
      season_losses = season_losses + 1,
      career_losses = career_losses + 1,
      last_played   = now()
  where profile_id = p_loser_id;

  insert into elo_history (profile_id, rating, match_id)
  values
    (p_winner_id, p_winner_rating, p_match_id),
    (p_loser_id,  p_loser_rating,  p_match_id);
end;
$$;

grant execute on function public.finalize_match(
  uuid, uuid, uuid, numeric, numeric, int, numeric, numeric, int,
  numeric, int, int, text, text
) to authenticated;
