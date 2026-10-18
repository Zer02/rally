// src/lib/quests.ts - v0.0.8.3
// What the rating-aware weekly quests look like for one player. The quests themselves are
// scored in the database (sync_quest_progress, migration v0.0.8.3); this only decides what the
// Progress screen shows. The gaps below are the same numbers the database uses - change both.

/** Punch Up: an opponent rated at least this far above you. */
export const PUNCH_UP_GAP = 25
/** Reach: an opponent rated at least this far above you. */
export const REACH_GAP = 100
/** Fair Fight (for the player at the top): an opponent within this many points, or anyone below. */
export const CLOSE_GAP = 100

/** Nobody in the league is rated PUNCH_UP_GAP or more above you (you are at the top, or tied with it). */
export function isAtTop(myRating: number, others: number[]): boolean {
  return !others.some(r => r >= myRating + PUNCH_UP_GAP)
}

/** Somebody is rated REACH_GAP or more above you, so Reach can be earned. */
export function canReach(myRating: number, others: number[]): boolean {
  return others.some(r => r >= myRating + REACH_GAP)
}

interface Texty { key: string; title: string; description: string }

/**
 * The quest as this player should see it, or null to hide it.
 *  - Reach is hidden while nobody is far enough above you.
 *  - Punch Up becomes "Fair Fight or Mentor" at the top, where nobody is above you to punch up at.
 * Every other quest is shown as it is.
 */
export function questForPlayer<T extends Texty>(t: T, myRating: number, others: number[]): T | null {
  if (t.key === 'weekly_reach' && !canReach(myRating, others)) return null
  if (t.key === 'weekly_punch_up' && isAtTop(myRating, others)) {
    return {
      ...t,
      title: 'Fair Fight or Mentor',
      description: `Play a close match (within ${CLOSE_GAP} points) or someone rated below you - win or lose`,
    }
  }
  return t
}
