// src/lib/bracket.ts — v0.0.8.5
//
// Pure helpers for knockout tournaments. The database (supabase-migration-v0.0.8.5.sql)
// is the authority on the draw, byes and what may be scored; these only describe the
// result on screen and fail fast with the same plain reasons.
import type { BracketMatch, Profile } from '@/types'

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 64

/** Slots in the bracket: the next power of two at or above the number of players. */
export function bracketSize(players: number): number {
  let size = 2
  while (size < players) size *= 2
  return size
}

export const byeCount = (players: number): number => bracketSize(players) - players
export const roundCount = (size: number): number => Math.round(Math.log2(size))

/** "Final", "Semifinals", "Quarterfinals", then "Round of 16", "Round of 32"... */
export function roundName(round: number, rounds: number): string {
  const left = rounds - round
  if (left === 0) return 'Final'
  if (left === 1) return 'Semifinals'
  if (left === 2) return 'Quarterfinals'
  return `Round of ${2 ** (left + 1)}`
}

/** Why a field of this size cannot be drawn, or null if it can. */
export function entrantError(players: number): string | null {
  if (players < MIN_PLAYERS) return `Pick at least ${MIN_PLAYERS} players.`
  if (players > MAX_PLAYERS) return `A tournament holds at most ${MAX_PLAYERS} players.`
  return null
}

/** Matches grouped by round (round 1 first), each round in slot order. */
export function groupRounds(matches: BracketMatch[]): BracketMatch[][] {
  const byRound = new Map<number, BracketMatch[]>()
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  }
  return [...byRound.keys()].sort((a, b) => a - b)
    .map(r => byRound.get(r)!.sort((a, b) => a.slot - b.slot))
}

/** The player who lost a finished match (null for a bye or an unplayed match). */
export function matchLoserId(m: BracketMatch): string | null {
  if (m.status !== 'completed' || !m.winner_id) return null
  return m.winner_id === m.player_a_id ? m.player_b_id : m.player_a_id
}

/**
 * Whether a result can be entered or corrected now, and if not, why.
 * Mirrors report_bracket_match(): not a bye, both players known, and the match the
 * winner moved into has not been played yet.
 */
export function scoreBlock(m: BracketMatch, all: BracketMatch[]): string | null {
  if (m.status === 'bye') return 'That slot is a bye.'
  if (!m.player_a_id || !m.player_b_id) return 'Waiting for the earlier round to be played.'
  if (m.status === 'completed') {
    const next = all.find(x => x.round === m.round + 1 && x.slot === Math.ceil(m.slot / 2))
    if (next && next.status === 'completed') return 'Locked: the winner has already played the next round.'
  }
  return null
}

export const profileName = (p?: Pick<Profile, 'display_name' | 'username'> | null): string =>
  p ? (p.display_name || p.username) : 'TBD'
