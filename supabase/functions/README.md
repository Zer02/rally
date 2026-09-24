# Edge Functions

First Edge Functions in this project (v0.0.4.4). Both power the
"add a player by name only, no email" flow for round robin.

- **create-placeholder-player** — ref/admin (league-level) adds a player
  by display name only. Creates a real `auth.users` row under a
  non-deliverable placeholder email, flags `profiles.is_placeholder`,
  enrolls them in the given league's `players`.
- **claim-placeholder-player** — global admin attaches a real email to a
  placeholder player later, clearing the flag. The frontend follows a
  successful claim with `supabase.auth.resetPasswordForEmail()` to send
  the "set your password" link.

## Deploy

```bash
# One-time, if not already linked
supabase link --project-ref <your-project-ref>

supabase functions deploy create-placeholder-player
supabase functions deploy claim-placeholder-player
```

No extra secrets to set — both functions use the `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` env vars Supabase
injects into every Edge Function automatically.

## Before deploying

Run `supabase-migration-v0.0.4.4.sql` in the SQL Editor first — both
functions assume `profiles.is_placeholder` already exists.
