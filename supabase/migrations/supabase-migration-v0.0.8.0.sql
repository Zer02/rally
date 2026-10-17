-- ═══════════════════════════════════════════════════════════════════
-- v0.0.8.0 — Close the open write doors on players and elo_history
--
-- WHY
--   Before a pilot with real players, nobody signed in should be able to edit
--   the standings by talking to the database directly (anyone can, with the
--   public key that ships in the web app). Four rules allowed it:
--
--     players     "System inserts players"   insert, with check (true)
--                 -> any signed-in user could create a player record for
--                    ANYONE, in any league, with any rating.
--     players     "Users join a league"      insert, own profile only
--                 -> right idea (this is how Join works), but the insert could
--                    also set rating, xp, wins... on the new record.
--     players     "Users update own player"  update, own record, ANY column
--                 -> a player could set their own rating or XP.
--     elo_history "System inserts elo"       insert, with check (true)
--                 -> anyone could write fake rating history.
--
--   Nothing in the app needs any of this. The app only READS these two tables,
--   apart from Join. Every other write is made by a SECURITY DEFINER function
--   (create_league, finalize_match, finalize_tournament, reset_season,
--   sync_quest_progress), which runs as the table owner and is not affected by
--   these policies, or by an Edge Function using the service role.
--
-- WHAT THIS CHANGES
--   1. Drops "System inserts players", "Users update own player" and
--      "System inserts elo".
--   2. Joining a league still works, but a joining user can now set only
--      profile_id and league_id (column-level privilege); everything else
--      takes its default (rating 1000, xp 0, no wins).
--   3. Signed-out and signed-in users lose table-level insert/update/delete
--      on players and elo_history, as a second lock behind the policies.
--
-- NOT CHANGED (still true, noted for the next release)
--   finalize_match() takes the new ratings from the browser. It checks that
--   the caller played the match (or administers the league), but not that the
--   ratings are the right ones. That is a design question, not a permission one.
--
-- Requires v0.0.7.9. Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.is_league_member(uuid,uuid)') is null then
    raise exception 'Run supabase-migration-v0.0.7.9.sql first (it creates is_league_member).';
  end if;
end $$;

-- ── 1. Drop the open policies ──────────────────────────────────────
drop policy if exists "System inserts players"  on public.players;
drop policy if exists "Users update own player" on public.players;
drop policy if exists "System inserts elo"      on public.elo_history;

-- Joining stays exactly as it was: you may insert your own record.
drop policy if exists "Users join a league" on public.players;
create policy "Users join a league" on public.players
  for insert with check (auth.uid() = profile_id);

-- ── 2. Second lock: privileges ─────────────────────────────────────
-- service_role and the table owner (which the SECURITY DEFINER functions run
-- as) keep full access; only the two app-facing roles are narrowed.
revoke insert, update, delete on public.players     from anon, authenticated;
revoke insert, update, delete on public.elo_history from anon, authenticated;

-- ...except the one thing Join needs: choosing who and which league.
grant insert (profile_id, league_id) on public.players to authenticated;

-- ── Self-check ─────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in ('System inserts players', 'Users update own player', 'System inserts elo')
  ) then
    raise exception 'an open policy is still in place';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'players' and policyname = 'Users join a league'
  ) then
    raise exception 'the Join policy is missing';
  end if;
  if has_table_privilege('authenticated', 'public.players', 'update')
     or has_table_privilege('authenticated', 'public.players', 'delete')
     or has_table_privilege('authenticated', 'public.elo_history', 'insert') then
    raise exception 'authenticated still has write privileges it should not have';
  end if;
  if not has_column_privilege('authenticated', 'public.players', 'league_id', 'insert')
     or has_column_privilege('authenticated', 'public.players', 'rating', 'insert') then
    raise exception 'column privileges on players are not as intended';
  end if;
  raise notice 'v0.0.8.0 OK: players and elo_history can no longer be written directly; Join still works.';
end $$;
