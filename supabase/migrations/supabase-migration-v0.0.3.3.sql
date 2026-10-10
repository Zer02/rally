-- supabase-migration-v0.0.3.3.sql
-- Run in Supabase → SQL Editor, after v0.0.3.2.
--
-- v0.0.3.2 built round robin as a one-shot tournament: create_tournament()
-- enrolled the whole league and generated every pairing immediately. That
-- doesn't fit how this actually gets played — it's a WEEKLY recurring round
-- robin where attendance varies week to week, and standings accumulate over
-- a season. This migration reworks the schema for that:
--
--   - tournaments is now a season SHELL — create_tournament() just creates
--     the row, no pairings generated at creation.
--   - New tournament_weeks table — one row per week. Starting a week is an
--     explicit admin action: pick that week's attendees, and pairings get
--     generated for just that group.
--   - First time a player appears in ANY week's attendee list, they're
--     auto-enrolled as a season participant starting at 0-0. No catch-up
--     matches are generated for weeks they missed — by design.
--   - wins/losses/points_for/points_against remain cumulative across the
--     whole season, same columns as before.
--   - New 'challenge' match phase: classic ladder-style challenge — you can
--     only challenge a player currently ranked above you, capped at one
--     challenge per player per week. Winning a challenge adds to a new
--     bonus_points column and does NOT touch wins/losses/points_for/against,
--     so it can never be mistaken for a real match result.
--   - New finalize_tournament(): computes the strength-of-schedule adjusted
--     score from round-robin matches only (challenges aren't part of the
--     win-rate-weighted differential math, since they don't have real
--     differentials), then adds bonus_points as a flat top-up. Locks the
--     season and assigns final seeds.
--
-- Deliberately still does NOT include bracket generation — that's the
-- version after this one, once a season is finalized.
-- This migration is self-contained: safe to run even if only v0.0.3.2 (not
-- any earlier version) has been applied.

-- ═══════════════════════════════════════════════════════════════════
-- New table: tournament_weeks
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.tournament_weeks (
  id            uuid default uuid_generate_v4() primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  week_number   int not null,
  label         text,
  created_at    timestamptz default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  unique (tournament_id, week_number)
);

alter table public.tournament_weeks enable row level security;
drop policy if exists "Tournament weeks are public" on public.tournament_weeks;
create policy "Tournament weeks are public" on public.tournament_weeks for select using (true);

create index if not exists idx_tournament_weeks_tournament on public.tournament_weeks(tournament_id);


-- ═══════════════════════════════════════════════════════════════════
-- tournament_matches: add week_id, challenger_id, and the 'challenge' phase
-- ═══════════════════════════════════════════════════════════════════

alter table public.tournament_matches
  add column if not exists week_id uuid references public.tournament_weeks(id) on delete cascade;

alter table public.tournament_matches
  add column if not exists challenger_id uuid references public.profiles(id) on delete set null;

alter table public.tournament_matches drop constraint if exists tournament_matches_phase_check;
alter table public.tournament_matches
  add constraint tournament_matches_phase_check check (phase in ('round_robin', 'bracket', 'challenge'));

create index if not exists idx_tournament_matches_week on public.tournament_matches(week_id);


-- ═══════════════════════════════════════════════════════════════════
-- tournament_participants: add bonus_points (challenge winnings)
-- ═══════════════════════════════════════════════════════════════════

alter table public.tournament_participants
  add column if not exists bonus_points int not null default 0;


