// src/lib/homeStats.ts — v0.0.9.2
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

/**
 * The hero's eyebrow, headline and one-line pitch for a sport. Table sports get the table wording and court sports
 * the court wording; neither mentions a building or neighbors.
 */
export function heroCopy(sport: Pick<SportInfo, 'surface' | 'label'>): { eyebrow: string; line1: string; line2: string; sub: string; art: 'table' | 'court' } {
  const known = !!sport.label && sport.label !== 'League'
  if (sport.surface === 'table') {
    return {
      eyebrow: known ? sport.label : 'Your league. Your game.',
      line1: 'Every table has a story.', line2: 'Make yours count.',
      sub: 'Challenge other players, track your rating, and turn casual games into a living league.',
      art: 'table',
    }
  }
  return {
    // a league whose sport is not known yet shows the general line rather than a bare "League"
    eyebrow: known ? sport.label : 'Your league. Your game.',
    line1: 'Track every rally.', line2: 'Own the court.',
    sub: 'Live ratings for everyone in your league. Challenge other players, log scores, climb the leaderboard.',
    art: 'court',
  }
}

/** One of the two pictures behind the home page and the profile header, with how to crop it. */
export interface HeroScene {
  art: 'table' | 'court'
  src: string
  alt: string
  /** the picture file's real size in pixels (a test reads the JPEG headers and checks these) */
  width: number
  height: number
  /** the visitor hero: which part to keep (object-position) on a wide screen and on a phone, and how wide the block is */
  wide: string
  narrow: string
  block: string
  /** the narrow banner behind a signed-in greeting and the profile header: which part to keep on a wide screen and on a phone */
  banner: string
  bannerNarrow: string
}

const SCENES: Record<'table' | 'court', HeroScene> = {
  // the dusk tennis court: the racket and skyline are on the right
  court: { art: 'court', src: '/hero/tennis.jpg', alt: 'A tennis court', width: 1228, height: 454,
    wide: '100% 50%', narrow: '78% 50%', block: '72%', banner: '100% 78%', bannerNarrow: '80% 78%' },
  // the outdoor ping pong table: the paddles and ball are on the left
  table: { art: 'table', src: '/hero/table.jpg', alt: 'A ping pong table', width: 1228, height: 417,
    wide: '20% 82%', narrow: '40% 50%', block: '60%', banner: '30% 86%', bannerNarrow: '38% 84%' },
}

/** The picture (file, size and crops) for a sport's art, as `heroCopy` names it. The one place these are written down. */
export function heroScene(art: 'table' | 'court'): HeroScene {
  return art === 'table' ? SCENES.table : SCENES.court
}

// ── v0.0.9.2: the round robin standings under the ladder on a tennis league's home page ──────────────────────

/** A season's participant row as the home page reads it. */
export interface RoundRobinInput {
  profile_id: string
  rr_points?: number | null
  wins?: number | null
  losses?: number | null
  points_for?: number | null
  profile?: { display_name?: string | null; username?: string | null } | null
}

export interface RoundRobinRow { rank: number; profile_id: string; name: string; points: number; wins: number; losses: number }

/**
 * The top of the round robin standings, in the order the Leaderboard page uses: round robin points, then wins, then total
 * games won (points_for). Ranks are 1, 2, 3... in that order, like the Leaderboard (tied players are not given a shared rank).
 */
export function roundRobinTop(rows: RoundRobinInput[], limit = 5): RoundRobinRow[] {
  const n = (v: number | null | undefined) => v ?? 0
  return [...rows]
    .sort((a, b) => n(b.rr_points) - n(a.rr_points) || n(b.wins) - n(a.wins) || n(b.points_for) - n(a.points_for))
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      profile_id: r.profile_id,
      name: r.profile?.display_name || r.profile?.username || 'Player',
      points: n(r.rr_points), wins: n(r.wins), losses: n(r.losses),
    }))
}

/** Only a tennis league shows the round robin standings on the home page; table tennis (and the rest) keep the ladder alone. */
export function showsRoundRobinBoard(sportKey: string | null | undefined): boolean {
  return sportKey === 'tennis'
}
