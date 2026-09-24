-- supabase-migration-v0.0.4.4.sql
-- Run in Supabase SQL Editor after confirming v0.0.4.0 is applied.
--
-- Adds support for a ref/admin adding a player to the round robin by name
-- only, with no email up front. The placeholder is a REAL auth.users row
-- (created via the Admin API in the create-placeholder-player Edge
-- Function, not via this migration), flagged here so the rest of the app
-- can tell it apart from a normal signup. Everything else — players
-- enrollment, tournament_matches, RPCs, RLS — treats a placeholder
-- exactly like any other profile; nothing downstream needed to change.
--
-- Claiming (an admin later attaching a real email so the person can set
-- a password and log in) is handled by the claim-placeholder-player Edge
-- Function, which just updates auth.users directly via the Admin API —
-- no schema support needed for that half.

alter table public.profiles
  add column if not exists is_placeholder boolean not null default false;

comment on column public.profiles.is_placeholder is
  'True for a player added by name only via create-placeholder-player, until claim-placeholder-player attaches a real email.';
