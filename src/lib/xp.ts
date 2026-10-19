// src/lib/xp.ts — v0.0.8.4
// Battle-pass levels. Same pattern as TIERS in rating.ts: a small
// hardcoded client-side list rather than a DB table, since this is
// static reference data with no need for server-side computation.
// Ordered descending by xp, same convention as TIERS.

// v0.0.8.4: the pass belongs to the round robin season and is sized for one. Pass XP is what a
// player earned since the newest season began (players.pass_xp); lifetime XP (players.xp) is kept
// separately and never resets. Level 10 is 1,400 XP, about 117 XP per week of a typical 12-week
// season. Worked out against these players over 12 weeks (see tests/js/xp.test.mjs):
//   regular, every week, 3 matches and the easy quests ....... level 10 around week 8
//   completionist, every quest every week .................... around week 6-7
//   misses 4 weeks, then plays 8 matches a week with quests .. around week 11
//   spam with no quests at all ............................... about level 5 (it pays little, never nothing)
//   casual, 2 matches every other week ....................... about level 4-5
// To change the pace, scale the xp values below. The XP per match and per quest lives in
// supabase/migrations (v0.0.8.4 for the shrinking match XP, v0.0.8.3 and earlier for quests).
// Titles that mention the surface or gear ("Table Legend", "Paddle Enthusiast")
// are built from the league's sport so a tennis league gets "Court Legend" and
// "Racket Enthusiast". Pass a SportInfo (from useSport) to any function below;
// without one the wording stays neutral.
import { getSport, type SportInfo } from '@/lib/sports'

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

const LEVEL_DEFS: { level: number; xp: number; title: (s: SportInfo) => string }[] = [
  { level: 10, xp: 1400, title: s => `${cap(s.surface)} Legend` },
  { level: 9,  xp: 1250, title: s => `${cap(s.surface)} Regular` },
  { level: 8,  xp: 1075, title: s => `${cap(s.surface)} Tactician` },
  { level: 7,  xp: 900,  title: () => 'Rally Veteran' },
  { level: 6,  xp: 750,  title: () => 'Club Regular' },
  { level: 5,  xp: 600,  title: s => s.gear ? `${s.gear} Enthusiast` : 'Enthusiast' },
  { level: 4,  xp: 425,  title: () => 'Rally Regular' },
  { level: 3,  xp: 250,  title: () => 'Weekend Warrior' },
  { level: 2,  xp: 100,  title: () => 'Backyard Beginner' },
  { level: 1,  xp: 0,    title: () => 'Newcomer' },
]

export interface Level { level: number; xp: number; title: string }

function levels(sport?: SportInfo): Level[] {
  const s = sport ?? getSport(null)
  return LEVEL_DEFS.map(d => ({ level: d.level, xp: d.xp, title: d.title(s) }))
}

/** Every level, lowest first: what the pass view lists. */
export function allLevels(sport?: SportInfo): Level[] {
  return levels(sport).slice().reverse()
}

export function getLevel(xp: number, sport?: SportInfo): Level {
  const all = levels(sport)
  return all.find(l => xp >= l.xp) ?? all[all.length - 1]
}

export function getNextLevel(xp: number, sport?: SportInfo): Level | null {
  const all = levels(sport)
  const current = getLevel(xp, sport)
  const idx = all.findIndex(l => l.level === current.level)
  return idx > 0 ? all[idx - 1] : null // idx 0 is the highest level (list is descending)
}

export interface LevelProgress {
  current:     Level
  next:        Level | null // null = already at the top level
  xpIntoLevel: number
  xpForLevel:  number       // 0 when maxed out (progressPct is 100 then)
  progressPct: number
}

export function levelProgress(xp: number, sport?: SportInfo): LevelProgress {
  const current = getLevel(xp, sport)
  const next = getNextLevel(xp, sport)
  if (!next) return { current, next: null, xpIntoLevel: 0, xpForLevel: 0, progressPct: 100 }
  const xpForLevel = next.xp - current.xp
  const xpIntoLevel = xp - current.xp
  return {
    current, next, xpIntoLevel, xpForLevel,
    progressPct: Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100)),
  }
}
