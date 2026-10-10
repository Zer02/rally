-- supabase-migration-v0.0.2.10.sql
-- Run in Supabase → SQL Editor.
--
-- Adds season history so the Leaderboard/Profile season dropdown has
-- something to show for past seasons. Previously reset_season() just
-- zeroed season_wins/season_losses with no record of what they were —
-- there is no way to recover pre-existing season data, so this starts
-- tracking from whatever the CURRENT in-progress season is as of now.
--
-- Design:
--   - `seasons` — one row per season. The row with ended_at IS NULL is
--     the season currently in progress; its W-L lives on players.* the
--     same as always. Once reset_season() is called, that row gets
--     ended_at stamped and a new season row is opened.
--   - `season_records` — one row per (season, player), written ONLY at
--     reset time by archiving that player's season_wins/season_losses
--     as they stood at that moment. Never touched by client writes.

create table public.seasons (
  id            uuid default uuid_generate_v4() primary key,
  season_number serial,
  started_at    timestamptz default now(),
  ended_at      timestamptz
);

alter table public.seasons enable row level security;
create policy "Seasons are public" on seasons for select using (true);
-- No insert/update/delete policy — only reset_season() (SECURITY DEFINER)
-- writes here.

create table public.season_records (
  id         uuid default uuid_generate_v4() primary key,
  season_id  uuid references public.seasons(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  wins       int not null default 0,
  losses     int not null default 0,
  created_at timestamptz default now(),
  unique (season_id, profile_id)
);

alter table public.season_records enable row level security;
create policy "Season records are public" on season_records for select using (true);
-- Same as above — only reset_season() writes here.

-- Seed the season currently in progress. There's no way to know when the
-- club's actual first season "really" started, so this just opens as of
-- now — anything before this migration is unrecoverable, which is fine
-- since it was never being tracked anyway.
insert into public.seasons default values;


-- ═══════════════════════════════════════════════════════════════════
-- reset_season(): now archives before zeroing, instead of just zeroing
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.reset_season()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_season_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and is_admin = true
  ) then
    raise exception 'Only admins can reset the season';
  end if;

  select id into v_active_season_id
  from seasons where ended_at is null
  order by started_at desc limit 1;

  -- Safety net in case the seed row above is ever missing for some reason
  -- (shouldn't happen after this migration runs).
  if v_active_season_id is null then
    insert into seasons default values returning id into v_active_season_id;
  end if;

  -- Archive current standings for every player into season_records
  -- before wiping them. The `where true` on the conflict branch is the
  -- same defensive move as elsewhere in this project — Supabase's
  -- protective extension has been seen rejecting UPDATE-shaped
  -- statements (including the UPDATE half of an upsert's ON CONFLICT
  -- DO UPDATE) that have no WHERE at all.
  insert into season_records (season_id, profile_id, wins, losses)
  select v_active_season_id, profile_id, season_wins, season_losses
  from players
  on conflict (season_id, profile_id) do update
    set wins = excluded.wins, losses = excluded.losses
    where true;

  -- Close out the season that was just archived, then open the next one.
  update seasons set ended_at = now() where id = v_active_season_id;
  insert into seasons default values;

  update players
  set season_wins = 0, season_losses = 0
  where true;
end;
$$;

grant execute on function public.reset_season() to authenticated;
