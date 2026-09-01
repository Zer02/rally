-- supabase-migration-v0.0.2.4.sql
-- Run in Supabase SQL Editor.
--
-- Why: finalise() in matches.ts was updating BOTH the winner's and loser's
-- rows in `players` from the client. Whichever user triggered the
-- finalization could only pass RLS for their OWN row, so the other
-- player's rating/streak/W-L update was silently rejected (Supabase
-- doesn't error on an RLS-blocked update — it just affects 0 rows).
-- This function runs as SECURITY DEFINER so it isn't subject to either
-- player's individual RLS policy, and does the match + both player
-- updates + elo_history insert atomically in one transaction.

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
begin
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

-- Allow any logged-in user to call it — the function itself controls
-- exactly what gets written, so this is safe to expose broadly.
grant execute on function public.finalize_match(
  uuid, uuid, uuid, numeric, numeric, int, numeric, numeric, int,
  numeric, int, int, text, text
) to authenticated;
