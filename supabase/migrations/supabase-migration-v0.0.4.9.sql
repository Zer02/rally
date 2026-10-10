-- supabase-migration-v0.0.4.9.sql
-- Run in Supabase SQL Editor after confirming v0.0.4.5 is applied (the
-- most recent migration to touch schema; v0.0.4.6-4.8 were frontend-only).
--
-- leagues has RLS enabled since v0.0.3.0 with only a SELECT policy — so
-- there was never any way to edit a league's name/icon after creation,
-- even from a trusted admin, without this. Reuses the existing
-- is_league_admin() function (same check create-placeholder-player and
-- every other per-league admin action already goes through) rather than
-- inventing a new one.

drop policy if exists "League admins update their league" on public.leagues;
create policy "League admins update their league" on public.leagues
  for update
  using (is_league_admin(id))
  with check (is_league_admin(id));
