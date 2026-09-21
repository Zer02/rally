-- supabase-migration-v0.0.3.9.sql
-- Run in Supabase → SQL Editor, after v0.0.3.8.
--
-- Two small admin-only RPCs, no schema changes:
--   - add_tournament_match(): manually create one match for the current
--     week, for whenever the smart pairing algorithm didn't cover
--     everyone the admin wants covered, or a rematch is wanted on
--     purpose. Attaches to the most recently started week.
--   - cancel_tournament_match(): deletes a match that was never played
--     and never will be. Only allowed on 'pending' or 'in_progress'
--     matches — a 'completed' match is a real result and this will
--     refuse to touch it. Safe to delete outright: a pending/in_progress
--     match has never been counted in anyone's wins/losses/points/
--     rr_rating, since report_tournament_match() is the only thing that
--     ever writes those, and it only runs on completion.

create or replace function public.add_tournament_match(
  p_tournament_id uuid,
  p_player_a_id   uuid,
  p_player_b_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
  v_week_id   uuid;
  v_match_id  uuid;
begin
  select league_id into v_league_id from tournaments where id = p_tournament_id;
  if v_league_id is null then
    raise exception 'Season not found';
  end if;

  if not public.is_league_admin(v_league_id) then
    raise exception 'Only admins of this league can add a match';
  end if;

  if p_player_a_id = p_player_b_id then
    raise exception 'A player cannot be matched against themselves';
  end if;

  select id into v_week_id
  from tournament_weeks
  where tournament_id = p_tournament_id
  order by week_number desc
  limit 1;

  if v_week_id is null then
    raise exception 'Start a week before adding a match';
  end if;

  insert into tournament_participants (tournament_id, profile_id)
  values (p_tournament_id, p_player_a_id), (p_tournament_id, p_player_b_id)
  on conflict (tournament_id, profile_id) do nothing;

  insert into tournament_matches (tournament_id, phase, week_id, player_a_id, player_b_id, status)
  values (p_tournament_id, 'round_robin', v_week_id, p_player_a_id, p_player_b_id, 'pending')
  returning id into v_match_id;

  return v_match_id;
end;
$$;

grant execute on function public.add_tournament_match(uuid, uuid, uuid) to authenticated;


create or replace function public.cancel_tournament_match(p_match_id uuid)
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
    raise exception 'Only admins of this league can remove a match';
  end if;

  if v_match.status not in ('pending', 'in_progress') then
    raise exception 'Only a match that hasn''t been played yet can be removed';
  end if;

  delete from tournament_matches where id = p_match_id;
end;
$$;

grant execute on function public.cancel_tournament_match(uuid) to authenticated;
