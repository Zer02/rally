-- RALLY migration v0.0.3
-- Run in Supabase → SQL Editor

-- 1. Add is_admin flag to profiles
alter table public.profiles
  add column if not exists is_admin boolean default false;

-- 2. Grant yourself admin — replace with your actual email
update public.profiles
set is_admin = true
where id = (
  select id from auth.users where email = 'YOUR_EMAIL_HERE'
);

-- 3. RLS policy: only admins can resolve disputes
create policy "Admins can update any match"
  on public.matches for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );
