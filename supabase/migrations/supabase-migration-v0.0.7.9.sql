-- ═══════════════════════════════════════════════════════════════════
-- v0.0.7.9 — Only league members can challenge, and only other members
--
-- WHY
--   Signing up creates an account (a profile) but NOT a player record: a player
--   record exists only after joining a league. The database let anyone with an
--   account create a challenge anyway (the rule only checked "you are the
--   challenger"), so a person who had signed up but never joined could challenge
--   members, look fully set up, and then fail when scores were reported: the
--   result can't be rated without a player record for each side. The match was
--   left stuck, half reported, and the person never appeared on the leaderboard.
--
-- WHAT THIS CHANGES
--   1. is_league_member(league, profile): true if that profile has a player
--      record in that league.
--   2. matches INSERT policy "Players create challenges": you can create a
--      challenge only if YOU are the challenger and BOTH players are members of
--      the league (or you administer that league, which is how admins enter
--      results for other people; the separate global-admin policy is untouched).
--   3. An audit lists open challenges (not completed or declined) where either
--      player is not a member of the match's league. It changes nothing: to
--      clear one, remove the match (admin Remove button, or delete it in the
--      Supabase table editor); once the person joins the league, a stuck match
--      can also just be reported again.
--
--   Joining is unchanged: a signed-in user inserts their own player record
--   (policy "Users join a league", v0.0.3.0). The app now shows a Join button
--   on Home, Profile, Challenge and the Leaderboard.
--
-- Requires v0.0.3.0. Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.is_league_admin(uuid)') is null then
    raise exception 'Run supabase-migration-v0.0.3.0.sql first (it creates is_league_admin).';
  end if;
end $$;

-- ── 1. Membership check ────────────────────────────────────────────
-- security definer so the policy below can look at players however players' own
-- policies are set; it only ever answers yes or no.
create or replace function public.is_league_member(p_league_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.players
    where league_id = p_league_id and profile_id = p_profile_id
  );
$$;

grant execute on function public.is_league_member(uuid, uuid) to authenticated;

-- ── 2. Challenge rule ──────────────────────────────────────────────
drop policy if exists "Players create challenges" on public.matches;
create policy "Players create challenges" on public.matches for insert with check (
  (
    auth.uid() = challenger_id
    and public.is_league_member(league_id, challenger_id)
    and public.is_league_member(league_id, opponent_id)
  )
  or public.is_league_admin(league_id)
);

-- ── 3. Audit: open challenges involving someone who never joined ───
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select m.id, m.status, l.name as league,
           coalesce(c.display_name, c.username, m.challenger_id::text) as challenger,
           coalesce(o.display_name, o.username, m.opponent_id::text)   as opponent,
           not public.is_league_member(m.league_id, m.challenger_id) as challenger_out,
           not public.is_league_member(m.league_id, m.opponent_id)   as opponent_out
      from public.matches m
      join public.leagues l on l.id = m.league_id
      left join public.profiles c on c.id = m.challenger_id
      left join public.profiles o on o.id = m.opponent_id
     where m.status not in ('completed', 'declined')
       and (not public.is_league_member(m.league_id, m.challenger_id)
            or not public.is_league_member(m.league_id, m.opponent_id))
     order by m.created_at
  loop
    n := n + 1;
    if n <= 25 then
      raise notice 'Open challenge % (%, %): % vs % — not a member of the league: %',
        r.id, r.league, r.status, r.challenger, r.opponent,
        concat_ws(' and ',
          case when r.challenger_out then r.challenger end,
          case when r.opponent_out   then r.opponent   end);
    end if;
  end loop;
  if n = 0 then
    raise notice 'Audit: every open challenge is between league members.';
  else
    raise notice 'Audit: % open challenge(s) involve someone who has not joined the league (first 25 listed above). They are unchanged. Remove them, or have the person join the league and report again.', n;
  end if;
end $$;

-- ── Self-check ─────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.is_league_member(uuid,uuid)') is null then
    raise exception 'is_league_member was not created';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'Players create challenges'
      and with_check like '%is_league_member%'
  ) then
    raise exception 'the challenge policy was not updated';
  end if;
  raise notice 'v0.0.7.9 OK: only league members can create challenges.';
end $$;
