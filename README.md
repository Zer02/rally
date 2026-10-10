# RALLY 🏓

> Current version: **v0.0.6.9**

Building-scale ping pong rating tracker. Vue 3 + Vite + Supabase. No SSR, no complexity — just a fast, clean app for ~20–50 players in a shared space.

---

## Changelog

### v0.0.1 — Initial build
- Vue 3 + Vite + Pinia + Vue Router scaffolded (no Nuxt — intentionally lightweight)
- `.gitignore` as first file — blocks `.env` and `dist/`
- TrueSkill-lite rating engine (`src/lib/rating.ts`): dynamic K-factor, uncertainty decay, streak bonus, match quality scoring
- Supabase schema: `profiles`, `players`, `matches`, `elo_history` with RLS policies
- Auto-creates `profiles` row on signup and `players` row on profile creation (two triggers)
- Auth: email/password signup with display name, persistent session via `useAuth` composable
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

### v0.0.3.2 — Round robin, part 1: schema + pairing + reporting
> First slice of the round-robin/end-of-season tournament feature, designed together before writing anything: single game to 11 per match, kept fully separate from the regular ladder rating, everyone advances to an end-of-season bracket. This version covers schema + generating the pairing schedule + reporting scores. Does NOT yet include: the strength-of-schedule adjusted ranking (needs the whole round robin finished first) or the bracket itself — both are next.

- New `tournaments`, `tournament_participants`, and `tournament_matches` tables, scoped to a league. Deliberately untouched: `players.rating`, `matches`, `finalize_match()` — a tournament match reported here has zero effect on the everyday ladder
- `create_tournament()` RPC (league-admin only) — enrolls every current player in the league and generates the full round-robin pairing list (every unique pair, once each) in one shot
- `report_tournament_match()` RPC — either player in the match, or a league admin, can report the single-game score; no accept/dispute flow needed for a one-line score
- New `useTournamentsStore` and `/tournament` page — shows live (provisional) standings sorted by wins then point differential, a "Your matches" section to report your own games, and an admin-only override section for anyone else's pending match
- Added "Round Robin" to the nav, visible to everyone (like Leaderboard/Matches) since viewing standings doesn't require being signed in
- **Known gap, by design:** standings shown right now are provisional — wins and raw point differential only. The final strength-of-schedule-adjusted ranking (`adjusted_score`) and the bracket generation are the next version, since the adjustment can only be computed once every round-robin match is actually in
- `supabase-migration-v0.0.3.2.sql` added

### v0.0.3.3 — Round robin becomes a weekly recurring season, plus ladder-style challenges
> v0.0.3.2 built round robin as a one-shot tournament — `create_tournament()` enrolled the whole league and generated every pairing immediately, with no way to add matches later. That's not actually how this gets played: it's a weekly recurring round robin where attendance varies week to week and standings build up over a season. Reworked accordingly, and added a challenge mechanic so someone who's fallen behind (or just joined) has a way to climb without a full head-to-head catch-up.

- `tournaments` is now a season shell — `create_tournament()` just creates the row, no pairings generated at creation
- New `tournament_weeks` table + `start_tournament_week()` RPC (admin-only) — pick that week's attendees, generates one round-robin match per unique pair among just that group. First time a player shows up in any week, they're auto-enrolled at 0-0 — **no catch-up matches are generated for weeks they missed, by design**
- `wins`/`losses`/`points_for`/`points_against` stay cumulative across the whole season, same columns as v0.0.3.2
- New ladder-style challenges: `create_challenge()` RPC lets a player challenge anyone **currently ranked above them** (by wins, then point differential), capped at **one challenge per player per week**. New `bonus_points` column on `tournament_participants` — winning a challenge adds to it and does **not** touch wins/losses/points_for/points_against, so it can never be mistaken for a real match result
- `report_tournament_match()` now branches on match phase — round-robin matches work exactly as before, challenge matches only ever update the winner's `bonus_points`
- New `finalize_tournament()` RPC (admin-only) — computes the strength-of-schedule adjusted score from round-robin matches only (challenges don't have real match differentials, so they're deliberately excluded from that weighting), adds `bonus_points` as a flat top-up on top, assigns final seeds, and locks the season
- `useTournamentsStore` rewritten: `weeks`, `currentWeek`, `startWeek()`, `createChallenge()`, `canChallenge()`, `finalizeTournament()` added; `standings` sort unchanged (wins, then point diff) and doubles as the same ranking `create_challenge()` uses server-side to decide who's eligible to be challenged
- **Not in this version yet:** `TournamentView.vue` UI for starting a week, picking attendees, and issuing challenges — schema + store only this pass, page updates are next
- `supabase-migration-v0.0.3.3.sql` added — run after v0.0.3.2

