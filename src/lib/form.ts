// src/lib/form.ts — v0.0.7.7
//
// How a player is doing, worked out from the season's matches: their current winning
// streak, and their record against one opponent. Pure functions over match rows, so they
// are the same everywhere and easy to test (tests/js/form.test.mjs). Nothing here talks
// to the server: the Home page passes in the matches the season store already loaded.
//
// A match counts once it is completed with two different scores. Round robin and challenge
// matches both count: they are all matches somebody won.

export interface FormMatch {
  status: string
  player_a_id: string | null
  player_a2_id: string | null
  player_b_id: string | null
  player_b2_id: string | null
  score_a: number | null
  score_b: number | null
  completed_at: string | null
  created_at: string
}

/** Which side a player is on in a match: 'a', 'b', or null when they are not in it. */
export function sideOf(m: FormMatch, id: string): 'a' | 'b' | null {
  if (!id) return null
  if (m.player_a_id === id || m.player_a2_id === id) return 'a'
  if (m.player_b_id === id || m.player_b2_id === id) return 'b'
  return null
}

/** W or L from this player's side of a finished match; null if unfinished, a tie, or they were not in it. */
export function resultFor(m: FormMatch, id: string): 'W' | 'L' | null {
  const side = sideOf(m, id)
  if (!side || m.status !== 'completed' || m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  const mine = side === 'a' ? m.score_a : m.score_b
  const theirs = side === 'a' ? m.score_b : m.score_a
  return mine > theirs ? 'W' : 'L'
}

const when = (m: FormMatch) => m.completed_at ?? m.created_at

/** The player's finished matches, oldest first. */
export function playedBy<T extends FormMatch>(matches: T[], id: string): T[] {
  return matches
    .filter(m => resultFor(m, id) !== null)
    .sort((x, y) => when(x).localeCompare(when(y)))
}

/** Wins in a row, counting back from the latest finished match. 0 if the latest was a loss, or none were played. */
export function winStreak(matches: FormMatch[], id: string): number {
  let n = 0
  for (const m of playedBy(matches, id).reverse()) {
    if (resultFor(m, id) !== 'W') break
    n++
  }
  return n
}

const isSingles = (m: FormMatch) => !m.player_a2_id && !m.player_b2_id

/** Record against one opponent in finished one-on-one matches (doubles are not counted). */
export function headToHead(matches: FormMatch[], id: string, oppId: string): { wins: number; losses: number } {
  const rec = { wins: 0, losses: 0 }
  if (!id || !oppId || id === oppId) return rec
  for (const m of matches) {
    if (!isSingles(m)) continue
    const mine = sideOf(m, id), theirs = sideOf(m, oppId)
    if (!mine || !theirs || mine === theirs) continue
    const r = resultFor(m, id)
    if (r === 'W') rec.wins++
    else if (r === 'L') rec.losses++
  }
  return rec
}

/** A head-to-head in words, for the line under an upcoming match. */
export function headToHeadText(h: { wins: number; losses: number }): string {
  if (h.wins === 0 && h.losses === 0) return 'First meeting this season'
  if (h.wins > h.losses) return `You lead ${h.wins}–${h.losses} this season`
  if (h.wins < h.losses) return `You trail ${h.wins}–${h.losses} this season`
  return `Level ${h.wins}–${h.losses} this season`
}
