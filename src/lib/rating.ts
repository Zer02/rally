// src/lib/rating.ts
// TrueSkill-lite rating system for small closed communities

export const BASE_RATING     = 1000
export const BASE_UNCERTAINTY = 200

export const TIERS = [
  { label: 'Champion', key: 'champion', min: 1200 },
  { label: 'Veteran',  key: 'veteran',  min: 1100 },
  { label: 'Rival',    key: 'rival',    min: 1000 },
  { label: 'Contender',key: 'contender',min:  900 },
  { label: 'Rookie',   key: 'rookie',   min:    0 },
] as const

export function getTier(rating: number) {
  return TIERS.find(t => rating >= t.min) ?? TIERS[TIERS.length - 1]
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400))
}

// K scales with uncertainty (new players move faster) and streak bonus
export function effectiveK(uncertainty: number, streak: number): number {
  const baseK     = 32
  const uFactor   = Math.max(0.5, uncertainty / BASE_UNCERTAINTY)  // 0.5–1.5
  const streakMod = Math.min(1.3, 1 + Math.abs(streak) * 0.05)     // up to 30% boost on hot streaks
  return baseK * uFactor * streakMod
}

export function decayUncertainty(u: number): number {
  return Math.max(50, u * 0.96)
}

export function matchQuality(r1: number, r2: number): number {
  return Math.max(0, 1 - Math.abs(r1 - r2) / 600)
}

export interface RatingResult {
  winnerDelta:       number
  loserDelta:        number
  winnerNewRating:   number
  loserNewRating:    number
  winnerUncertainty: number
  loserUncertainty:  number
  quality:           number
}

export function calculateResult(
  winner: { rating: number; uncertainty: number; streak: number },
  loser:  { rating: number; uncertainty: number; streak: number },
): RatingResult {
  const quality    = matchQuality(winner.rating, loser.rating)
  const exp        = expectedScore(winner.rating, loser.rating)
  const kW         = effectiveK(winner.uncertainty, winner.streak)
  const kL         = effectiveK(loser.uncertainty,  loser.streak)
  const winnerDelta = Math.round(kW * (1 - exp))
  const loserDelta  = Math.round(kL * (0 - (1 - exp)))

  return {
    winnerDelta,
    loserDelta,
    winnerNewRating:   winner.rating + winnerDelta,
    loserNewRating:    loser.rating  + loserDelta,
    winnerUncertainty: decayUncertainty(winner.uncertainty),
    loserUncertainty:  decayUncertainty(loser.uncertainty),
    quality,
  }
}

export function qualityLabel(q: number): { label: string; key: string } {
  if (q > 0.85) return { label: 'Elite match',       key: 'elite' }
  if (q > 0.65) return { label: 'Competitive',       key: 'competitive' }
  if (q > 0.4)  return { label: 'Uneven',            key: 'uneven' }
  return              { label: 'Mismatch',           key: 'mismatch' }
}

// Points preview before a match is played
export function previewPoints(
  challenger: { rating: number; uncertainty: number; streak: number },
  opponent:   { rating: number; uncertainty: number; streak: number },
) {
  const ifChallengerWins = calculateResult(challenger, opponent)
  const ifOpponentWins   = calculateResult(opponent, challenger)
  return {
    challengerWinDelta:  ifChallengerWins.winnerDelta,
    challengerLossDelta: ifOpponentWins.loserDelta,
    opponentWinDelta:    ifOpponentWins.winnerDelta,
    opponentLossDelta:   ifChallengerWins.loserDelta,
    quality:             ifChallengerWins.quality,
  }
}
