-- supabase-migration-v0.0.3.8.sql
-- Run in Supabase → SQL Editor, after v0.0.3.7.
--
-- Two things, neither of which touches existing data:
--
-- 1. finalize_tournament() never deleted anything — it only ever set
--    tournaments.status = 'completed' and wrote adjusted_score/seed onto
--    tournament_participants (which already existed). What made it LOOK
--    like a wipe: fetchActive() filters out completed tournaments, and
--    there was no UI anywhere to browse a finalized season. That part is
--    a client-side fix (past-seasons panel + profile history) — no SQL
--    for it, nothing here.
--
-- 2. This migration adds the part that actually was missing: round robin
--    results writing back to a player's career record. New columns on
--    `players` (scoped per-league, same as season_wins/career_wins):
--      - rr_titles          — seasons finished in 1st
--      - rr_best_finish     — best seed ever achieved (1 = best); null
--        until a player has finished at least one season, since 0 would
--        wrongly read as "finished 0th"
--      - rr_seasons_played  — count of finalized seasons participated in
--    finalize_tournament() writes these for every participant, reading
--    the seed it just computed rather than recomputing it.

alter table public.players
  add column if not exists rr_titles         int,
  add column if not exists rr_best_finish    int,
  add column if not exists rr_seasons_played int;

update public.players set rr_titles = 0         where rr_titles is null;
update public.players set rr_seasons_played = 0 where rr_seasons_played is null;

alter table public.players alter column rr_titles         set not null;
alter table public.players alter column rr_titles         set default 0;
alter table public.players alter column rr_seasons_played set not null;
alter table public.players alter column rr_seasons_played set default 0;
-- rr_best_finish stays nullable on purpose — null means "hasn't finished
-- a season yet", which is different from having finished 0th.


-- ═══════════════════════════════════════════════════════════════════
-- finalize_tournament(): same win-rate / SOS / seed logic as before,
-- with one addition at the end — writes rr_titles / rr_best_finish /
-- rr_seasons_played onto each participant's players row for this league.
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

  -- Career round-robin record, read from the seed just written above.
  update players pl
  set rr_seasons_played = pl.rr_seasons_played + 1,
      rr_titles         = pl.rr_titles + (case when tp.seed = 1 then 1 else 0 end),
      rr_best_finish     = least(coalesce(pl.rr_best_finish, tp.seed), tp.seed)
  from tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and pl.profile_id = tp.profile_id
    and pl.league_id  = v_league_id;

  update tournaments
  set status = 'completed',
      completed_at = now()
  where id = p_tournament_id;
end;
$$;

grant execute on function public.finalize_tournament(uuid) to authenticated;
