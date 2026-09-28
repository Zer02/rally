// src/lib/xp.ts — v0.0.5.0
// Battle-pass levels. Same pattern as TIERS in rating.ts: a small
// hardcoded client-side list rather than a DB table, since this is
// static reference data with no need for server-side computation.
// Ordered descending by xp, same convention as TIERS.

export const LEVELS = [
  { level: 10, xp: 2250, title: 'Table Legend' },
  { level: 9,  xp: 1800, title: 'Court Regular' },
  { level: 8,  xp: 1400, title: 'Table Tactician' },
  { level: 7,  xp: 1050, title: 'Rally Veteran' },
  { level: 6,  xp: 750,  title: 'Club Regular' },
  { level: 5,  xp: 500,  title: 'Paddle Enthusiast' },
  { level: 4,  xp: 300,  title: 'Rally Regular' },
  { level: 3,  xp: 150,  title: 'Weekend Warrior' },
  { level: 2,  xp: 50,   title: 'Backyard Beginner' },
  { level: 1,  xp: 0,    title: 'Newcomer' },
] as const

export type Level = typeof LEVELS[number]

export function getLevel(xp: number): Level {
  return LEVELS.find(l => xp >= l.xp) ?? LEVELS[LEVELS.length - 1]
}

export function getNextLevel(xp: number): Level | null {
  const current = getLevel(xp)
  const idx = LEVELS.findIndex(l => l.level === current.level)
  return idx > 0 ? LEVELS[idx - 1] : null // idx 0 is the highest level (list is descending)
}

export interface LevelProgress {
  current:     Level
  next:        Level | null // null = already at the top level
  xpIntoLevel: number
  xpForLevel:  number       // 0 when maxed out (progressPct is 100 then)
  progressPct: number
}

export function levelProgress(xp: number): LevelProgress {
  const current = getLevel(xp)
  const next = getNextLevel(xp)
  if (!next) return { current, next: null, xpIntoLevel: 0, xpForLevel: 0, progressPct: 100 }
  const xpForLevel = next.xp - current.xp
  const xpIntoLevel = xp - current.xp
  return {
    current, next, xpIntoLevel, xpForLevel,
    progressPct: Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100)),
  }
}
