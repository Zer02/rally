-- supabase-migration-v0.0.2.9.sql
-- Run in Supabase → SQL Editor.
--
-- Adds reset_season(): zeroes season_wins/season_losses for every player.
-- Career totals and rating are untouched. Admin-gated server-side so the
-- check can't be bypassed by calling the RPC directly.
--
-- NOTE: Supabase ships a protective extension that rejects any UPDATE
-- (even ones run inside a SECURITY DEFINER function, not just ones sent
-- directly from the client) that has no WHERE clause at all — it errors
-- with "UPDATE requires a WHERE clause" (code 21000) rather than letting
-- a bare `UPDATE players SET ...;` through. Since resetting every row is
-- the intended behavior here, `where true` satisfies the check without
-- actually filtering anything out.

create or replace function public.reset_season()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'Only admins can reset the season';
  end if;

  update players
  set season_wins = 0, season_losses = 0
  where true;
end;
$$;

grant execute on function public.reset_season() to authenticated;