### v0.0.3.4 — Rally is the multi-sport platform now; court queue for live events
> SPIN and Rally are the same product going forward — no separate app, no separate rating/match/season system. Leagues already carry a generic `sport` slug and match scores are stored as free text, so a new sport is just a new `leagues` row, reusing round robin, standings, and challenges as-is. The one real gap for an in-person multi-court event (a tennis club's weekly round robin, 4-5 courts): nothing tracked which physical court a match was on. Prioritized this over the double-elimination bracket work given a real 6-week deadline — bracket is for end of season, this isn't.

- `tournament_matches` gets a `court` column, a `started_at` timestamp, and a new `'in_progress'` status
- New `call_match_to_court()` RPC (admin-only) — moves a pending match to whichever court just opened up. No auto-scheduler by design: courts are assigned by availability, not a fixed plan
- New `uncall_match()` RPC (admin-only) — reverts a mis-called match back to pending
- `leagues` gets an optional `court_count` (display only, e.g. "Courts 1-5" — not enforced server-side so it can change week to week)
- `useTournamentsStore`: `inProgressMatches`, `courtsInUse` (court number → current match), `callToCourt()`, `uncallMatch()` added
- **Design decision:** result entry stays organizer/referee-only for this use case — `report_tournament_match()` already permits league admins, so no backend change was needed, but the event UI won't expose self-report to players the way the ping pong flow does. Worth confirming this is right before the UI ships
- **Not in this version yet:** the actual event page UI (court board, mobile match card, result entry) — schema + store only this pass
- `supabase-migration-v0.0.3.4.sql` added — run after v0.0.3.3

### v0.0.3.5 — Round robin was unplayable past creation; weekly UI ships (superseded below)
> Cloned the repo fresh and found the real bug: `create_tournament()` has created an empty season shell since v0.0.3.3, but `TournamentView.vue` was still the old v0.0.3.2 one-shot page — no button anywhere to start a week, pick attendees, issue a challenge, or call a match to a court. Also found `supabase-migration-v0.0.3.4.sql` was never actually committed despite the v0.0.3.4 entry above and the last handoff both describing it as shipped.

- **Bug fixed:** the actual blocker — round robin had no working path past season creation. Rewrote `TournamentView.vue`
- `supabase-migration-v0.0.3.4.sql` **written and committed for real this time**
- New `AttendeePicker.vue` — admin picks who showed up, calls `startWeek()`
- Added challenge UI (`ChallengePanel.vue`) and a court-calling UI (`CourtBoard.vue`) on top of the existing backend for both — **removed again one version later, see v0.0.3.6**
- **Bug fixed:** `src/router/index.ts` had the `/tournament` route registered twice — removed the duplicate

### v0.0.3.6 — Simplified: page had too many inputs at once, cut it back down
> The v0.0.3.5 page put start-week, challenges, and court-calling all on screen together — too many inputs competing for attention on what's supposed to be a quick "enter the score" page. Courts don't need explicit selection either: it's always the same fixed set of physical courts at the venue, players just walk to whichever one's open, so tracking *which* court in software was unnecessary complexity for zero benefit.

- **Removed from the page:** the challenge system (no more Challenge panel/buttons) and court selection (no more call-to-court queue, court number inputs, or court grid). `TournamentView.vue` is back to: standings → start week → your matches (self-report) → admin override → completed → finalize season
- Deleted `ChallengePanel.vue` and `CourtBoard.vue` — if you already applied v0.0.3.5, delete these two files from `src/components/tournament/`
- Standings table drops the `Bonus` column (nothing produces bonus points anymore since challenges aren't created)
- **Not deleted:** the underlying schema and RPCs (`create_challenge()`, `call_match_to_court()`, `uncall_match()`, `tournament_matches.court`/`started_at`/`in_progress`, `tournament_participants.bonus_points`) — left in place and simply unused rather than torn out via another migration. `finalize_tournament()` still adds `bonus_points` as a top-up, which will just always be 0 now. No new SQL for this version
- No new `supabase-migration` file — this was a client-side-only simplification

### v0.0.3.7 — Smart weekly pairing, instead of a full round robin nobody could finish
> `start_tournament_week()` generated every unique pairing among that week's attendees — 9 people showed up, it made 36 matches, way more than a 2-hour session can play. Replaced it with a pairing algorithm that targets a fixed number of matches per attendee instead (a 2-hour session tends to fit 4-6), pairing people by closeness in current form rather than brute-force combinatorics. Also added `reset-round-robin.sql` for clearing test/season data.

- **New:** `tournament_participants.rr_rating` — a standard Elo (K=32, starts at 1000), updated after every completed round-robin match. Deliberately separate from `players.rating` (the main ladder's TrueSkill-lite system) — round robin pairing should reflect round-robin form specifically, not the regular ladder
- **Rewrote `start_tournament_week()`:** now takes `p_target_matches` (admin sets it when starting the week, e.g. 5). Ranks that week's attendees by a blend of season points (points_for − points_against) and `rr_rating`, then pairs round-by-round, closest-ranked-available first. Season rematches are skipped unless a player has already played every other attendee present that week — at that point repeats are allowed rather than sitting someone out. Small groups will naturally cap below the target once they run out of distinct opponents for the session — that's expected, not a bug
- `report_tournament_match()` updated to maintain `rr_rating` — same function, same self-report/admin-override auth, just an added Elo update on top of the existing wins/losses/points bookkeeping for round-robin (non-challenge) matches
- `AttendeePicker.vue` gets a "Target matches per player" field (defaults to 5) alongside the attendee checklist
- New `reset-round-robin.sql` — one-time operational script (not a migration) to clear a season or a whole league's round robin history, same pattern as `reset-for-launch.sql`
- Tested the new pairing function directly against a local Postgres instance seeded with a 9-player and a 3-player group before shipping — confirmed: no duplicate same-week pairings, no season rematches until the exhaustion condition is actually met, and rr_rating correctly diverges from raw win count based on opponent strength
- `supabase-migration-v0.0.3.7.sql` added — run after v0.0.3.4 (v0.0.3.5/3.6 added no SQL, safe to skip straight from 3.4 to 3.7)

### v0.0.3.8 — Finalize doesn't delete anything; it just had nowhere to show up
> Traced "finalize deletes everything" to the actual RPC first: it doesn't delete a thing — it only sets `tournaments.status = 'completed'` and writes `adjusted_score`/`seed` onto rows that already existed. The real bug: `fetchActive()` filters out completed tournaments, and there was no view anywhere that showed one. A finalized season's data was always intact, just permanently unreachable from the UI. Separately, true gap: round robin results never touched `players` at all — a season's outcome lived only inside `tournament_participants`, completely disconnected from a player's record. Both fixed this pass, no data was ever at risk.

- **New:** `players.rr_titles`, `players.rr_best_finish`, `players.rr_seasons_played` — career round-robin stats, scoped per league same as `career_wins`/`season_wins`. `rr_best_finish` stays null until a player's finished at least one season (0 would wrongly read as "finished 0th")
- `finalize_tournament()` now writes those three columns for every participant, reading the seed it just computed rather than recomputing it — same function, same admin-only auth, one more update at the end
- New `PastSeasonsPanel.vue` — collapsible, sits at the top of the Round Robin page always (active season or not). Lists every finalized season for the league; click one to expand its final standings (seed, W–L, adjusted score). This is the direct fix for "finalize deletes everything" — the season you just finalized shows up here immediately
- ProfileView gets a "Round Robin" card — titles / best finish / seasons played, plus a table of every season you've finished with your seed and record. Only shows once `rr_seasons_played > 0`, so it stays out of the way for anyone who's never played round robin
- New `fetchPastSeasons()`, `fetchSeasonStandings()`, `fetchProfileRoundRobinHistory()` on the tournaments store
- Validated `finalize_tournament()` against a local Postgres instance before shipping: ran two seasons back to back with different winners, confirmed `rr_titles`/`rr_best_finish`/`rr_seasons_played` accumulate correctly across seasons rather than overwriting (best finish takes the minimum seed ever, titles only increment on an actual 1st)
- `supabase-migration-v0.0.3.8.sql` added — run after v0.0.3.7

### v0.0.3.9 — Manual add/remove for matches, since old pending ones were piling up with no way to clear them
> Screenshot showed the same few players (one especially) with a wall of repeated pending matches — that's expected given the design: a week's pairings that never get played just sit as 'pending' forever, and nothing ever cleared them. Added the two direct controls rather than any auto-expiry: admin can add a one-off match to the current week, and remove any match that's never going to be played.

- New `add_tournament_match(p_tournament_id, p_player_a_id, p_player_b_id)` — admin-only, attaches to the most recently started week, auto-enrolls either player if needed. Doesn't check for an existing pairing this week on purpose — it's also how you'd add a rematch deliberately
- New `cancel_tournament_match(p_match_id)` — admin-only, deletes a match outright. Only allowed on `pending`/`in_progress` — refuses on `completed`, since that's a real result, not something lingering. Safe to hard-delete: a pending/in_progress match has never been counted in anyone's wins/losses/points/rr_rating, only `report_tournament_match()` on completion does that
- New `AddMatchForm.vue` — "Add a match" button next to "Start week", only shown once a week exists (the RPC requires one). Two player dropdowns, sourced from the league's player list same as the attendee picker
- `MatchScoreRow.vue` gets an optional `onRemove` prop — when passed, shows a "Remove" button next to Report/Override with a confirm prompt. Wired in for admins on both "Your matches" and "Other pending matches"
- Validated both RPCs against a local Postgres instance before shipping: confirmed `add_tournament_match` refuses before a week exists and refuses a self-match, and `cancel_tournament_match` deletes a pending match but correctly refuses once that same match is completed
- `supabase-migration-v0.0.3.9.sql` added — run after v0.0.3.8

### v0.0.3.10 — Auto-clear unplayed matches when a new week starts
> The v0.0.3.9 remove button worked but put the cleanup on the admin every single week. Moved it into `start_tournament_week()` itself: starting a new week now deletes anything still `pending`/`in_progress` from before, automatically. `cancel_tournament_match()` and the manual "Remove" button from v0.0.3.9 are unchanged and still there for trimming mid-week if wanted.

- `start_tournament_week()`: one delete statement added right after the new week is created, before pairing — clears every leftover `pending`/`in_progress` match tournament-wide. `completed` matches are never touched, so nothing already played is at risk
- `AttendeePicker.vue` copy updated to say this out loud before the admin hits the button — starting a week is now a point of no return for whatever didn't get played
- Validated against a local Postgres instance: started a week, completed one match, left two pending, started a second week, confirmed the completed one survived and the two pending ones were gone
- `supabase-migration-v0.0.3.10.sql` added — run after v0.0.3.9

### v0.0.3.11 — Differential is out of the tiebreak entirely
> Format's now no-ad, first-to-4-games sets. Confirmed the redesign in dialogue first: wins stays the primary ranking everywhere, the tiebreak changes from point differential to total games won (points_for). Rationale for total games over differential: with short sets, a 4-3 loss and a 4-0 loss shouldn't tiebreak the same way a differential system would treat them — total games rewards playing close matches instead of rewarding blowouts.

- `finalize_tournament()` simplified a lot along with this — the old strength-of-schedule-weighted-differential formula (`0.75 + opponent_win_rate × 0.75` multiplier) is gone entirely. Final seed is now `wins desc, then (points_for + bonus_points) desc` — same ordering as the live standings, no opponent-strength weighting. `adjusted_score` keeps its name and job (still "the number used to seed"), just computed more simply
- `create_challenge()`'s "only challenge someone ranked above you" check updated to the same new ordering, for consistency — challenges are still unused in the UI as of v0.0.3.6, but the dormant RPC stays correct in case that changes later
- Live standings sort (client-side, in the tournaments store) updated to match: wins, then points_for
- `PastSeasonsPanel.vue`'s "Adjusted" column renamed to "Points," since it's no longer a weighted differential
- Validated with a deliberately adversarial test case against a local Postgres instance: two players with identical wins (2) and identical points_for (8), but wildly different differential (+7 vs -2) — confirmed they now tie exactly (`adjusted_score` both 8) where the old formula would have ranked them apart
- Not changed: no score-format validation was added (e.g. enforcing that a submitted score is a legal first-to-4 no-ad result) — scores are still just two numbers that can't tie. Flagging in case that's wanted next, but it wasn't asked for this pass and seemed like scope worth confirming separately
- `supabase-migration-v0.0.3.11.sql` added — run after v0.0.3.10

### v0.0.4.0 — Doubles support + smart court generator
> New versioning convention as of this entry: past .9 rolls to the next minor (v0.0.3.9 → v0.0.4.0), not .10. Doubles never existed in the schema at all before this — `tournament_matches` only ever had two player slots. Confirmed three design points before touching anything: doubles results count toward the season (same wins/losses/rr_rating as singles), doubles teams balance strongest+weakest vs. the middle two, and the generator attaches to the current week rather than inventing its own structure.

- **Schema:** `tournament_matches` gets `format` (`'singles'`/`'doubles'`), `player_a2_id`, `player_b2_id` — nullable, unused for singles
- **New `generate_court_matches(p_tournament_id, p_attendee_ids, p_court_count)`:** given who's here and how many courts are free, computes the best (doubles, singles) split — maximizing players on court first, then courts used. Benches the fewest people possible, prioritizing whoever's played the fewest matches this season (so a brand-new attendee plays before someone benched for a second round). Groups the rest by current blended strength (points + rr_rating), forms doubles foursomes from the top of that order, balances each as strongest+weakest vs. the middle two, then singles pairs from what's left. Attaches to the current week without creating a new one, so it's meant to be re-run for "next round" as many times as a session needs — ratings and match counts shift after every completed match, so a re-run naturally produces a different mix with no artificial randomization
- `report_tournament_match()` now branches on format: a doubles result applies identically to both players on a side (wins/losses/points_for/points_against), and `rr_rating` uses a standard simplified team-Elo — each side's rating is the average of its two players, the Elo delta computed once from those averages and applied identically to both. Singles is unaffected (mathematically the same formula, one-player "team")
- `add_tournament_match()` extended with optional `p_player_a2_id`/`p_player_b2_id` — provide both for a manual doubles match, leave both off for singles (fully backward compatible)
- **Client:** `CourtGeneratorForm.vue` (attendee checklist + court-count input + Generate, shows a result summary with who's sitting out), doubles toggle added to `AddMatchForm.vue`, `MatchScoreRow.vue` now shows both partners per side with a "Doubles" tag
- Small consistency fix while in the area: `start_tournament_week()`'s internal pairing-closeness metric was still using point differential internally, even though v0.0.3.11 retired differential everywhere else. Swapped to points_for. Never a user-facing tiebreak — only affected who got paired with whom — but worth aligning once noticed
- **Deliberately not done:** the generator doesn't check for season rematches the way `start_tournament_week()` does. This is a quick best-matches-right-now tool for a live session, not a fairness rotation — flagging the omission rather than silently leaving it out
- Heavily validated against a local Postgres instance before shipping: reproduced the exact worked example (14 players, 5 courts → 2 doubles + 3 singles, 0 benched); confirmed doubles team balance with clearly-differentiated ratings (foursome of 1400/1300/1200/1100 split into 1400+1100 vs 1300+1200, exactly as specified); confirmed bench-priority fairness (the player who'd already played got benched over three untouched players); confirmed a completed doubles match updates wins/losses/points/rr_rating identically for both players on a side
- `supabase-migration-v0.0.4.0.sql` added — run after v0.0.3.11

### v0.0.4.1 — Shared standings look between the leaderboard and round robin
> Styling-only change requested for the round robin page — make it match the main leaderboard's podium/table/card look rather than its own plain table. Decided collaboratively to extract a shared component (not copy the CSS) so the two stay in sync going forward, and to surface `rr_rating` as the round robin's rating column while in there, since it already existed in the schema but was never wired into the frontend.

- **New `StandingsTable.vue`:** the main leaderboard's podium + desktop table + mobile card list, extracted into `src/components/leaderboard/` so any ranked list of players can reuse the same look instead of re-implementing the CSS. Takes a plain `rows`/`columns` shape — rating column, crowns, and the mobile/desktop split are built in; each view supplies whatever extra stat columns it needs and an optional per-row action slot
- `LeaderboardView.vue` refactored onto it (Tier badge, Season column, Streak column, Challenge action — all unchanged visually)
- `TournamentView.vue`'s round robin standings now use it too, with `rr_rating` as the "rating" column (previously fetched from the DB but never surfaced in the UI) and W–L / Pts for / Pts against / Diff as its columns
- No schema change — `rr_rating` already existed on `tournament_participants` since v0.0.3.7, just wasn't in the frontend's `TournamentParticipant` type

### v0.0.4.2 — Dropped the player-row avatar
- `PlayerAvatar` removed from `StandingsTable.vue`'s desktop table rows and mobile cards — an initials-derived avatar next to every name risked spelling something unintended for the wrong name. Player name (with crown/unit line) now sits directly in that spot with no icon
- Podium avatars (top 3) left as-is — those render a fixed medal/crown emoji via `PlayerAvatar`'s `override` prop, not name-derived initials, so the same risk doesn't apply there
- No prop/API change — `StandingsTable` still imports `PlayerAvatar` for the podium only

### v0.0.4.3 — Round robin names link to real profiles
- **`StandingsTable.vue`:** every player name (podium and rows, both leaderboard and round robin) now routes through a `profileLink()` helper — your own row goes to `/profile`, everyone else's goes to `/player/:id`, using the `meId` prop that was already there for the "my row" highlight. Previously every name linked to `/player/:id` including your own
- **`TournamentView.vue`:** now passes `me-id` to `StandingsTable` — it was missing, so round robin standings weren't highlighting your own row or routing your name correctly either
- **`PlayerView.vue`** (the `/player/:id` page): gained a Round Robin card — Titles / Best finish / Seasons played plus the season-by-season history table, same as what's on your own Profile page. Only shown if that player has actually played a round robin season
- **Round Robin head-to-head:** new card on `PlayerView.vue`, next to the existing ladder head-to-head, showing your singles record against that player across every season. New `fetchHeadToHead()` in the tournaments store queries `tournament_matches` directly rather than going through standings. Deliberately singles-only — doubles has 4 players on court, so "head-to-head" doesn't have one unambiguous meaning (partner one week, opponent the next)

---

### v0.0.4.4 — Ref/admin can add a player by name only, no email
> A ref adding weekly attendees shouldn't need everyone's email up front. A placeholder player is a real `auth.users` row under the hood — created via the Admin API in a new Edge Function, since that's the only way to make a user with no email or phone at all — so it's indistinguishable from a normal signup to every other RPC/RLS policy in the app. An admin can attach a real email later, which sends the person a "set your password" link.
- **`supabase-migration-v0.0.4.4.sql`:** adds `profiles.is_placeholder boolean`, default false. Validated by replaying the full migration history (`supabase-schema.sql` through v0.0.4.0, in commit order) against a local Postgres instance, then applying this one on top
- **First Edge Functions in this project** — `supabase/functions/create-placeholder-player/` and `supabase/functions/claim-placeholder-player/`, plus a shared CORS helper and a deploy `README.md`. `create-placeholder-player` checks the caller via the existing `is_league_admin()` RPC, creates the auth user under a generated non-deliverable placeholder email (works around an open Supabase Auth bug where `createUser()` with neither email nor phone 500s), flags `is_placeholder`, enrolls them in `players` for that league. `claim-placeholder-player` requires *global* admin (not just league admin — deliberately stricter than strictly necessary, called out as adjustable in a comment), sets + confirms a real email, clears the flag
- **Real gap closed along the way:** the app had no handling at all for Supabase's password-recovery redirect — a "set your password" email would have dead-ended at a plain sign-in screen. Added `PASSWORD_RECOVERY` event handling to `useAuth.ts` (`isPasswordRecovery`, `updatePassword()`) and a "set your password" form to `LoginView.vue`
- **Frontend wiring:** `Profile` type got `is_placeholder`; `players.ts` store got `createPlaceholderPlayer()` / `claimPlaceholderPlayer()` (the latter fires `resetPasswordForEmail` once the Edge Function confirms the email is on file); `AttendeePicker.vue` got a "+ Someone new showed up" inline mini-form that adds and auto-checks the new player in one step; new `PlaceholderPlayersPanel.vue` admin component lists placeholders in the current league with a "Send invite" email field; both wired into `TournamentView.vue`

---

### v0.0.4.5 — Placeholder players stay invitable until they actually claim their account
> A real gap in v0.0.4.4: `claim-placeholder-player` cleared `profiles.is_placeholder` the moment an admin **sent** an invite, not when the player actually **finished** setting a password. A typo'd email or an invite the person never got around to looked identical to a fully-activated account — the option to fix or resend it just vanished.
- **`supabase-migration-v0.0.4.5.sql`:** adds `profiles.invited_email` and `profiles.invited_at`, so an admin can see what was already sent. Validated by replaying the full migration history (through v0.0.4.4) against a local Postgres instance, then applying this one on top
- **`claim-placeholder-player`** no longer clears `is_placeholder` — it just records `invited_email`/`invited_at` and can be called again any number of times with a corrected or repeated email. No separate resend endpoint; calling it again *is* the resend
- **`is_placeholder` now only clears in one place:** `useAuth.ts`'s `updatePassword()`, right after the person actually sets a password — the real "became a live account" moment. A harmless no-op for a normal signup completing the same flow
- **`PlaceholderPlayersPanel.vue`:** shows "Invited to `<email>` · `<time>` ago" under a player's name once they've been invited, and the button becomes "Resend / fix email" (pre-filled with the last email sent) instead of disappearing

---

### v0.0.4.6 — Recovery links actually land on the set-password screen; profile editing; remove a placeholder
> Three real gaps found in practice testing v0.0.4.5: the claim invite's link authenticated the person but never showed them anything to actually do; there was no way for anyone (not just a claimed placeholder) to edit their own display name or unit; and an admin had no way to back out of a placeholder they'd added by mistake, or give up on an invite rather than keep correcting it.
- **⚠️ Manual dashboard step required:** `claim-placeholder-player`'s invite email now explicitly asks Supabase to redirect to `/login`. Supabase silently ignores this and falls back to whatever the **Site URL** is configured to unless `https://<your-domain>/login` (and your local dev origin, e.g. `http://localhost:5173/login`) is added under **Authentication → URL Configuration → Redirect URLs** in the dashboard. This is why the link "just logged you in" instead of showing the set-password form — the session *was* created correctly, but it landed somewhere with no set-password UI on it
- **Belt-and-suspenders fix, no dashboard step needed for this part:** even with the redirect URL correctly allow-listed, added a router guard (`router/index.ts`) plus a watcher (`App.vue`) that force a redirect to `/login` the instant a recovery session is detected, regardless of which page it actually lands on — covers both a misconfigured Site URL and the inherent race where Supabase's URL-token detection is async and can finish after the first page's navigation already resolved
- **Profile editing:** `ProfileView.vue` got an "Edit profile" button — display name and unit are now editable by the signed-in user themselves, not just settable by an admin at placeholder-creation time. New `useAuth.ts`'s `updateProfile()` backs it, using the same self-update RLS policy `updatePassword()` already relied on
- **New `delete-placeholder-player` Edge Function** — global-admin-only, permanently removes a placeholder. Refuses to touch anyone no longer flagged `is_placeholder`, and relies on Postgres's own foreign-key constraint (not a reimplemented check) to reject deleting anyone with real 1v1 match history — `players`/`tournament_participants` cascade cleanly, `matches` doesn't, so the database itself is what protects real history. `PlaceholderPlayersPanel.vue` got a "Remove" action with an inline confirm step

---

### v0.0.4.7 — Add a late arrival mid-week, not just when starting one
> No new schema or Edge Function needed — `add_tournament_match` and `generate_court_matches` already auto-enroll anyone new into the season (`insert into tournament_participants ... on conflict do nothing`) and already draw from the full league roster, not just this week's. The actual gap was purely on the frontend: "+ Someone new showed up" only existed inside `AttendeePicker.vue`, which only renders while *starting* a week — once one's already running, `AddMatchForm.vue` and `CourtGeneratorForm.vue` had no way to create a brand-new person at all.
- Extracted that mini-form into a new shared `NewPlayerInline.vue` (same `create-placeholder-player` Edge Function underneath, nothing new there either) and dropped it into all three: `AttendeePicker.vue` (refactored onto the shared component, no behavior change), `CourtGeneratorForm.vue` (new player auto-checked into the current round, same as an existing attendee), and `AddMatchForm.vue` (new player drops into the first empty slot — Player A first, then B, then the doubles partner slots if that's checked — one less step than creating them and then hunting for them in a dropdown)

---

### v0.0.4.8 — Tennis racket branding + an actual favicon
> No single "tennis racket" emoji exists in Unicode (🎾 is a ball, not a racket), so this draws one as an SVG instead of trying to fake it with emoji. Two separate asks bundled together: replace the 🏆 trophy shown as the default league icon, and stop Chrome showing its default globe in the browser tab (the app never had a favicon at all — no `<link rel="icon">`, no `public/` directory).
- **New `RacketIcon.vue`** — a small rotated-racket SVG (oval frame, a cross of strings, a handle), colored with the app's existing `--ball` gold accent so it matches the brand rather than introducing a new color
- **`leagues.icon` is `not null default '🏆'` at the database level** (see `supabase-migration-v0.0.3.0.sql`) — an untouched league genuinely has that literal emoji stored, so this couldn't be a pure "fall back when empty" fix. `AppNav.vue` now treats the literal string `'🏆'` the same as no icon at all (a `hasCustomIcon()` helper, commented with the one edge case it can't tell apart: someone who deliberately chose 🏆 as their own custom icon), so every existing league picks up the racket immediately on rebuild — no migration, no data changes needed. Applied everywhere an icon renders: the top-left switcher button and both lists in the league-switcher dropdown
- **`public/favicon.svg`** — same design, colors hardcoded (favicons render outside the app's own CSS, so `var(--ball)` doesn't apply) on a small dark rounded-square badge for contrast against a light browser chrome. Wired up via a `<link rel="icon">` in `index.html` that was simply never there before. Checked it renders as a recognizable racket down to true 16×16/32×32 favicon sizes, not just at preview scale
- The create-league form's icon input still takes a real emoji (unlike the SVG, that field can't render vector art) — its placeholder hint changed from 🏆 to 🎾 to match the new tennis-first branding

---

### v0.0.4.9 — League admins can edit their league's name and icon after creation
> Came up wanting to actually set a league's icon to 🎾 rather than just seeing it as a placeholder hint — and there was genuinely no way to, for any field, on any existing league. `leagues` has had RLS enabled with only a SELECT policy since v0.0.3.0; a name/icon typo at creation time was permanent.
- **`supabase-migration-v0.0.4.9.sql`:** adds an UPDATE policy on `leagues`, gated through the existing `is_league_admin()` function — the same check `create-placeholder-player` and every other per-league admin action already goes through, not a new one invented for this. Written idempotent (`drop policy if exists` first) like every other migration here, and validated by replaying the full history against a local Postgres instance
- **`leagues.ts`:** new `isCurrentLeagueAdmin`, refreshed via the `is_league_admin` RPC whenever the current league changes — this is genuinely different from `useAuth`'s `isAdmin`, which only reflects the global super-admin flag, not per-league admin status. New `updateLeague()` chains `.select()` on the update specifically to catch the case where RLS silently blocks a non-admin's write (which doesn't error by default, just matches 0 rows) and turn it into a real error instead of a save that looked like it worked
- **`AppNav.vue`:** league admins now see an "Edit '`<league name>`'" option in the switcher dropdown, prefilled with the league's actual stored name/icon — including the literal legacy `🏆` if that's genuinely what's stored, not the racket swap used for just *displaying* the badge. Clearing the icon field on save falls back to `🏆`, same as leaving it blank on creation always has

---

### v0.0.5.0 — Battle pass: XP, levels, and quests that reward showing up
> The goal is a number that tracks every player's progression and keeps them wanting to play — including a player on a losing streak. So the quest catalog is weighted heavily toward participation and variety (play a match, play someone new, show up across several weeks) rather than results, and nothing takes XP away. Decisions confirmed up front: XP/level is **per league** (same as rating), and v1 ships a **fixed built-in quest catalog** rather than an admin quest editor.
- **`supabase-migration-v0.0.5.0.sql`:** adds `players.xp`, a seeded `quest_templates` table (8 quests), and `player_quest_progress` (one row per player per quest per period). Only `sync_quest_progress(league_id)` writes progress or XP — it's `SECURITY DEFINER`, recomputes every player's progress from real match history (both ladder `matches` and round-robin `tournament_matches`, doubles included), and awards XP the first time a quest crosses its target. Idempotent: `completed_at` guards against double-awarding, and progress is recomputed rather than incremented. Validated by replaying the full migration history against a local Postgres instance, then functionally tested with fixture matches — first match awards Show Up + Fresh Face, a re-sync awards nothing extra, a second match the same week completes Double Header once, and the second match against the *same* opponent correctly does not re-trigger Fresh Face
- **Starter quests:** *Weekly* — Show Up (play 1, 25 XP), Double Header (play 2, 40 XP), Fresh Face (play someone you've never played, 50 XP). *Monthly* — Regular (play in 3 different weeks, 100 XP), Social Butterfly (3 different opponents, 75 XP), Mix It Up (1 doubles match, 60 XP). *Seasonal* (tied to the active round robin season, hidden when none is running) — Season Veteran (5 round robin weeks, 150 XP), Bounce Back (play again after a loss, 50 XP). Weekly periods start Monday and monthly on the 1st, both in the database's timezone (UTC on Supabase)
- **Levels are a client-side constant, not a table** — `src/lib/xp.ts`, same pattern as `TIERS` in `rating.ts`. Ten levels from Newcomer (0 XP) through Table Legend (2,250 XP), each level costing 50 XP more than the last. Named "levels" throughout, and the badge is `LevelBadge.vue`, so it never gets confused with the existing rating *tier* (Rookie → Champion)
- **New `/progress` page** (`ProgressView.vue`, in the nav): current level and XP bar with "X XP to <next title>", quests grouped into this week / this month / this season with progress bars and a check when done, and a "Recently earned" history. Opening it runs the sync first, so XP is up to date the moment you look. `ProfileView.vue` shows the level badge next to the rating tier
- **Known simplifications:** *Bounce Back* only looks at ladder matches, not round robin (kept bounded rather than generalizing every criteria type across both systems). `players.xp` isn't column-locked against a player editing their own row directly — same trust model `rating` already has, not a new class of risk. Sync currently runs when the Progress page opens, not on every match report, so a fresh result shows up next time someone opens it

---

### v0.0.5.1 — Battle pass rebalance: play XP, retuned quests, a one-year pass

> The v0.0.5.0 numbers were never balance-tested: XP flatlined after ~2 matches a week, the pass finished in about 4 months, and "Fresh Face" could be exhausted forever in a small league. XP is now two streams, tuned so a quest-focused player and a high-volume player earn about the same. XP remains a separate measurement from rating — it never changes ratings and winning earns nothing extra.

- **`supabase-migration-v0.0.5.1.sql`:** adds `player_weekly_play_xp` and rewrites `sync_quest_progress()` to award **Play XP** — 15 XP per completed match for the first 5 matches each week, 2 XP per match after that. It is recomputed from match history for every week (so weeks nobody opened `/progress` are back-filled), awards only the difference each sync, and takes XP back if a match is cancelled. Quest XP is not clawed back.
- **Quest retune (keys unchanged):** Show Up 15, Hat Trick 30 (was Double Header, now 3 matches), Fresh Face 40, Regular 80, Social Butterfly 40, Mix It Up 30, Season Veteran 100, Bounce Back 30. Fresh Face is now "play someone you haven't played in the last 30 days" (`play_lapsed_opponent`), so it never runs out.
- **Balance model (simulated year, 20-person league):** a 4-matches/week player completing every quest and a 15-matches/week player ignoring quests both land at ~9,000-9,500 XP; a 25-matches/week grinder ends ~10% higher; a casual 2-matches/week player earns roughly a third.
- **Levels:** `src/lib/xp.ts` curve reworked so Level 10 is 9,000 XP, about a year for a regular player. To change the pace, scale the level thresholds.
- **`ProgressView.vue` / `progress` store:** shows this week's matches and Play XP under the level bar.
- **Migration behaviour:** re-values already-completed quests to the new rewards, resets `players.xp` to quest XP, and clears the play-XP table so the first sync credits every past week. Safe to re-run. Validated against a local Postgres stub of the tables involved, applying v0.0.5.0 then v0.0.5.1 (twice), and functionally: 8 matches in a week gives 81 Play XP, a re-sync awards nothing extra, cancelling 3 matches takes back 6 XP, and Fresh Face triggers for an opponent last played 45 days ago but not for one played 10 days ago.
- **Known limitation:** weekly/monthly *quest* progress is still only evaluated for the current period, so a quest earned in a week nobody opened `/progress` is not back-filled.

### v0.0.5.2 — Round robin becomes the default leaderboard and profile

> With the round robin now the main way the league plays, the Standings and Profile pages open on round robin data instead of the ladder. Each has dropdowns to change what you're looking at, and the ladder versions are one dropdown away, unchanged. No migration and no backend changes.

- **Leaderboard (`LeaderboardView.vue`):** a **Board** dropdown switches between *Round robin* (default) and *Ladder*. The ladder view moved unchanged into `components/leaderboard/LadderBoard.vue`.
- **`RoundRobinBoard.vue` (new):** a **Season** dropdown (running season, any finished season, or All-time) and a **Rank by** dropdown. Season views rank by Standings (wins, then games won; finished seasons use their official final placing), RR rating, Win %, or Games won. All-time ranks career stats by Titles, Seasons played, or Best finish. It defaults to the latest finished season when no season is running. Differential stays out of the rankings, as before.
- **Profile (`ProfileView.vue`):** the same **Board** dropdown. The ladder profile (rating chart, ladder matches, season W-L) is unchanged, and the old Round Robin card is folded into the new view.
- **`RoundRobinProfile.vue` (new):** one **Season** dropdown (running season, any finished season the player was in, or All-time), and everything shows at once like the ladder profile: stat cards (RR rating, rank or final placing, W-L, win %, games won, games lost; career totals with season history on All-time) and a match history of every completed singles and doubles match with partner, opponents, score and date. Doubles results are decided from the score, because `winner_id` only names one player on a doubles match.
- **`stores/tournaments.ts`:** new `fetchProfileMatches(profileId, tournamentId?)`, and `fetchProfileRoundRobinHistory` also returns `points_for`, `points_against` and `rr_rating` (additive; PlayerView is unaffected).
- **Not included:** a round robin rating graph, because `rr_rating` only stored its current value at this point. Added in v0.0.5.3.

### v0.0.5.3 — Round robin rating graph on the profile

> The Profile page's graph only ever charted the ladder rating, because `rr_rating` stored just its current value. Round robin ratings now keep a per-match history, so the round robin profile has its own graph.

- **`supabase-migration-v0.0.5.3.sql`:** adds `rr_rating_history` (one row per player per completed round robin match: rating after the match and the change; public read like `elo_history`, written only by the SECURITY DEFINER function). `report_tournament_match()` is re-declared from its v0.0.4.0 body with one addition, the history insert; scoring, records and the rating maths are untouched.
- **Backfill:** existing completed matches are replayed in `completed_at` order per season with the same team-average Elo (K = 32, start 1000, challenge matches excluded), so the graph has history from day one. Each replayed final rating is checked against the stored `rr_rating` and any mismatch is printed as a NOTICE (`... 0 mismatching player(s)` is what you want to see). Safe to re-run: the table is cleared and rebuilt from the matches.
- **`RoundRobinProfile.vue`:** an **RR rating history** graph now sits between the stat cards and the match list for the selected season, starting from the rating before the first match. **All-time** plots each season's ending rating instead, because every season restarts everyone at 1000 and one continuous line would mislead. Match history gains a **Δ** column showing the rating change per match.
- **`stores/tournaments.ts`:** new `fetchProfileRatingHistory(profileId, tournamentId?)`.
- **Validated** on a local Postgres stub of the tournament tables: replayed history matched stored ratings exactly (0 mismatches) across singles, doubles and a challenge match; challenge matches write no history; doubles write 4 rows; new matches reported through the updated function write the right rows; re-running the migration reproduces identical numbers; deltas sum to zero per match.
- **Layout fix (`src/assets/main.css`):** the Round Robin page (`TournamentView`) puts `.page` and `.container` on the same element, and `.page`'s `padding` shorthand (defined after `.container`) zeroed the container's side padding. Its title, cards and tables sat flush against the screen edge. `.page` now sets only top and bottom padding, so the container's side padding applies. Other pages are unaffected because they nest `.container` inside `.page`.
- **Not included:** the graph is on your own Profile page only. The read-only Player page for other players is unchanged.

### v0.0.5.4 — Responsive nav and a scoreboard-style Matches page

> Two things reported from real use: the top bar didn't collapse into the burger menu until 600px, so on tablets and narrow desktop windows the links ran off the screen and the page grew a horizontal scrollbar; and the Matches page didn't make it clear who won. No migration.

- **`AppNav.vue`:** the bar now collapses into the burger menu as soon as the links stop fitting, measured with a `ResizeObserver` instead of a fixed breakpoint. The number of links changes (signed out, signed in, admin) and the real font is wider than the fallback, so any fixed width ended up wrong for somebody. It re-measures when the web font loads and when you sign in or out.
- **`main.css`:** `body` gets `overflow-x: hidden` as a last-resort guard against a stray wide element giving the whole page a horizontal scrollbar. Sweeping every page at 390px and 768px wide found no page-level horizontal overflow; wide tables still scroll inside their own card, as before.
- **`ScoreCard.vue` (new):** a match drawn as a scoreboard. One row per side; the winner's row is tinted green with a check badge and bold name, the loser's is dimmed. Shows per-game scores (the game each side won is bold), the games-won total, and each player's rating change. If you played, the card gets a green or red edge and a "You won" / "You lost" label. Handles doubles (two names, overlapping avatars).
- **`MatchCard.vue`:** rebuilt on `ScoreCard` for ladder matches. The meaningless "completed" pill is gone; pending/accepted/disputed matches keep their status pill and Accept / Decline / Submit result buttons. The rating deltas were already stored on every ladder match but never displayed.
- **`MatchesView.vue`:** a **Board** dropdown (*Round robin*, the default, or *Ladder*) and a **Show** dropdown (*All matches* or *My matches*). The Matches page previously listed only ladder matches; round robin results (singles, doubles, bracket, challenge) now appear too, using the same cards, with the season name and rating change per player. Ladder-only sections (needs your attention, waiting for opponent, disputed results) stay on the Ladder board, and the Round robin board shows a banner when a ladder match needs your attention so a challenge can't go unseen.
- **`stores/tournaments.ts`:** new `fetchLeagueMatches()`. Rating changes come from `rr_rating_history`; if v0.0.5.3's migration hasn't been run yet, matches still load, just without deltas.
- **Validated** in a headless browser with mocked data: nav collapse across widths from 1200px down to 390px (the row now collapses between 860px and 820px in the test environment; the exact point depends on the font), all pages at 390px and 768px, and both Matches boards at phone and desktop widths.

### v0.0.5.5 — New favicon

> The browser-tab icon is now the tennis ball and racket artwork instead of the v0.0.4.8 racket SVG.

- **`public/`:** the icon was cropped from the supplied image (tightened around the circle so it stays readable at 16-32px) and exported as `favicon.ico` (16/32/48), `favicon-32.png`, `favicon-192.png`, `favicon-512.png`, and `apple-touch-icon.png` (180px, full square because iOS rounds it itself). The tab and PWA versions have rounded corners; the light background plate is part of the artwork, so it shows as a light rounded square on dark browser themes.
- **`index.html`:** the single `favicon.svg` link is replaced by the ICO, 32px PNG, 192px PNG and Apple touch icon links. `public/favicon.svg` is deleted.
- **Unchanged:** the nav-bar logo and default league icon are still the `RacketIcon.vue` SVG, and the page title still has the 🏓 emoji.
- **Note:** browsers cache favicons hard. If the old one still shows after deploying, hard-refresh (Ctrl+Shift+R) or open the site in a private window.

### v0.0.5.6 — Wording and icons follow the league's sport

> The home page said "Building Ping Pong" and "Own the table" whatever league was selected, because that text was hard-coded and `leagues.sport` was never read. Sport-specific wording now comes from the current league, so it changes when you switch leagues. No migration.

- **`src/lib/sports.ts` (new):** one table of sports (Ping Pong, Tennis, Pickleball, Badminton, Squash, Padel), each with a label, emoji, playing surface ("table" / "court") and gear ("Paddle" / "Racket"). `leagues.sport` was free text, so lookups are forgiving: `ping-pong`, `Table Tennis` and `pingpong` all resolve to Ping Pong. An unrecognised sport keeps its own name as the label and gets neutral wording rather than another sport's. To add a sport, add one entry there.
- **`src/composables/useSport.ts` (new):** the current league's sport as a reactive value. For a signed-out visitor it falls back to the public league list and the league remembered in the browser.
- **Home page:** the eyebrow is "Building {sport}", the headline is "Own the {table|court}.", and the first feature card uses the sport's emoji. With no league known yet it reads "Building League" and "Own the court."
- **Browser tab title and sign-in header:** the emoji follows the sport (🏓 or 🎾). `index.html`'s static title is now plain "RALLY" until a league is known. The favicon image is unchanged.
- **Level titles (battle pass):** the sport-flavoured titles are built from the sport. Tennis gets Court Legend / Court Tactician / Court Regular / Racket Enthusiast; Ping Pong gets Table Legend / Table Tactician / Table Regular / Paddle Enthusiast. Level 9 was "Court Regular" for every sport and is now "Table Regular" for ping pong. `getLevel`, `getNextLevel` and `levelProgress` take an optional sport; `LevelBadge` and the Progress page pass it.
- **League menu:** "Create a league" now has a sport dropdown instead of a free-text slug, so typos can't create an unrecognised sport. League admins get the same dropdown under "Edit", which is how to fix an existing league whose sport was typed in a way that isn't recognised. If a league's stored sport isn't in the list, it's kept as an option so saving doesn't change it.
- **Fixed while in there:** `types/index.ts` gains `xp?: number` on `Player` (missing since v0.0.5.0, which made the type-checker complain about the Progress page).
- **Validated** in a headless browser with mock data: with a "ping-pong" league and a "Tennis" league, switching between them in the league menu changed the home eyebrow, headline, feature emoji and tab title each time; no page errors on the home, login, progress, profile, leaderboard or matches pages; the create-league dropdown renders. The sport lookup and level titles were checked directly for six spellings plus an unknown sport and no sport.
- **Not changed:** the league's own icon (still set by league admins), the racket logo in the nav, and generic copy like "neighbors" and "the building" on the home page.

### v0.0.5.7 — Page headings show the league's name

> The small gold heading above "Standings" was hard-coded to "Building League", and the home page one read "Building {sport}". Both now show the name of the current league, so they change when you switch leagues. No migration.

- **`HomeView.vue`, `LeaderboardView.vue`:** the eyebrow is the league's own name (for example "Court Club"). Until a league is known (signed out, first visit) it falls back to the sport's label, or "League" if there isn't one.
- **`useSport.ts`:** also returns `league` and `leagueName`.
- **Unchanged:** the other page eyebrows ("Activity", "Season", "Your profile"), and the sport-specific home page headline, emoji and tab title from v0.0.5.6.
- **Validated** in a headless browser with two mock leagues: home and Standings both showed the selected league's name and followed it when switching.

### v0.0.5.8 — Password UX: forgot password, change password, clearer set-password screen

> Setting and resetting passwords had gaps. There was no "Forgot password?" anywhere (a reset link could only be triggered by an admin inviting a placeholder player), no way to change your password while signed in, no confirm field on the set-password screen, and Supabase's raw error text was shown as-is. No migration.

- **Forgot password (`LoginView.vue`):** a "Forgot password?" link sits next to the password field, and a failed sign-in offers "Reset your password". The reset form carries over the email you already typed, sends the link (redirecting back to `/login`), and says the same thing whether or not the address has an account. Resends are limited by a 60-second cooldown.
- **Set-password screen (link from an email):** new password plus a confirm field with a live checklist ("At least 8 characters", "Passwords match"), Show/Hide toggles, and a Save button that stays disabled until it's valid. The heading changes for invited players ("Welcome! Set your password") versus a reset ("Choose a new password"). On success there's a "Password saved" screen with a Continue button instead of a silent redirect. "Not you? Sign out" lets someone leave without setting anything.
- **Change password (`ChangePasswordForm.vue`, on Profile):** a "Change password" button (also reachable when you haven't joined a league). It asks for your current password first (checked by signing in with it) so a phone left unlocked can't quietly change it, then the new one with confirm. For an invited player who has no password yet, the current-password field is hidden and the button reads "Set password".
- **Reminder bar (`PasswordNudge.vue`):** an invited player who followed the email link, got signed in, and left before choosing a password used to be stuck: fine until the session ended, then locked out. They now see a slim bar under the nav ("You haven't set a password yet") that opens the Set password form, and it disappears once one is saved.
- **Reload during a reset:** the "you still need to set a password" state is now remembered for the browser tab. Before, a reload mid-flow dropped the person into the app signed in with no form to finish, because Supabase only announces the recovery once.
- **Expired or already-used links:** Supabase reports these in the URL of whatever page it redirected to, and nothing read it, so the person landed on a normal page with no explanation. They're now sent to the sign-in page with "That link has expired or was already used", with the reset form open and the email box focused.
- **Plain-language errors (`lib/authMessages.ts`):** "Invalid login credentials" becomes "That email and password don't match.", plus friendlier messages for unconfirmed email (with a "Resend the confirmation email" link), existing account, too-short or too-weak password, same-as-old password, rate limits, and network failures. Anything unrecognised is shown unchanged.
- **Password managers and phones:** fields have proper `autocomplete` values (`current-password` when signing in, `new-password` when creating or changing), so managers offer to fill or suggest a strong one; auto-capitalise and spellcheck are off on password fields. Join-the-league also gets Show/Hide.
- **Types:** `Profile` gains `is_placeholder?: boolean`.
- **Supabase dashboard:** nothing new to configure. Forgot password uses the same redirect as the invite email, so `https://<your-domain>/login` and your local dev address must already be under Authentication → URL Configuration → Redirect URLs (from v0.0.4.6). If the reset emails look generic, the "Reset Password" template is under Authentication → Email Templates.
- **Validated** in a headless browser against mocked Supabase auth endpoints (69 checks across eight scenarios, no page errors): wrong password, forgot flow and its request (email, redirect URL, cooldown), expired link, recovery link for an existing user and for an invited player including the profile flag, reload and navigating away mid-recovery, the reminder bar to set-password path, and change password with a wrong and a correct current password.
- **Not included:** an admin button to send a reset email to an existing user. Player emails aren't stored where the app can read them, and anyone can now request their own link from the sign-in page.

### v0.0.5.9 — Player accounts: reset passwords and fix emails from the Round Robin page

> What if a player forgets their password, never set one, or has the wrong email on file, or no email at all? Before this, an admin could only invite name-only players; for anyone with an account the only route was the player's own "Forgot password?", which needs a working email. The Round Robin page now has a **Player accounts** panel (global admin only) that covers every case.

- **The list:** every player in the league with a status, attention-first. *Name only* (no email, can't sign in), *Invited, waiting* (invite sent, no password yet), *Email not confirmed*, or *Active*. Each row shows a **masked** email (`j***@g***.com`) and when they last signed in. Full emails are never sent to the browser: the server looks them up in `auth.users` and returns only the masked form.
- **Send password reset** (active players): the server finds the address and sends the reset email itself, so the admin never sees the email or the link. A 60-second cooldown on the button matches Supabase's own limit, and hitting the limit shows a plain message.
- **Change email** (active or unconfirmed players): for a typo'd or lost address. The new address is typed twice, then a confirm step spells out old (masked) and new. The new email is marked confirmed and a reset link goes to it, so only whoever owns that mailbox can get in. If the reset email fails to send after the change, the panel says so and Send password reset can retry.
- **Guardrails, enforced server-side:** global admin only; Change email is refused for admin accounts, for yourself, and for name-only or invited players (those use Send invite / Resend / fix email); an address another account already uses is refused; the two typed addresses must match.
- **Placeholder players:** the old Placeholder players box is folded into this panel. Send invite, Resend / fix email and Remove work as before and are now listed alongside everyone else. The panel also shows above the season section, so it's reachable with no season running.
- **Audit log:** new `account_admin_log` table records who sent a reset or changed an email, for whom, and when; the last 10 entries show at the bottom of the panel. Emails in the log are masked too. Only the Edge Functions can write to it, and no one can edit or delete rows; names are stored as snapshots so entries stay readable if a player is later deleted.
- **New:** `supabase-migration-v0.0.5.9.sql`; Edge Functions `admin-account-info`, `admin-send-reset`, `admin-change-email` and a shared `_shared/accounts.ts`; `PlayerAccountsPanel.vue` (replaces `PlaceholderPlayersPanel.vue`, which is removed); four new methods on the `players.ts` store; `AccountInfo` / `AccountLogEntry` types, and `Profile` now actually carries `is_placeholder`, `invited_email` and `invited_at`.
- **Deploy (manual, from your terminal):** run the migration in the SQL Editor, then `supabase functions deploy admin-account-info`, `admin-send-reset` and `admin-change-email`. See `supabase/functions/README.md`. Reset links use the same `/login` redirect as the invite email, so nothing new to allow-list.
- **Not included:** a "set their password for them" button (you'd know their password, and they couldn't trust it; a reset link to their own inbox is the safe route). Other devices stay signed in after an email change or reset, because Supabase only revokes sessions with the user's own token.
- **Validated:** 59 Deno checks run the real Edge Function code against an in-memory fake Supabase (auth gates for all three, masking, no full email in any response or log row, every refusal path leaves state untouched, rate-limit and send-failure paths); a mutation check confirmed the admin and self guardrails fail the tests when removed. 48 headless-browser checks drive the real app against those same functions (status list and ordering, masked display, reset and cooldown, the two-step email change including Back, invite and remove-confirm, one open form at a time, no horizontal overflow at 375px, non-admins never see the panel). The migration was replayed twice on Postgres and checked: admins can read, non-admins see nothing, and insert/update/delete from the browser role are all refused.

### v0.0.6.0 — Player accounts: tidier list, clearable change log; Submit instead of Override

> Follow-ups from using the v0.0.5.9 panel on a real league: with a dozen players the list was mostly people who needed nothing, and the change log never went away.

- **Active players start hidden:** the Player accounts list now opens showing only people who still need something (name only, invited, email not confirmed). A **Show active players (N)** button in the toolbar reveals everyone, and **Hide active players** puts them away again. Your own row counts as active, so it's hidden too. If everyone is active, the list says so instead of showing an empty box. Hiding closes any form open on a row that is about to disappear.
- **Recent changes is collapsed by default** and shows a count in its header. It never expired: it always shows the latest 10 changes however old, which is why it was still there after a refresh.
- **Clear:** hides the entries shown so far, in this browser only (stored in `localStorage`, compared against the server's own timestamp rather than the browser clock). New changes after a clear show up on their own, **Show cleared (N)** brings the hidden ones back, and a note under the list says the full record stays in the database. Deliberately not a delete: `account_admin_log` has no delete policy, so the audit trail can't be edited from the app.
- **"Override" → "Submit":** on the Round Robin page, the admin's button for entering a score on someone else's pending match now says Submit (players' own matches still say Report). The heading above that list changed from "Other pending matches (admin override)" to "Other pending matches (enter as admin)". Wording only; it still calls the same function.
- **Changed:** `PlayerAccountsPanel.vue`, `MatchScoreRow.vue`, `TournamentView.vue`. No migration and no Edge Function changes, so nothing to deploy beyond the frontend.
- **Validated:** the 48 browser checks from v0.0.5.9 were updated for the new default view and extended to 72, covering the hidden/shown toggle and its count, an open form closing when its row is hidden, a player moving out of the list once they become active, Clear (database rows untouched, a later change appears alone, survives a page reload, cleared entries recoverable), the all-active message, and no overflow at 375px. The Submit label was checked by reading the component and a clean build, not in the browser, because the mock league has no running season to show a pending match.

### v0.0.6.1 — Admins can remove a played round robin match

> If a score is entered by accident or entered wrong, an admin can now remove that match from the Matches page. Removing it properly means more than deleting a row, because ratings are Elo and later matches were worked out from ratings that included the removed one, so the database replays them without it.

- **Where:** Matches page → Round robin board. Each match card an admin can remove has a small **Remove** button. Clicking it opens a confirmation that names the match ("Jane 6–4 Tom", or both partners for doubles) and says what will happen; **Yes, remove it** does it, **Cancel** backs out. A green notice afterwards says what was removed and how many later matches were recalculated. Regular players never see the button.
- **What removal does** (`remove_tournament_match()`, one transaction): takes the match back out of the season standings (wins, losses, points for and against; a challenge match gives back its +2 bonus point), then recalculates ratings. Each affected player's rating is taken from just before the removed match (from `rr_rating_history`) and every later match of that season is replayed in the order it was played, with the same team-average Elo as `report_tournament_match()` (K = 32). The new ratings are written to `rr_rating_history` and `tournament_participants.rr_rating`, so the standings, the Matches page rating changes and the Profile graph all agree. Matches played before the removed one are never touched.
- **Fixing a wrong score:** remove the match, then add it again with the right score from the Round Robin page. The corrected match counts as the most recent one of the season (that's when it was entered), which is the same result as having entered it correctly at that moment.
- **Limits:** only matches in a season that is still running. A finished season is locked (finalizing it already wrote career records from it), so its matches show no Remove button, and the database refuses if asked anyway. Bracket matches are refused. The existing Remove on the Round Robin page (`cancel_tournament_match`) still handles matches nobody has played yet. The UI shows the button to global admins, matching the rest of the admin UI; the function itself accepts any admin of the league.
- **Record:** new `match_removal_log` table: who removed what and when, with the players, score and timestamps so the match can be re-entered if the wrong one was removed. Readable by global admins, written only by the function, and not editable. There's no screen for it yet; query it in the SQL Editor (`select created_at, removed_by_name, tournament_name, match_summary from match_removal_log order by created_at desc`).
- **XP:** nothing to do. Play XP is recomputed from the matches that exist whenever the Progress page syncs, so it drops back by itself. Quests already completed stay earned.
- **Not included:** ladder matches. Players confirm those themselves and admins already resolve disputes, and the ladder's rating, streak and tier maths is separate and would need its own replay.
- **New:** `supabase-migration-v0.0.6.1.sql`. **Changed:** `src/views/MatchesView.vue`, `src/stores/tournaments.ts` (new `removePlayedMatch()`; the league match list also loads each season's status). No Edge Function changes.
- **Deploy (manual):** run the migration in the SQL Editor after confirming v0.0.5.3 is applied (it stops with a clear message if not), then deploy the frontend.
- **Validated:** all 27 migrations in git order were replayed into a real Postgres engine, then the new one (twice, to confirm it is safe to re-run). 60 random seasons of singles, doubles and challenge matches each had one match removed and were compared with a control season where that match was never played: every player's wins, losses, points, bonus points, rating and every `rr_rating_history` row matched exactly. The same held for 20 seasons with two removals in a row and 10 where a wrong score was removed and re-entered. Also checked: non-admins and signed-out callers are refused, unplayed matches, finished seasons and bracket matches are refused and change nothing, a double click gives a clean "not found", the log records the right names and score, and the browser role can neither write nor edit the log. Deliberately breaking the function four ways (skipping the replay, replaying from the wrong starting rating, dropping the finished-season check, not undoing points against) made the tests fail each time. 27 headless-browser checks drive the real Matches page: Remove appears only on running-season matches and only for admins, the confirm names the match, Cancel and server errors leave it in place, doubles and challenge matches work, and nothing overflows at 375px.

### v0.0.6.2 — Round robin points

> The leaderboard's bare number was a win count with no label. The round robin now has a real points system, shown everywhere standings appear and used to rank and seed.

- A win earns 4 points; a loss earns the games you won, minimum 1, maximum 3 (0-4 and 1-4 earn 1, 2-4 earns 2, 3-4 earns 3). Doubles partners both earn their side's points. Challenge matches earn none; the challenge bonus stays a final tiebreak only.
- Ranking is total points, then wins, then games won. Because a loss still earns points, playing more matches earns more points.
- New `rr_points` column on `tournament_participants`, defined once in `rr_match_points()`, backfilled from every completed non-challenge match. A self-check in the migration fails if any stored total differs from a recount.
- `report_tournament_match()`, `remove_tournament_match()`, `finalize_tournament()` and `create_challenge()` updated. Court pairing unchanged. Seasons finalized before 6.2 keep their official placings and only gain a points figure.
- Leaderboard defaults to Rank by Points; Points appears as its own column when another ranking is chosen. Mobile cards and the podium now label the big number.
- Round Robin page: the big number is points, RR Rating moves to a desktop-only column, "Pts for/against" became "Games for/against".
- New collapsible "How points work" key under the round robin tables (not on the all-time view).
- Past seasons panel: old "Points" column renamed "Games + bonus", plus a real Points column.
- Migration refuses to run unless v0.0.5.3 and v0.0.6.1 are applied.

### v0.0.6.3 — Score validation, and points on every match card

> A round robin match is first to 4 games, no-ad, but the app only checked that a score wasn't a tie. Since v0.0.6.2 a loss earns points from the games won, so a typo like 7-2 also bent the standings. Scores are now checked against the real format, and each round robin match card shows the points it earned.

- A legal result has one side on exactly 4 games and the other on 0 to 3 (4-0, 4-1, 4-2, 4-3 either way round). Anything else is refused: ties, 3-2, 5-2, 7-2, 4-4, negatives, decimals.
- Database: new `rr_score_is_legal()` defines the rule once, and `report_tournament_match()` (v0.0.6.2 body, otherwise unchanged) rejects an illegal score with a message that says what a legal one is. It applies to every reported match, including challenge and bracket matches, since they share the function.
- Score boxes on the Round Robin page take 0 to 4. The Submit/Report button stays off until the score is legal, and a short reason appears once both boxes are filled (not while the second one is still being typed). The store checks again before calling the database, so the reason is the same either way.
- Matches page: each side of a round robin card now shows the points the match added ("+4 pts", "+1 pt"). Challenge matches show none. `PointsKey.vue` is unchanged.
- New `src/lib/score.ts` holds the front-end copy of the rule and of `rr_match_points()`; the file says which migrations to change alongside it.
- Existing results are not touched. The migration ends with an audit that lists, as NOTICEs in the SQL Editor output, any completed match whose stored score is not legal. They keep counting; an admin fixes one with Remove on the Matches page, then adds the match again.
- Not changed: `add_tournament_match()` takes no score, so there was nothing to validate. Ladder matches use per-game scores and a different format and are not touched.
- **New:** `supabase-migration-v0.0.6.3.sql`, `src/lib/score.ts`. **Changed:** `src/components/tournament/MatchScoreRow.vue`, `src/components/match/ScoreCard.vue`, `src/views/MatchesView.vue`, `src/stores/tournaments.ts`. No Edge Function changes.
- **Deploy (manual):** run the migration in the SQL Editor after confirming v0.0.6.2 is applied (it stops with a clear message if not), then deploy the frontend. Safe to re-run.
- **Validated:** the base schema and all 28 earlier migrations were replayed in version order into a real Postgres engine, then the new one (twice, to confirm it is safe to re-run; it also refuses to run without 6.2). On a staged season with singles, doubles and two old illegal results (7-2 and 1-5), the audit listed exactly those two. The new function accepted all six legal scores tried and rejected twelve illegal ones, plus a null. Five further matches, singles and doubles, were reported on a copy still at 6.2 and a copy at 6.3: every player's wins, losses, games, points and rating, and every `rr_rating_history` row, matched exactly. Removing an old illegal match still works and takes back the right points. The JavaScript rule agrees with the SQL functions on all 121 score pairs from -1 to 9. 76 headless-browser checks on the new components at 375px and 1280px covered blocked and allowed scores, the hint timing, the points labels, and no horizontal overflow. The production build passes. Not tested against your live Supabase data (so the audit result on your real matches is unknown until you run it), and the Matches page itself was not driven end to end: the new pieces were tested as components with mock data.

### v0.0.6.4 — A loss can be worth nothing, and the battle pass follows match points

> Since v0.0.6.2 every loss earned at least 1 point, so a 0-4 loss still paid and playing more could stand in for playing well. A loss now earns exactly the games you won, up to 3, and round robin battle pass XP uses the same rule.

- Match points: a win is 4. A loss is the games you won, 0 to 3, so 0-4 earns 0, 1-4 earns 1, 2-4 earns 2 and 3-4 earns 3. `rr_match_points()` loses its floor of 1. Everything else about points (doubles, challenges earning none, ranking by points then wins then games won) is unchanged.
- Battle pass: round robin and bracket matches now pay **4 XP per match point** instead of a flat 15: a win is 16 XP, a 3-4 loss 12, 2-4 8, 1-4 4, 0-4 0. The weekly shape is the same: a player's first 5 matches of the week (by completion time) earn their own XP, later ones earn 2. Ladder matches and challenge matches have no points, so they stay at a flat 15. Quest XP is untouched.
- Past weeks are protected. Play XP is recomputed from match history on every sync, so changing the formula would have rewritten every old week. A new one-row table, `play_xp_rule`, records the Monday of the week the migration is first run; weeks before it keep the flat 15 XP per match they were already paid, so nobody's level moves backwards. Matches already played in the current week are re-scored under the new rule the next time someone opens `/progress`.
- `rr_points` is recomputed for every tournament, finished ones included (the same approach as the v0.0.6.2 backfill; it is required, because removing a match takes back points using the current rule). Final placings already awarded are not touched; only the points figure shown beside them can change. The migration prints how many participant rows changed, and ends with a self-check that stops if any stored total differs from a recount.
- "How points work" key now has an XP column and says a 0-4 loss earns nothing. Its numbers come from `src/lib/score.ts` rather than being typed in. The Progress page gets one line under the level bar explaining what a win and a loss are worth in XP.
- Layout fix: the key's table was being stretched to 460px by the global mobile table rule and overflowed a 375px screen (this was also true of the v0.0.6.2 version). It now fits.
- `src/lib/score.ts`: `rrMatchPoints()` updated, plus `XP_PER_POINT` and `rrMatchXp()`.
- **New:** `supabase-migration-v0.0.6.4.sql`. **Changed:** `src/lib/score.ts`, `src/components/tournament/PointsKey.vue`, `src/views/ProgressView.vue`, `src/stores/tournaments.ts` (comment only). No Edge Function changes.
- **Deploy (manual):** run the migration in the SQL Editor after confirming v0.0.6.3 is applied (it stops with a clear message if not), then deploy the frontend. Safe to re-run; the cut-off week is set the first time and never moved. Change the cut-off by editing the one row in `play_xp_rule` if you ever need to.
- **Validated:** the base schema and all earlier migrations were replayed in version order into a real Postgres engine, then the new one, both on top of a seeded copy at 6.3 (the real upgrade path) and as a fresh install. A staged league covered singles and doubles round robin matches, a challenge match and a ladder match across three weeks (bracket matches share the same code path but were not staged separately). Past weeks and every quest row were byte-identical before and after. The rule week matched a hand calculation for every player (for example 57 XP for a player with a ladder match, six round robin matches and a challenge: the first five matches earn 15+16+0+12+8, the rest earn 2 each). A repeat sync and a second run of the migration changed nothing. The upgraded copy and the fresh install produced identical XP, weekly rows, points and quests. Removing a match took back the right points and XP, with a later match moving into the full-rate five. The migration refuses to run without 6.3. The JavaScript rule agrees with the SQL function on all 100 score pairs from 0-0 to 9-9. 14 headless-browser checks on the points key at 375px and 1280px covered the rows, headers, wording and no overflow. The production build passes. Not tested: against your live Supabase data (so how many rows the points backfill changes is unknown until you run it), and the Progress page itself was not driven; its new line was only compiled by the build.

### v0.0.6.5 — Mobile pass: nothing cut off on a phone

> The profile page was wider than a phone screen: the Level and Tier badges ran off the right edge and the whole page scrolled sideways, and the match tables were forced 460px wide so their last columns were cut off inside the card. This pass fixes those and the smaller cut-offs found while checking every page.

- **Profile header:** the Edit profile / Change password buttons and the Level and Tier badges now wrap onto a second line instead of running off the screen. This was the page-wide sideways scroll.
- **Tables fit the screen.** The global phone rule that forced every table to 460px wide (and stopped all wrapping) is gone. Headers, dates, scores and numbers still never break mid-word; names and text cells wrap normally. A table that truly has too many columns can opt in to sideways scrolling with `.table-wide` inside a `.table-scroll`; none currently needs it.
- **Match lists become two-line rows on phones** (My matches, Match history, Round Robin matches): result, opponent or partner/opponents, and score on the first line; date and rating change underneath. Season history rows do the same. Desktop keeps the normal tables. New classes `.table-stack-match` and `.table-stack-season` in `main.css` rely on column order, so keep it if you add a column.
- **Player page:** the round robin history table had no scroll wrapper at all and could push the page wider than the screen. Fixed.
- **Long names** on the leaderboard cards and match cards wrap onto a second line instead of ending in "…".
- **Standings filters:** Season and Rank by now stack full width on a phone (they were indented on one side and right-aligned on the other).
- **Changed:** `src/assets/main.css`, `src/views/ProfileView.vue`, `src/views/PlayerView.vue`, `src/components/profile/RoundRobinProfile.vue`, `src/components/tournament/PastSeasonsPanel.vue`, `src/components/tournament/PointsKey.vue` (dropped its now-unneeded width override), `src/components/leaderboard/RoundRobinBoard.vue`, `src/components/leaderboard/StandingsTable.vue`, `src/components/match/ScoreCard.vue`. Frontend only: no migration, no Edge Function changes.
- **Validated:** the real app was run in headless Chromium with the database replaced by mock data (long names, a doubles match, a challenge match, two seasons) and every page checked at 375px, 320px and 1280px for sideways page scroll, content poking past the screen edge, and boxes clipping their content. The profile page reproduced the bug before the change (page 522px wide on a 375px screen) and is clean after. All pages are clean at 375px and 1280px; at 320px only the small grey "meta" line on match cards still ends in "…". The production build passes. Not covered: the expanded "past seasons" panel, the all-time board's extra Season column in the new match layout, admin panels, and the login and password screens were not driven in the browser; real data and a real phone may still show something the mock did not. The mock data and test harness are not part of the delivery.

### v0.0.6.6 — Remove is now a red x at the top right of each match

> On the Matches page, the admin's "Remove" button under each round robin match is replaced by a small red x in the top right of the card, to the right of the date.

- The x appears on the same matches as the old button did: admin only, round robin or challenge matches in a season that is still running. Everyone else sees no change.
- Clicking it opens the same confirmation as before ("Remove ... ? Standings and ratings are recalculated as if it was never played"), with **Yes, remove it** and **Cancel**. Clicking the x again also closes the confirmation. Nothing is removed until **Yes, remove it** is pressed.
- The x is a 28px round tap target, red, with a tooltip and a screen-reader label naming the match. It does not make the card header any taller.
- `ScoreCard.vue` gains an optional `head-action` slot at the far right of its header, which this uses. Cards that do not use it look the same.
- **Changed:** `src/views/MatchesView.vue`, `src/components/match/ScoreCard.vue`. Frontend only: no migration, no Edge Function changes.
- **Validated:** the real Matches page was run in headless Chromium with mock data and an admin user, at 375px and 1280px (38 checks): one x per card, to the right of the date and on the same row, inside the card, red, at least 28px, header height unchanged, no sideways scroll, the old text button gone, the confirmation opens and closes from the x, Cancel closes it, and **Yes, remove it** calls the remove function for the right match and shows the success notice. The production build passes. Not covered: the removal itself against a real database (that function was not changed in this version) and non-admin accounts (the x's condition is the same as the old button's).

### v0.0.6.7 — Bottom tab bar on phones

> A bar of the five most-used pages now sits at the bottom of the screen on a phone, so getting around is one tap instead of open-menu-then-tap. The top bar and its menu stay.

- **Tabs, left to right:** Leaderboard, Matches, Round Robin, Progress, Profile. The current page is highlighted in the ball yellow.
- **Signed out:** the three public pages plus **Sign in** (Progress and Profile need an account). The bar is not shown on the sign-in and password screens.
- **Phones only (700px wide or less).** On a wider screen the top bar already shows every link, so the bar is hidden there and nothing else changes. The top-right menu is unchanged and still holds Challenge, Referee (admins) and Sign out.
- **Stays out of the way:** it hides while a text box or dropdown has focus, so it never floats above the on-screen keyboard while someone types a score, and returns when they finish. Pages get extra bottom space so the last card is never hidden behind it, and it clears the home indicator on phones that have one.
- Each tab is at least 56px tall and a fifth of the screen wide. Labels shrink slightly at 320px so none are cut off.
- New file `src/components/layout/BottomTabBar.vue` (icons are inlined Feather icons, MIT licensed, nothing to download). **Changed:** `src/App.vue` (one line to show it), `src/assets/main.css` (bottom space for pages on phones). Frontend only: no migration, no Edge Function changes.
- **Validated:** the real app was run in headless Chromium with mock data (33 checks): tab order and destinations, the bar fixed at the bottom at full width, tap targets, the current page highlighted and moving correctly after each tap, one tap navigating each time, the last card clearing the bar when scrolled to the bottom, no sideways scroll, labels uncut at 375px and 320px, hidden at 701px and wider and shown at 700px, hidden while a dropdown has focus and back after, the signed-out set, and no bar on the sign-in page. The production build passes. Not covered: a real phone (the keyboard behaviour in particular depends on the browser; this was simulated with focus only), landscape orientation, and iPhones with a home indicator (the spacing for it is in place but only the zero-inset case was exercised). Player pages (`/player/...`) highlight no tab, since they are reached from several places.

### v0.0.6.8 — Matches are first to 6, "Unit" is gone, and the project has a test suite

> Round robin scores can now go up to 6: a finished match is 6-0 up to 6-5 either way round (it was 4-0 up to 4-3). The apartment-building "Unit" field is removed from the app, the leftover files are cleaned up, and `npm test` now checks the rules, every migration and the pages on a phone.

- **First to 6.** The target lives in one place in the database, `rr_games_to_win()` (6), and `rr_score_is_legal()` follows it. Reporting a match refuses anything else with a message that states the target. The score boxes accept 0 to 6, the Report button stays off until the score is a finished one, and the "How points work" key and Progress page read their numbers from the same constant in `src/lib/score.ts`. Changing the target later is one number in each of those two places.
- **Points and XP are unchanged:** a win is 4 points, a loss earns the games you won up to 3, XP is 4 per point. With first to 6 that means 3-6, 4-6 and 5-6 losses all earn 3 points (and 0-6 earns 0). If you would rather spread the loss scale over the new range (for example 5-6 = 3, 3-6 = 2, 1-6 = 1), that is a small follow-up.
- **Old results:** matches already completed as first-to-4 (4-2 and so on) keep counting exactly as before. The migration prints a notice listing any of them (first 25 and a count) and changes nothing; to re-enter one, Remove it and add it again. Not accepted: 7-5 or 7-6 (a 7th game); the winner must have exactly 6.
- **"Unit" removed** from sign-up, Edit profile, the profile and player pages, the leaderboard and match cards, and the data the app loads. The `unit` column stays in the database (nothing was dropped, and the sign-up trigger still tolerates it being absent); it is simply no longer asked for or shown.
- **Cleanup:** `src/components/admin/PlaceholderPlayersPanel.vue` (unused) is deleted, and `.gitignore` now ignores editor swap files (`*.swp`, `*.swo`, `*~`) and the test scratch folder. The stray `.ProfileView.vue.swp` was already gone from the repo.
- **Test suite (`tests/`, run with `npm test`).** `npm run test:js` checks the score and points rules (7 checks, one second). `npm run test:db` builds throwaway Postgres databases and checks that the base schema and every migration apply in order, that recent ones can be re-run and refuse to run without their prerequisite, that the SQL rules and `score.ts` agree on every score from 0-0 to 9-9, that reporting, removing and re-syncing give exactly the points and battle pass XP an independent calculation predicts, and that upgrading a database holding old results keeps them (15 checks). `npm run test:browser` runs the real app in headless Chromium against made-up data and checks every page at 375px, 320px and 1280px, the tab bar, the remove "x", the points key, the profile lists and score entry (234 checks). `npm test` runs the first two and **fails loudly** if Postgres can't be reached, instead of quietly skipping. How to set each one up is in `tests/README.md`. No new dependencies were added to `package.json`; the browser tests need Playwright installed on the side (`npm i --no-save playwright`).
- **Checked that the tests can fail:** five deliberate breakages (score box limit back to 4, score.ts target changed, loss-points floor put back, database target changed, the legality check removed from reporting) were each caught by at least one test, then undone.
- **New:** `supabase-migration-v0.0.6.8.sql`, `tests/`, `src/lib/score.ts` changes. **Changed:** `package.json` (test scripts only), `.gitignore`, and the front-end files that showed or asked for "Unit" or limited scores to 4. **Deleted:** `PlaceholderPlayersPanel.vue`. No Edge Function changes.
- **Deploy (manual):** run the migration in the SQL Editor after confirming v0.0.6.4 is applied (it stops with a clear message if the score rule from 6.3 is missing), read the notices it prints, then deploy the frontend. Then `git rm src/components/admin/PlaceholderPlayersPanel.vue`. Safe to run twice.
- **Validated:** all of the above ran green on my side (7 + 15 + 234 checks) and the production build passes. Not covered: your live Supabase data (the audit notice is how you will find out whether any old scores are affected), a real phone, and the Edge Functions. The database tests ran on Postgres 16; Supabase's own extras are only stood in for (`tests/db/stub-supabase.sql`).

### v0.0.6.9 — The tab bar no longer disappears when you open a dropdown

> Bug fix. On a phone, opening a dropdown (Board, Season, Rank by and so on) made the bottom tab bar vanish. That was a mistake in v0.0.6.7: the bar hides while you type so it does not sit on top of the on-screen keyboard, but I applied that to dropdowns too, and a dropdown opens a picker, not a keyboard.

- The bar now hides only while a box you type into has focus: text, number, email, password and search boxes and text areas (for example the score boxes when entering a result). It comes back when you leave the box, and does not flicker when you move from one score box to the next.
- Dropdowns, checkboxes, radio buttons and buttons leave the bar alone.
- **Changed:** `src/components/layout/BottomTabBar.vue`. Frontend only: no migration, no Edge Function changes.
- **Test:** the browser suite had a check asserting the old behaviour (bar hidden while a dropdown is focused). It now asserts the opposite for focused and opened dropdowns and buttons, and checks that the score boxes still hide the bar and release it afterwards (239 checks, passing). With the old behaviour put back, the new checks fail.
- **Not covered:** a real phone. The browser test can focus and open a dropdown but cannot show the phone's own picker or keyboard, so whether the bar sits well with them is for your phone to confirm.

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
