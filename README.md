# RALLY 🏓

> Current version: **v0.0.3.1**

Building-scale ping pong rating tracker. Vue 3 + Vite + Supabase. No SSR, no complexity — just a fast, clean app for ~20–50 players in a shared space.

---

## Changelog

### v0.0.1 — Initial build
- Vue 3 + Vite + Pinia + Vue Router scaffolded (no Nuxt — intentionally lightweight)
- `.gitignore` as first file — blocks `.env` and `dist/`
- TrueSkill-lite rating engine (`src/lib/rating.ts`): dynamic K-factor, uncertainty decay, streak bonus, match quality scoring
- Supabase schema: `profiles`, `players`, `matches`, `elo_history` with RLS policies
- Auto-creates `profiles` row on signup and `players` row on profile creation (two triggers)
- Auth: email/password signup with display name + unit number, persistent session via `useAuth` composable
- Router with auth guard — `/profile` and `/challenge` require login
- Pages: `/` (landing), `/login`, `/leaderboard`, `/matches`, `/profile`, `/player/:id`, `/challenge`
- Leaderboard with top-3 podium, full standings table, Challenge button per row
- Challenge flow: pick opponent → see points preview + match quality bar → send
- Match cards with accept/decline for pending, submit result for accepted
- Result modal: per-game score entry, auto-detects winner, supports multi-game matches
- Player profile page: stats, win rate, full match history with deltas
- My profile page: same but for logged-in user
- `PlayerAvatar` component: deterministic color palettes from name initials
- `TierBadge`: Rookie → Contender → Rival → Veteran → Champion

