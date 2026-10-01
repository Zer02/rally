# Edge Functions

First Edge Functions in this project (v0.0.4.4). The first two power the
"add a player by name only, no email" flow for round robin.

- **create-placeholder-player** — ref/admin (league-level) adds a player
  by display name only. Creates a real `auth.users` row under a
  non-deliverable placeholder email, flags `profiles.is_placeholder`,
  enrolls them in the given league's `players`.
- **claim-placeholder-player** — global admin attaches a real email to a
  placeholder player later, clearing the flag. The frontend follows a
  successful claim with `supabase.auth.resetPasswordForEmail()` to send
  the "set your password" link.

Player accounts panel (v0.0.5.9), all global-admin only:

- **admin-account-info** — for a league, returns each player's account
  status (`name_only` / `invited` / `unconfirmed` / `active`), a *masked*
  email and last sign-in time. Never returns a full email.
- **admin-send-reset** — sends a password-reset email to an existing,
  confirmed account. The server looks up the address and sends the email,
  so the admin never sees it. Logs to `account_admin_log`.
- **admin-change-email** — replaces an existing player's email (typed
  twice), marks it confirmed, sends a reset link to the new address.
  Refused for admins, for the caller themselves, and for placeholder
  players. Logs to `account_admin_log` (masked emails only).
- **`_shared/accounts.ts`** — the shared helper: admin check, email
  masking, redirect validation, reset-email sending, audit logging.

## Deploy

```bash
# One-time, if not already linked
supabase link --project-ref <your-project-ref>

supabase functions deploy create-placeholder-player
supabase functions deploy claim-placeholder-player

# v0.0.5.9 — Player accounts panel
supabase functions deploy admin-account-info
supabase functions deploy admin-send-reset
supabase functions deploy admin-change-email
```

No extra secrets to set — both functions use the `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` env vars Supabase
injects into every Edge Function automatically.

## Before deploying

Run `supabase-migration-v0.0.4.4.sql` in the SQL Editor first — both
functions assume `profiles.is_placeholder` already exists.

For the three `admin-*` functions, also run `supabase-migration-v0.0.5.9.sql`
(creates `account_admin_log`, which they write to). The reset links they
send land on `/login`, so `https://<your-domain>/login` must be under
Authentication → URL Configuration → Redirect URLs (already required since
v0.0.4.6). Password emails only reach real players if a custom email
provider is set up under Authentication → SMTP; Supabase's built-in sender
is heavily rate-limited and only delivers to your own team members.