-- ═══════════════════════════════════════════════════════════════════
-- create_tournament(): now just creates the season shell. No players are
-- enrolled and no matches exist until the first week is started.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.create_tournament(p_league_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Only admins of this league can start a season';
  end if;

  insert into tournaments (league_id, name, status)
  values (p_league_id, p_name, 'round_robin')
  returning id into v_tournament_id;

  return v_tournament_id;
end;
$$;

grant execute on function public.create_tournament(uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- start_tournament_week(): admin-only. Picks that week's attendees,
-- auto-enrolls any of them who aren't already season participants (no
-- catch-up matches for late joiners), and generates one round-robin match
-- per unique pair among just this week's attendees.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.start_tournament_week(
  p_tournament_id uuid,
  p_attendee_ids  uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id   uuid;
  v_week_id     uuid;
  v_week_number int;
  v_n           int;
  i             int;
  j             int;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can start a round robin week';
  end if;

  v_n := coalesce(array_length(p_attendee_ids, 1), 0);
  if v_n < 2 then
    raise exception 'Need at least 2 attendees to start a week';
  end if;

  select coalesce(max(week_number), 0) + 1 into v_week_number
  from tournament_weeks where tournament_id = p_tournament_id;

  insert into tournament_weeks (tournament_id, week_number, created_by)
  values (p_tournament_id, v_week_number, auth.uid())
  returning id into v_week_id;

  -- Auto-enroll any attendee who isn't already a season participant.
  insert into tournament_participants (tournament_id, profile_id)
  select p_tournament_id, pid
  from unnest(p_attendee_ids) as pid
  on conflict (tournament_id, profile_id) do nothing;

  -- Every unique pairing among this week's attendees, once each.
  for i in 1 .. v_n loop
    for j in i + 1 .. v_n loop
      insert into tournament_matches (tournament_id, phase, week_id, player_a_id, player_b_id, status)
      values (p_tournament_id, 'round_robin', v_week_id, p_attendee_ids[i], p_attendee_ids[j], 'pending');
    end loop;
  end loop;

  return v_week_id;
end;
$$;

grant execute on function public.start_tournament_week(uuid, uuid[]) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- create_challenge(): classic ladder-style challenge. You can only
-- challenge a player currently ranked above you in the live cumulative
-- standings, and only once per week. Ranking uses the same sort as the
-- standings UI: wins desc, then point differential desc.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.create_challenge(
  p_tournament_id uuid,
  p_challenged_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenger      uuid := auth.uid();
  v_week_id         uuid;
  v_challenger_rank int;
  v_challenged_rank int;
  v_existing        int;
  v_match_id        uuid;
begin
  if v_challenger is null then
    raise exception 'Must be signed in to issue a challenge';
  end if;
  if v_challenger = p_challenged_id then
    raise exception 'Cannot challenge yourself';
  end if;

  if not exists (
    select 1 from tournament_participants
    where tournament_id = p_tournament_id and profile_id = v_challenger
  ) then
    raise exception 'You are not a participant in this season';
  end if;

  if not exists (
    select 1 from tournament_participants
    where tournament_id = p_tournament_id and profile_id = p_challenged_id
  ) then
    raise exception 'That player is not a participant in this season';
  end if;

  select id into v_week_id from tournament_weeks
  where tournament_id = p_tournament_id
  order by week_number desc
  limit 1;

  if v_week_id is null then
    raise exception 'No week has been started yet for this season';
  end if;

  select count(*) into v_existing
  from tournament_matches
  where tournament_id = p_tournament_id
    and phase = 'challenge'
    and week_id = v_week_id
    and challenger_id = v_challenger;

  if v_existing > 0 then
    raise exception 'You have already used your challenge for this week';
  end if;

  with ranked as (
    select profile_id,
           row_number() over (order by wins desc, (points_for - points_against) desc) as rnk
    from tournament_participants
    where tournament_id = p_tournament_id
  )
  select
    (select rnk from ranked where profile_id = v_challenger),
    (select rnk from ranked where profile_id = p_challenged_id)
  into v_challenger_rank, v_challenged_rank;

  if v_challenger_rank is null or v_challenged_rank is null or v_challenged_rank >= v_challenger_rank then
    raise exception 'You can only challenge a player currently ranked above you';
  end if;

  insert into tournament_matches
    (tournament_id, phase, week_id, challenger_id, player_a_id, player_b_id, status)
  values
    (p_tournament_id, 'challenge', v_week_id, v_challenger, v_challenger, p_challenged_id, 'pending')
  returning id into v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.create_challenge(uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- report_tournament_match(): now branches on phase. Round-robin matches
-- work exactly as before (cumulative wins/losses/points). Challenge
-- matches only ever add to the winner's bonus_points — never touch
-- wins/losses/points_for/points_against.
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
  v_match        tournament_matches%rowtype;
  v_league_id    uuid;
  v_winner       uuid;
  v_loser        uuid;
  v_bonus_points constant int := 2; -- points awarded to the winner of a challenge
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

  if v_match.phase = 'challenge' then
    update tournament_participants
    set bonus_points = bonus_points + v_bonus_points
    where tournament_id = v_match.tournament_id
      and profile_id = v_winner;
  else
    update tournament_participants
    set wins           = wins + (case when profile_id = v_winner then 1 else 0 end),
        losses         = losses + (case when profile_id = v_loser then 1 else 0 end),
        points_for     = points_for + (case when profile_id = v_match.player_a_id then p_score_a else p_score_b end),
        points_against = points_against + (case when profile_id = v_match.player_a_id then p_score_b else p_score_a end)
    where tournament_id = v_match.tournament_id
      and profile_id in (v_match.player_a_id, v_match.player_b_id);
  end if;
end;
$$;

grant execute on function public.report_tournament_match(uuid, int, int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- finalize_tournament(): admin-only, ends the season. Computes each
-- participant's win rate from round-robin matches, applies the
-- strength-of-schedule multiplier (0.75 + opponent_win_rate × 0.75) to
-- every round-robin match differential, sums those, then adds
-- bonus_points as a flat top-up (challenges are intentionally excluded
-- from the multiplier math itself — see migration header). Writes
-- adjusted_score + seed, locks the season.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.finalize_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can finalize the season';
  end if;

  with win_rates as (
    select profile_id,
           case when (wins + losses) = 0 then 0
                else wins::numeric / (wins + losses) end as win_rate
    from tournament_participants
    where tournament_id = p_tournament_id
  ),
  match_scores as (
    select
      p.profile_id,
      (case when p.profile_id = m.player_a_id then m.score_a - m.score_b
            else m.score_b - m.score_a end) as differential,
      (case when p.profile_id = m.player_a_id then m.player_b_id else m.player_a_id end) as opponent_id
    from tournament_matches m
    join tournament_participants p
      on p.tournament_id = m.tournament_id
     and p.profile_id in (m.player_a_id, m.player_b_id)
    where m.tournament_id = p_tournament_id
      and m.phase = 'round_robin'
      and m.status = 'completed'
  ),
  weighted as (
    select
      ms.profile_id,
      sum(ms.differential * (0.75 + coalesce(wr.win_rate, 0) * 0.75)) as raw_adjusted
    from match_scores ms
    left join win_rates wr on wr.profile_id = ms.opponent_id
    group by ms.profile_id
  ),
  final as (
    select
      tp.profile_id,
      coalesce(w.raw_adjusted, 0) + tp.bonus_points as adjusted_score
    from tournament_participants tp
    left join weighted w on w.profile_id = tp.profile_id
    where tp.tournament_id = p_tournament_id
  ),
  seeded as (
    select profile_id, adjusted_score,
           row_number() over (order by adjusted_score desc) as seed
    from final
  )
  update tournament_participants tp
  set adjusted_score = s.adjusted_score,
      seed           = s.seed
  from seeded s
  where tp.tournament_id = p_tournament_id
    and tp.profile_id = s.profile_id;

  update tournaments
  set status = 'completed',
      completed_at = now()
  where id = p_tournament_id;
end;
$$;

grant execute on function public.finalize_tournament(uuid) to authenticated;
