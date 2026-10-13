// src/lib/score.ts — v0.0.7.2
//
// Round robin score rules, in one place for the front end. A match is first
// to 4 games, or (when other courts are still busy) a full set to 6; at 5-5
// the next game wins. The score itself says which was played, so nobody
// picks a format: a finished match is 4-0 to 4-3 either way round, or 6-0 to
// 6-5 either way round. These mirror functions in the database, which is the
// real authority; if a rule changes, change both. The test suite
// (npm run test:js, tests/db) fails if they drift apart.
//   GAME_TARGETS, rr_score_is_legal() — supabase/migrations/supabase-migration-v0.0.7.2.sql
//   rr_match_points()                 — supabase/migrations/supabase-migration-v0.0.7.2.sql
//   XP per point — c_xp_per_point in sync_quest_progress(), supabase/migrations/supabase-migration-v0.0.6.4.sql

/** The game targets a match can be played to: first to 4, or a full set to 6. */
export const GAME_TARGETS = [4, 6] as const

/** The most games either side can hold (the biggest target). */
export const MAX_GAMES = 6

/** The most points a loss can earn (a loss one game short of the target). */
export const LOSS_MAX_POINTS = 3

/** Points a win earns. */
export const WIN_POINTS = 4

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/** True only for a finished result: the winner exactly on a target, the loser 0 up to one less. */
export function isLegalRrScore(a: unknown, b: unknown): boolean {
  if (!isCount(a) || !isCount(b)) return false
  return GAME_TARGETS.some(t => (a === t && b < t) || (b === t && a < t))
}

/**
 * Why a score can't be submitted, in words for the person typing it.
 * Returns null when the score is legal. Callers decide when to show it
 * (e.g. not while one box is still empty).
 */
export function rrScoreError(a: unknown, b: unknown): string | null {
  if (!isCount(a) || !isCount(b)) return 'Enter both scores as whole numbers.'
  if (isLegalRrScore(a, b)) return null
  if (a > MAX_GAMES || b > MAX_GAMES) return `A match is first to 4 games, or a full set to 6, so no one can score more than ${MAX_GAMES}.`
  if (a === b) return 'The two scores can\u2019t be equal. Play on until one side reaches 4 (or 6 for a full set).'
  return 'The winner needs exactly 4 games (first to 4) or exactly 6 (a full set).'
}

/**
 * Match points for one side. A win is 4. A loss earns 0 to 3 by how close it
 * was, relative to the target the winner reached (the winner's score, which is
 * gamesLost here): round(3 * gamesWon / (target - 1)), halves up.
 *   first to 4: 0-4 earns 0, 1-4 earns 1, 2-4 earns 2, 3-4 earns 3
 *   set to 6:   0-6 earns 0, 1-6 and 2-6 earn 1, 3-6 and 4-6 earn 2, 5-6 earns 3
 * The target is floored at 2 so the function is defined for every pair of
 * numbers; legal scores only ever have a target of 4 or 6.
 */
export function rrMatchPoints(gamesWon: number, gamesLost: number): number {
  if (gamesWon > gamesLost) return WIN_POINTS
  const span = Math.max(gamesLost, 2) - 1
  return Math.max(0, Math.min(LOSS_MAX_POINTS, Math.floor((6 * gamesWon + span) / (2 * span))))
}

/** Battle pass XP per match point for round robin matches (v0.0.6.4). */
export const XP_PER_POINT = 4

/** Play XP one round robin match is worth to one side, before the weekly cap. */
export function rrMatchXp(gamesWon: number, gamesLost: number): number {
  return XP_PER_POINT * rrMatchPoints(gamesWon, gamesLost)
}
