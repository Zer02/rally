// src/lib/score.ts — v0.0.6.8
//
// Round robin score rules, in one place for the front end. The format is
// first to GAMES_TO_WIN games (6 since v0.0.6.8), so a finished match is
// 6-0 up to 6-5 either way round. These mirror functions in the database,
// which is the real authority; if a rule changes, change both. The test
// suite (npm run test:js, tests/db) fails if they drift apart.
//   GAMES_TO_WIN         — rr_games_to_win() in supabase-migration-v0.0.6.8.sql
//   rr_score_is_legal()  — supabase-migration-v0.0.6.8.sql (last redefined there)
//   rr_match_points()    — supabase-migration-v0.0.6.4.sql (last redefined there)
//   XP per point         — c_xp_per_point in sync_quest_progress(), supabase-migration-v0.0.6.4.sql

/** Games a side needs to win a round robin match. */
export const GAMES_TO_WIN = 6

/** The most points a loss can earn (a loss earns the games you won, up to this). */
export const LOSS_MAX_POINTS = 3

/** Points a win earns. */
export const WIN_POINTS = 4

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/** True only for a finished result: one side exactly GAMES_TO_WIN, the other 0 up to one less. */
export function isLegalRrScore(a: unknown, b: unknown): boolean {
  if (!isCount(a) || !isCount(b)) return false
  return (a === GAMES_TO_WIN && b < GAMES_TO_WIN) || (b === GAMES_TO_WIN && a < GAMES_TO_WIN)
}

/**
 * Why a score can't be submitted, in words for the person typing it.
 * Returns null when the score is legal. Callers decide when to show it
 * (e.g. not while one box is still empty).
 */
export function rrScoreError(a: unknown, b: unknown): string | null {
  if (!isCount(a) || !isCount(b)) return 'Enter both scores as whole numbers.'
  if (isLegalRrScore(a, b)) return null
  if (a > GAMES_TO_WIN || b > GAMES_TO_WIN) return `A match is first to ${GAMES_TO_WIN} games, so no one can score more than ${GAMES_TO_WIN}.`
  if (a === GAMES_TO_WIN && b === GAMES_TO_WIN) return `Only one side can reach ${GAMES_TO_WIN}. Check both scores.`
  return `A match is first to ${GAMES_TO_WIN} games, so the winner needs ${GAMES_TO_WIN}.`
}

/** Match points for one side: 4 for a win; a loss earns its games won, 0 to 3. */
export function rrMatchPoints(gamesWon: number, gamesLost: number): number {
  return gamesWon > gamesLost ? WIN_POINTS : Math.max(0, Math.min(LOSS_MAX_POINTS, gamesWon))
}

/** Battle pass XP per match point for round robin matches (v0.0.6.4). */
export const XP_PER_POINT = 4

/** Play XP one round robin match is worth to one side, before the weekly cap. */
export function rrMatchXp(gamesWon: number, gamesLost: number): number {
  return XP_PER_POINT * rrMatchPoints(gamesWon, gamesLost)
}
