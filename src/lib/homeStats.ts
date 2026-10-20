// src/lib/homeStats.ts — v0.0.8.6
//
// Small pure helpers behind the home page's numbers. They only describe data the app already
// has (completed matches, rating history, names); nothing here is invented or scheduled.
import type { SportInfo } from '@/lib/sports'

const DAY_MS = 24 * 60 * 60 * 1000

/** The local calendar day of a timestamp, as "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Days in a row, ending today, on which the league played at least one match.
 * A streak is still alive if today has no match yet but yesterday did; it ends once a
 * whole day passes with none. Timestamps that are missing or not dates are ignored.
 */
export function dayStreak(timestamps: Array<string | null | undefined>, now: Date): number {
  const played = new Set<string>()
  for (const t of timestamps) {
    if (!t) continue
    const d = new Date(t)
    if (!Number.isNaN(d.getTime())) played.add(dayKey(d))
  }
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!played.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (played.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** How many timestamps fall within the last `days` days (not in the future). */
export function countWithin(timestamps: Array<string | null | undefined>, now: Date, days = 7): number {
  const from = now.getTime() - days * DAY_MS
  let n = 0
  for (const t of timestamps) {
    if (!t) continue
    const ms = new Date(t).getTime()
    if (!Number.isNaN(ms) && ms >= from && ms <= now.getTime()) n++
  }
  return n
}

export const STARTING_RATING = 1000

/**
 * Rating change over the last `days` days: the current rating minus the last rating recorded
 * before that window. A player with no history before the window started from the default
 * rating, so their whole climb counts.
 */
export function ratingChange(
  history: Array<{ rating: number; recorded_at: string }>,
  current: number,
  now: Date,
  days = 7,
): number {
  const cutoff = now.getTime() - days * DAY_MS
  let baseline = STARTING_RATING
  let latest = -Infinity
  for (const h of history) {
    const ms = new Date(h.recorded_at).getTime()
    if (Number.isNaN(ms) || ms >= cutoff) continue
    if (ms > latest) { latest = ms; baseline = h.rating }
  }
  return Math.round(current - baseline)
}

/** "Jayden Rivera" -> "Jayden R."; a single name stays as it is. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/** Up to two capital letters for an avatar: "Jayden Rivera" -> "JR", "cat" -> "C". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

/** "1842" -> "1,842". */
export const formatRating = (n: number): string => Math.round(n).toLocaleString('en-US')

/** The hero's eyebrow, headline and one-line pitch for a sport: table sports get the table wording. */
export function heroCopy(sport: Pick<SportInfo, 'surface' | 'label'>): { eyebrow: string; line1: string; line2: string; sub: string; art: 'table' | 'court' } {
  if (sport.surface === 'table') {
    return {
      eyebrow: 'Your building. Your league.',
      line1: 'Every table has a story.', line2: 'Make yours count.',
      sub: 'Challenge your neighbors, track your rating, and turn casual games into a living league.',
      art: 'table',
    }
  }
  return {
    // a league whose sport is not known yet shows the general line rather than a bare "League"
    eyebrow: sport.label && sport.label !== 'League' ? sport.label : 'Your building. Your league.',
    line1: 'Track every rally.', line2: 'Own the court.',
    sub: 'Live ratings for everyone in the building. Challenge neighbors, log scores, climb the leaderboard.',
    art: 'court',
  }
}
