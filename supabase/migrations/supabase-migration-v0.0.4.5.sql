-- supabase-migration-v0.0.4.5.sql
-- Run in Supabase SQL Editor after confirming v0.0.4.4 is applied.
--
-- Fixes a real gap in v0.0.4.4: claim-placeholder-player used to clear
-- profiles.is_placeholder the moment an admin SENT an invite, not when
-- the player actually finished setting a password. That meant a
-- mistyped email, or an invite the person just never got around to,
-- looked identical to a fully-activated account — the "send invite"
-- option just vanished, with no way to fix or resend.
--
-- is_placeholder now only clears once the person actually sets a
-- password (see useAuth.ts's updatePassword()). These two new columns
-- let admins see what was already sent and correct/resend it any time
-- before that happens.

alter table public.profiles
  add column if not exists invited_email text,
  add column if not exists invited_at timestamptz;

comment on column public.profiles.invited_email is
  'Last email an admin sent a claim invite to, via claim-placeholder-player. Null until the first invite.';
comment on column public.profiles.invited_at is
  'When invited_email was last sent. Updated on every resend, not just the first.';