### v0.0.2 — Two-confirmation result system
> Everything works! (...mostly)
> Slight fix needed: when entering scores, if player 1 enters a score different from player 2 after player 2 finished submitting the score result, it will go to the player who entered the score last. This only works (I think) when both players are on the enter score page at the same exact time. More tests required to see if this is always true (i.e. both players get a chance to report their scores from their perspectives, maybe middleman admin can be flagged when players' scores do not match?)

- **Bug fixed:** last-write-wins score submission replaced with independent per-player reporting
- Each player submits their own version of the result independently after a match
- If both players report the same winner → match auto-completes and ratings update
- If players report different winners → match is flagged as `disputed` for admin review
- Matches view now shows three sections: disputed (needs resolution), needs your attention, waiting for opponent
- Admin dispute resolution: either player choice can be selected as canonical winner (proper role-based admin panel coming later)
- `ResultModal` now shows info banner explaining the two-confirmation flow
- `supabase-migration-v0.0.2.sql` added — run this in SQL Editor to add the new columns (safe, additive only)

### v0.0.2.1 — Score perspective fix, stale data fix, admin roles
> Leaderboard and profile scores don't update after submitting new matches 
> The matches should show scores when submitting and after submitted from the perspective of the player (if player 1 lost it should show as L 6-11, not 11-6 since that would be from winner's perspective)
> Finally, admin privileges are given to everyone? How should I fix this? Create an admin account and only give them access?

- **Bug fixed:** scores now always display from the viewer's perspective (W 9–6 not W 6–9)
- **Bug fixed:** leaderboard and profile ratings now update immediately after match completion — both stores refresh in parallel after `finalise()`
- **Bug fixed:** player data re-fetched fresh before Elo calculation to avoid stale ratings being used
- **Admin system:** `is_admin` boolean added to `profiles` table
- Dispute resolution UI now only visible to admins — regular players see a passive notice instead
- `useAuth` now loads full profile on session start, exposes `isAdmin` computed
- `supabase-migration-v0.0.3.sql` — run this and replace `YOUR_EMAIL_HERE` with your email to grant yourself admin

### v0.0.2.2 — Leaderboard and profile scores still not updating
> Leaderboard and profile scores still not updating after match completion without a page refresh

- Running on v0.0.2 codebase with v0.0.2.1 patch prepared but not yet applied
- Confirmed working: signup, login, challenge flow, two-confirmation result submission, email confirmation disable
- **Known issue:** scores display from challenger perspective instead of viewer's
- **Known issue:** leaderboard and profile don't reflect new match results without manual page refresh
- **Known issue:** dispute resolution visible to all users instead of admin only
- Pending: apply v0.0.2.1 patch + realtime subscriptions (v0.0.3+) to resolve all three

### v0.0.2.3 — Root cause fix for Elo/W-L not updating, score mismatch dispute check, realtime subscriptions
> Applied the v0.0.2.1 patch and dug into why Elo/W-L still weren't updating — turned out `finalise()` in `matches.ts` was reading from the players store, but that store was never populated on the matches page, so it silently failed every time. Separately found that if both players agreed on the winner but reported different scores, the match auto-completed anyway instead of flagging for review.

- **Bug fixed:** root cause of Elo/W-L not updating — `finalise()` now fetches player rows directly from Supabase instead of relying on the (unpopulated) players store
- **Bug fixed:** matches where both players agree on the winner but report different scores now correctly go to `disputed` instead of silently auto-completing
- Disputed match cards now show *why* a match was flagged — different winner reported vs. same winner but mismatched scores
- Realtime subscriptions (`subscribe()` / `unsubscribe()`) added to both `players` and `matches` stores
- `MatchesView` loads both stores on mount so player data is always available before a result is finalized
- `LeaderboardView` and `ProfileView` subscribe on mount, unsubscribe on unmount
- Score perspective fix carried over and confirmed working — always shows viewer's score first
- Error toast added to `MatchesView` so silent failures surface visibly instead of failing quietly
- Admin gate confirmed on dispute resolution — only `is_admin = true` profiles see resolve buttons
- `tsconfig.json` fixed with `"types": ["vite/client"]` and `"moduleResolution": "bundler"`
- Requires running in Supabase SQL Editor: `alter publication supabase_realtime add table public.players;` and the same for `public.matches`
---

### v0.0.2.4 — Players table (rating, streak, season W-L) not syncing after match completion
> Matches tab shows all matches with correct scores and per-match deltas, but the leaderboard and profile "top" stats (rating, season W-L) are stuck after the very first match, even though way more matches have been played and completed.

- **Bug fixed:** root cause was `finalise()` updating the winner's and loser's `players` rows directly from the client — whichever player didn't trigger the finalization had their row silently rejected by RLS (Supabase doesn't throw on an RLS-blocked update, it just affects 0 rows), so rating/streak/season W-L only ever moved on the very first match
- New Postgres function `finalize_match()` (`SECURITY DEFINER`) does the match update, both players' stat updates, and the `elo_history` insert atomically, server-side — no longer subject to either player's individual RLS permissions
- `finalise()` now calls this via a single `supabase.rpc('finalize_match', ...)` instead of three separate client-side writes
- All Supabase calls in `matches.ts` now check their `error` result and throw instead of failing silently — future permission/write issues will surface in the error toast instead of hiding
- `supabase-migration-v0.0.2.4.sql` added — run this in SQL Editor to create the function and grant execute to authenticated users
---

### v0.0.2.5 — Lock down finalize_match before real launch
> Asked if it was ready to open up to the club — realized the finalize_match RPC from v0.0.2.4 trusted whatever values the client sent with no check on who was calling it, so any logged-in user could call it directly with made-up ratings.

- **Security fix:** `finalize_match()` now verifies the caller is the winner, the loser, or an admin before writing anything — raises an exception otherwise
- `finalize_match()` also now verifies the match exists, isn't already completed, and that the winner/loser IDs actually belong to that match before writing
- `supabase-migration-v0.0.2.5.sql` added — run this to replace the function from v0.0.2.4 with the hardened version
- `reset-for-launch.sql` added — one-time operational script (not an app migration) to wipe test match/rating history and reset every player back to a clean starting state before opening the app to the real club
---

### v0.0.2.6 — RLS was row-level only, not column-level — locked down direct table writes
> Asked what we needed to check before launch — reviewed the original supabase-schema.sql RLS policies directly instead of assuming they were fine.

- **Security fix:** `matches` UPDATE policy only restricted which rows a participant could touch, not which columns — either player could previously write directly to `status`/`winner_id`/`quality`/deltas/`completed_at`/the other player's report fields, bypassing `finalize_match()` entirely. Added a `BEFORE UPDATE` trigger (`enforce_match_update_rules`) enforcing: completion fields are off-limits outside `finalize_match()`, only the invited opponent can accept/decline, and each side can only write their own report fields
- **Security fix:** dropped `"Users update own player"` policy on `players` — allowed a user to write their own `rating` directly with no match required. All legitimate rating changes now go exclusively through `finalize_match()` (`SECURITY DEFINER`, bypasses RLS)
- Dropped `"System inserts players"` and `"System inserts elo"` policies (both `with check (true)`, unrestricted insert) — unnecessary, since both auto-create paths already run as `SECURITY DEFINER` and bypass RLS
- `finalize_match()` updated to set a local `rally.internal_write` flag before writing, so the new matches trigger lets its own writes through without re-litigating what it already validated
- `supabase-migration-v0.0.2.6.sql` added — run this to apply all of the above
---

### v0.0.2.7 — Dispute resolution could produce a winner and score from different reports
> Admin resolved a score-typo dispute (both players agreed on the winner, scores differed slightly) by clicking the other player's name — resulting match showed that player as the winner with a score where they scored fewer points than their opponent.

- **Bug fixed:** `resolveDispute()` previously took just a `winnerId` and `finalise()` derived the score independently based on whether that winner was the challenger or opponent — meaning an admin could end up combining one player's reported *winner* with the other player's reported *score*, producing an internally contradictory match. Admin resolution now passes which player's **entire report** (winner + score together) to trust, guaranteeing they always come from the same original submission
- Dispute cards now show *why* a match was flagged — different winner reported vs. same winner but mismatched scores — so the admin knows which case they're resolving
- Resolve buttons reworded to "Use [player]'s report" instead of "[player] wins", to make clear the admin is picking a whole submission, not independently choosing a winner
- No new SQL required — this was a client-side logic fix only
---

### v0.0.2.8 — Head-to-head + rating history chart
> Followed the roadmap: head-to-head record and rating-over-time chart on player profiles, plus finishing the mobile leaderboard card-list layout that was left incomplete during the earlier mobile styling pass.

- New `RatingChart.vue` component — hand-rolled SVG sparkline (no new dependency), colored green/red based on whether rating is up or down since the chart's start, with a dashed baseline at the starting rating
- Rating history chart added to both `ProfileView.vue` (your own trend) and `PlayerView.vue` (any player's trend), pulling directly from `elo_history`
- Head-to-head record added to `PlayerView.vue` — shown only when logged in and viewing someone else ("You lead 3–1 all-time vs. Roger"), computed from existing `matches` data, no new queries needed
- Finished the leaderboard mobile card list from the earlier styling pass — the `.leaderboard-cards`/`.lb-card`/etc. CSS was never actually written; it's now in place with a clean mobile/desktop toggle at the existing 600px breakpoint
- Checked off "Rating history chart" and "Head-to-head records" in the roadmap below
---

### v0.0.2.9 — Referee page was broken since introduction; season reset
> `RefereeView.vue` called `matches.recordAsAdmin()`, which didn't actually exist anywhere in `matches.ts` — the Referee page has been non-functional since it was first added. Implemented it, and added the season-reset tool that was still missing from the admin flow.

- **Bug fixed:** added `recordAsAdmin()` to `matches.ts` — inserts a match directly (Player A as challenger, Player B as opponent, purely for score bookkeeping) and reuses the existing `finalise()` path, so it goes through the same `finalize_match` RPC and rating math as every other match
- Depends on the "Admins create matches for anyone" insert policy (v0.0.2.7) already being applied — no new RLS changes needed for this part
- Added `reset_season()` RPC (admin-gated server-side) and a "Season tools" section on `RefereeView.vue` to zero out season W-L for every player without touching career totals or rating
- `supabase-migration-v0.0.2.9.sql` added — run this in SQL Editor to create `reset_season()` and grant execute to authenticated users
---

### v0.0.2.10 — Season history + season dropdown on Leaderboard/Profile
> Asked for a way to see a player's record from a past season, not just the current one. `reset_season()` was previously destructive — it zeroed season_wins/season_losses with no record of what they'd been. Added actual season history so past seasons aren't lost the next time someone hits reset.

- New `seasons` table (one row per season; the row with `ended_at IS NULL` is the one in progress) and `season_records` table (archived per-player W-L, written once at reset time)
- `reset_season()` now archives every player's current season_wins/season_losses into `season_records` before zeroing them, closes out the active season, and opens the next one — instead of just wiping the numbers
- New `useSeasonsStore` (`src/stores/seasons.ts`) — fetches the season list and caches archived records per season on demand
- Leaderboard and Profile pages both got a "Season" dropdown: "Current season" reads live from `players.*` as always; past seasons pull from `season_records`. Ranking/sort order is unaffected — only the W-L figure shown changes, since rating itself was never season-scoped
- A player who joined after a given season closed shows "—" for that season rather than 0–0
- **Note:** this only starts tracking from now — any seasons reset before this migration ran are unrecoverable, since they were never archived
- `supabase-migration-v0.0.2.10.sql` added — run this in SQL Editor to create the two new tables and replace `reset_season()`
---

### v0.0.3.0 — Multi-league foundation: schema + league switcher
> First step of the multi-sport/multi-league expansion. Leagues are opt-in, admin is per-league, and the old single-league app becomes one seeded "Table Tennis" league so nothing existing breaks. This version lands the schema and the nav switcher UI — the leaderboard, matches, challenge, profile, and referee pages do NOT filter by league yet, that's the next chunk of work (v0.0.3.1+).

- New `leagues` table and `league_admins` join table; `players`, `matches`, and `elo_history` all gain a `league_id` column
- `players`' unique constraint changes from `unique(profile_id)` to `unique(profile_id, league_id)` — one stats row per player per league now, instead of one per player total
- New `is_league_admin(league_id)` helper (super-admin OR admin of that specific league) replaces the raw `is_admin` checks inside `finalize_match()` and `reset_season()`
- New `create_league()` RPC — any authenticated user can spin up a league and becomes its first admin + first member automatically
- Joining a league is now an explicit action (`players` insert policy checks `auth.uid() = profile_id`) — the old auto-create-player-on-signup trigger is retired
- New `useLeagueStore` (`src/stores/leagues.ts`) — tracks the leagues you've joined, which ones you can still join, and which one is currently selected (persisted to `localStorage`)
- `AppNav.vue` reworked: the 🏓 emoji is no longer baked into the "RALLY" wordmark — it's now a standalone circular button showing your **current league's** icon. Click it for a dropdown: switch between leagues you've joined, join an existing one, or create a new one (name + sport slug + emoji icon)
- **Known gap, by design:** switching leagues in the dropdown changes `currentLeagueId` but nothing reads it yet — Leaderboard/Matches/Challenge/Profile/PlayerView/Referee all still show the single seeded "Table Tennis" league's data regardless of selection. That threading is the next version.
- `supabase-migration-v0.0.3.0.sql` added — run this in SQL Editor before deploying the frontend changes, since `AppNav.vue` now queries the `leagues` table on mount
---

### v0.0.3.1 — League switching actually does something now
> The switcher from v0.0.3.0 changed `currentLeagueId` but nothing read it — Leaderboard/Matches/Profile/Challenge/PlayerView/Referee all kept showing the seeded Table Tennis league no matter what was selected. Not a Supabase problem and no new tables needed for this part — the `league_id` columns were already there from v0.0.3.0, they just weren't being used anywhere yet.

- `players.ts` and `matches.ts` fetches now filter by `league_id` from the new `useLeagueStore`, instead of pulling every league's rows into one list
- **Real bug caught along the way:** `matches.league_id` is `NOT NULL` as of v0.0.3.0, but `challenge()` and `recordAsAdmin()` were still inserting matches without it — any new challenge or admin-recorded match would have started failing outright the moment v0.0.3.0 was deployed. Fixed both insert calls.
- New `onLeagueChange()` composable (`src/composables/useLeagueWatch.ts`) — every page that shows league-scoped data now re-fetches automatically when the nav switcher changes leagues, instead of only updating on the next full page load
- `seasons`/`season_records` (from v0.0.2.10) are now per-league too — they were still global, which didn't make sense once matches and ratings became per-league. `reset_season()` is rewritten to do archiving AND per-league scoping together (the v0.0.3.0 draft had accidentally dropped the archiving step when it added league scoping)
- `create_league()` now also opens that league's first season immediately, instead of only creating one on the first reset
- Profile page now tells you plainly if you haven't joined the currently-selected league, instead of spinning forever waiting for a player row that doesn't exist
- `supabase-migration-v0.0.3.1.sql` added — run this after v0.0.3.0. It no longer requires v0.0.2.10 to have been run first — it creates `seasons`/`season_records` itself if they don't already exist
---

## Quick start

### 1. Supabase setup
- Create a project at supabase.com
- Run `supabase-schema.sql` in **SQL Editor**
- Copy from **Settings → API**: Project URL + Publishable key

### 2. Environment
```bash
cp .env.example .env
# Fill in:
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_KEY=your-publishable-key
```

### 3. Install & run
```bash
npm install
npm run dev
```
Requires Node >= 20.19.0

---

## Project structure

```
rally/
├── .gitignore
├── .env.example
├── index.html
├── vite.config.ts
├── supabase-schema.sql
└── src/
    ├── main.ts
    ├── App.vue
    ├── assets/main.css          # global design system
    ├── composables/
    │   └── useAuth.ts           # session management
    ├── lib/
    │   ├── supabase.ts          # supabase client
    │   └── rating.ts            # TrueSkill-lite engine
    ├── router/index.ts
    ├── stores/
    │   ├── players.ts
    │   ├── matches.ts
    │   ├── seasons.ts
    │   └── leagues.ts
    ├── types/index.ts
    ├── components/
    │   ├── layout/AppNav.vue
    │   ├── ui/
    │   │   ├── TierBadge.vue
    │   │   └── PlayerAvatar.vue
    │   └── match/
    │       ├── MatchCard.vue
    │       └── ResultModal.vue
    └── views/
        ├── HomeView.vue
        ├── LoginView.vue
        ├── LeaderboardView.vue
        ├── MatchesView.vue
        ├── ChallengeView.vue
        ├── ProfileView.vue
        └── PlayerView.vue
```

---

## How ratings work

- Base rating: **1000**
- K-factor scales with `uncertainty` — new players move faster, stabilises after ~15 matches
- Streak modifier: up to +30% K boost on hot streaks (3+ in a row)
- Match quality: `max(0, 1 - |r1-r2| / 600)` — shown on challenge screen, affects nothing mechanically
- Tiers: Rookie (0) → Contender (900) → Rival (1000) → Veteran (1100) → Champion (1200+)

---

## What's next

- [x] Rating history chart on player profiles
- [ ] Push/email notifications for incoming challenges
- [ ] Admin: season reset, dispute resolution
- [x] Head-to-head records between two players
- [ ] Weekly digest (most active player, biggest rating swing)
