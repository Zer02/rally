// src/lib/sports.ts — v0.0.5.6
// Sport-specific wording and icons, keyed off leagues.sport. One place to
// add a sport: put an entry in SPORTS (and its aliases in ALIASES).
//
// leagues.sport is a free-text slug that people typed themselves ("tennis",
// "ping-pong", "Table Tennis"...), so lookups normalise it first: lowercase,
// letters and digits only. Anything unrecognised still works — it gets a
// title-cased label and neutral wording instead of another sport's.

export interface SportInfo {
  key:     string          // canonical slug stored on new leagues
  label:   string          // "Ping Pong"
  emoji:   string          // page-title and header emoji
  surface: string          // "table" | "court" — "Own the ___"
  gear?:   string          // "Paddle" | "Racket" — used in level titles
}

export const SPORTS: SportInfo[] = [
  { key: 'pingpong',   label: 'Ping Pong',  emoji: '🏓', surface: 'table', gear: 'Paddle' },
  { key: 'tennis',     label: 'Tennis',     emoji: '🎾', surface: 'court', gear: 'Racket' },
  { key: 'pickleball', label: 'Pickleball', emoji: '🏓', surface: 'court', gear: 'Paddle' },
  { key: 'badminton',  label: 'Badminton',  emoji: '🏸', surface: 'court', gear: 'Racket' },
  { key: 'squash',     label: 'Squash',     emoji: '🎾', surface: 'court', gear: 'Racket' },
  { key: 'padel',      label: 'Padel',      emoji: '🎾', surface: 'court', gear: 'Racket' },
]

const ALIASES: Record<string, string> = {
  tabletennis: 'pingpong',
  pingpong: 'pingpong',
  tt: 'pingpong',
  lawntennis: 'tennis',
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Used when a league has no sport we know (or nobody's signed into a league
// yet): neutral wording that's true of any of them.
const GENERIC: SportInfo = { key: '', label: 'League', emoji: '🏆', surface: 'court' }

export function getSport(slug?: string | null): SportInfo {
  if (!slug) return GENERIC
  const n = normalise(slug)
  const key = ALIASES[n] ?? n
  const known = SPORTS.find(s => s.key === key)
  if (known) return known
  // Unknown sport: keep the league's own word for it, but nothing sport-specific.
  const label = slug.trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { ...GENERIC, key, label: label || GENERIC.label }
}
