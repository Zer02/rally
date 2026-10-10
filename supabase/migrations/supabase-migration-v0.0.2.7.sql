-- supabase-migration-v0.0.2.7.sql
-- Run in Supabase → SQL Editor.
--
-- Referee mode: lets a user with profiles.is_admin = true create a match
-- on behalf of any two players, not just themselves as challenger.
--
-- The existing "Players create challenges" policy only allows an insert
-- where auth.uid() = challenger_id. This adds a second, permissive policy
-- for admins — Postgres OR's multiple policies for the same command
-- together, so this doesn't replace or narrow the existing one, it just
-- adds another way to pass the insert check.
--
-- No changes needed to finalize_match() itself — it already authorizes
-- admin callers as of v0.0.2.5, regardless of whether they're the winner
-- or loser.

create policy "Admins create matches for anyone" on matches for insert
with check (
  exists (
    select 1 from profiles where id = auth.uid() and is_admin = true
  )
);
