// src/lib/xp.ts — v0.0.5.6
// Battle-pass levels. Same pattern as TIERS in rating.ts: a small
// hardcoded client-side list rather than a DB table, since this is
// static reference data with no need for server-side computation.
// Ordered descending by xp, same convention as TIERS.

// v0.0.5.1: retuned against the XP balance model. A player earning
// ~180 XP/week (4 matches + all quests, or 15 matches and no quests)
// reaches Level 10 in about a year; early levels come within a few weeks
// so new players feel movement right away. To change the overall pace,
// scale every xp value here — the per-match / quest numbers live in
// supabase-migration-v0.0.5.1.sql.
// Titles that mention the surface or gear ("Table Legend", "Paddle Enthusiast")
// are built from the league's sport so a tennis league gets "Court Legend" and
// "Racket Enthusiast". Pass a SportInfo (from useSport) to any function below;
// without one the wording stays neutral.
import { getSport, type SportInfo } from '@/lib/sports'

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

const LEVEL_DEFS: { level: number; xp: number; title: (s: SportInfo) => string }[] = [
  { level: 10, xp: 9000, title: s => `${cap(s.surface)} Legend` },
  { level: 9,  xp: 6200, title: s => `${cap(s.surface)} Regular` },
  { level: 8,  xp: 4100, title: s => `${cap(s.surface)} Tactician` },
  { level: 7,  xp: 2800, title: () => 'Rally Veteran' },
  { level: 6,  xp: 1850, title: () => 'Club Regular' },
  { level: 5,  xp: 1150, title: s => s.gear ? `${s.gear} Enthusiast` : 'Enthusiast' },
  { level: 4,  xp: 650,  title: () => 'Rally Regular' },
  { level: 3,  xp: 300,  title: () => 'Weekend Warrior' },
  { level: 2,  xp: 100,  title: () => 'Backyard Beginner' },
  { level: 1,  xp: 0,    title: () => 'Newcomer' },
]

export interface Level { level: number; xp: number; title: string }

function levels(sport?: SportInfo): Level[] {
  const s = sport ?? getSport(null)
  return LEVEL_DEFS.map(d => ({ level: d.level, xp: d.xp, title: d.title(s) }))
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
