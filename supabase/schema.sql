-- =====================================================
-- RALLY — Supabase Schema v0.0.1
-- Run in Supabase → SQL Editor
-- =====================================================

create extension if not exists "uuid-ossp";

-- ── Profiles ─────────────────────────────────────────
create table public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  username     text unique not null,
  display_name text,
  unit         text,        -- apartment / unit number
  avatar_url   text,
  created_at   timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Profiles are public"        on profiles for select using (true);
create policy "Users update own profile"   on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name, unit)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'unit', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── Players ──────────────────────────────────────────
-- One row per user — their live rating state
create table public.players (
  id            uuid default uuid_generate_v4() primary key,
  profile_id    uuid references public.profiles(id) on delete cascade unique not null,
  rating        int  default 1000,
  uncertainty   int  default 200,
  streak        int  default 0,    -- positive = win streak, negative = loss streak
  season_wins   int  default 0,
  season_losses int  default 0,
  career_wins   int  default 0,
  career_losses int  default 0,
  last_played   timestamptz
);

alter table public.players enable row level security;
create policy "Players are public"       on players for select using (true);
create policy "Users update own player"  on players for update using (
  auth.uid() = profile_id
);
create policy "System inserts players"   on players for insert with check (true);


-- ── Matches ──────────────────────────────────────────
create table public.matches (
  id               uuid default uuid_generate_v4() primary key,
  challenger_id    uuid references public.profiles(id) not null,
  opponent_id      uuid references public.profiles(id) not null,
  winner_id        uuid references public.profiles(id),
  challenger_score text,   -- comma-separated game scores e.g. "11,8,11"
  opponent_score   text,
  status           text default 'pending'
                   check (status in ('pending','accepted','completed','declined','disputed')),
  quality          numeric,
  challenger_delta int,
  opponent_delta   int,
  created_at       timestamptz default now(),
  completed_at     timestamptz
);

alter table public.matches enable row level security;
create policy "Matches are public"          on matches for select using (true);
create policy "Players create challenges"   on matches for insert with check (auth.uid() = challenger_id);
create policy "Participants update match"   on matches for update using (
  auth.uid() = challenger_id or auth.uid() = opponent_id
);


-- ── Elo History ──────────────────────────────────────
create table public.elo_history (
  id          uuid default uuid_generate_v4() primary key,
  profile_id  uuid references public.profiles(id) not null,
  rating      int  not null,
  match_id    uuid references public.matches(id),
  recorded_at timestamptz default now()
);

alter table public.elo_history enable row level security;
create policy "Elo history is public" on elo_history for select using (true);
create policy "System inserts elo"    on elo_history for insert with check (true);


-- ── Auto-create player row when profile is created ───
create or replace function public.handle_new_profile()
returns trigger as $$
begin
  insert into public.players (profile_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute procedure public.handle_new_profile();
