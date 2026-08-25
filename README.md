# RALLY 🏓

> Current version: **v0.0.1**

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
* Everything works! (...mostly)
* Slight fix needed: when entering scores, if player 1 enters a score different from player 2 after player 2 finished submitting the score result, it will go to the player who entered the score last. This only works (I think) when both players are on the enter score page at the same exact time. More tests required to see if this is always true (i.e. both players get a chance to report their scores from their perspectives, maybe middleman admin can be flagged when players' scores do not match?)

- **Bug fixed:** last-write-wins score submission replaced with independent per-player reporting
- Each player submits their own version of the result independently after a match
- If both players report the same winner → match auto-completes and ratings update
- If players report different winners → match is flagged as `disputed` for admin review
- Matches view now shows three sections: disputed (needs resolution), needs your attention, waiting for opponent
- Admin dispute resolution: either player choice can be selected as canonical winner (proper role-based admin panel coming later)
- `ResultModal` now shows info banner explaining the two-confirmation flow
- `supabase-migration-v0.0.2.sql` added — run this in SQL Editor to add the new columns (safe, additive only)

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
    │   └── matches.ts
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

- [ ] Rating history chart on player profiles
- [ ] Push/email notifications for incoming challenges
- [ ] Admin: season reset, dispute resolution
- [ ] Head-to-head records between two players
- [ ] Weekly digest (most active player, biggest rating swing)
