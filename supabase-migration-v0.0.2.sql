-- RALLY migration v0.0.2
-- Two-confirmation result system
-- Run in Supabase → SQL Editor

alter table public.matches
  add column if not exists challenger_reported_winner uuid references public.profiles(id),
  add column if not exists challenger_reported_score  text,
  add column if not exists opponent_reported_winner   uuid references public.profiles(id),
  add column if not exists opponent_reported_score    text;
