-- supabase-migration-v0.0.5.9.sql
-- Run in the Supabase SQL Editor after confirming v0.0.4.5 is applied
-- (profiles.is_placeholder / invited_email / invited_at must exist).
--
-- Audit log for the Player accounts panel on the Round Robin page.
-- Every password reset an admin sends, and every email change, writes one
-- row here from the Edge Functions (service role). Global admins can read
-- it; nobody can write to it from the browser.
--
-- Emails are stored MASKED (j***@g***.com), never in full: the log answers
-- "who changed what and when" without becoming a second copy of everyone's
-- address.

create table if not exists public.account_admin_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  target_id   uuid references public.profiles(id) on delete set null,
  target_name text,
  action      text not null check (action in ('send_reset', 'change_email')),
  detail      jsonb not null default '{}'::jsonb
);

comment on table public.account_admin_log is
  'Who sent a password reset / changed an email for whom, and when. Written only by Edge Functions; names are snapshots so rows stay readable after a profile is deleted.';

create index if not exists account_admin_log_created_idx
  on public.account_admin_log (created_at desc);

alter table public.account_admin_log enable row level security;

drop policy if exists "Global admins read account log" on public.account_admin_log;
create policy "Global admins read account log"
  on public.account_admin_log for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ));

-- No insert/update/delete policies on purpose: only the service role
-- (Edge Functions) can write, and nothing can rewrite history.
revoke insert, update, delete on public.account_admin_log from anon, authenticated;
