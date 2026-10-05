// src/lib/score.ts — v0.0.6.3
//
// Round robin score rules, in one place for the front end. The format is
// first to 4 games, no-ad, so a finished match is 4-0, 4-1, 4-2 or 4-3 either
// way round. These mirror two functions in the database, which is the real
// authority; if a rule changes, change both:
//   rr_score_is_legal()  — supabase-migration-v0.0.6.3.sql
//   rr_match_points()    — supabase-migration-v0.0.6.2.sql

export const GAMES_TO_WIN = 4

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/** True only for a finished first-to-4 result: one side exactly 4, the other 0–3. */
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

/** Match points for one side: 4 for a win; a loss earns its games won, min 1, max 3. */
export function rrMatchPoints(gamesWon: number, gamesLost: number): number {
  return gamesWon > gamesLost ? 4 : Math.max(1, Math.min(3, gamesWon))
}
