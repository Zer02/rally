// The battle pass levels (src/lib/xp.ts, v0.0.8.4) and whether the curve really fits a season.
// The expected values are written out here from the design, NOT read from xp.ts, so changing the
// curve means changing it here on purpose.
//   run:  node --test tests/js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from '../lib/load-score.mjs'

const xp = await loadLib('xp')
const THRESHOLDS = [0, 100, 250, 425, 600, 750, 900, 1075, 1250, 1400]   // level 1 .. 10

test('the pass has ten levels at these XP thresholds, lowest first', () => {
  assert.deepEqual(xp.allLevels().map(l => l.xp), THRESHOLDS)
  assert.deepEqual(xp.allLevels().map(l => l.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('each level starts exactly at its threshold', () => {
  THRESHOLDS.forEach((t, i) => {
    assert.equal(xp.getLevel(t).level, i + 1, `${t} XP`)
    if (t > 0) assert.equal(xp.getLevel(t - 1).level, i, `${t - 1} XP`)
  })
})

test('there is a top level, and it has no next one', () => {
  assert.equal(xp.getLevel(1400).level, 10)
  assert.equal(xp.getLevel(99999).level, 10)
  assert.equal(xp.getNextLevel(1400), null)
  const lp = xp.levelProgress(5000)
  assert.equal(lp.next, null)
  assert.equal(lp.progressPct, 100)
})

test('progress inside a level: the share of the way to the next', () => {
  const lp = xp.levelProgress(325)                 // level 3 (250) towards level 4 (425)
  assert.equal(lp.current.level, 3)
  assert.equal(lp.next.level, 4)
  assert.equal(lp.xpIntoLevel, 75)
  assert.equal(lp.xpForLevel, 175)
  assert.equal(lp.progressPct, 43)
  assert.equal(xp.levelProgress(0).progressPct, 0)
})

test('titles follow the sport: gear and surface words change, the rest do not', () => {
  const tennis = { surface: 'court', gear: 'Racket' }, pingpong = { surface: 'table', gear: 'Paddle' }
  assert.equal(xp.allLevels(tennis)[9].title, 'Court Legend')
  assert.equal(xp.allLevels(pingpong)[9].title, 'Table Legend')
  assert.equal(xp.allLevels(tennis)[4].title, 'Racket Enthusiast')
  assert.equal(xp.allLevels(pingpong)[3].title, 'Rally Regular')
  assert.equal(xp.allLevels(tennis)[0].title, 'Newcomer')
})

// ── Does the curve fit a 12-week season? ────────────────────────────────────────────────────
// The XP rules as they are in the database, written out again here (match XP shrinks with volume
// and with repeat meetings in a week; quest rewards as listed in the migrations).
const vol = n => (n <= 5 ? 1 : n <= 8 ? 0.5 : n <= 12 ? 0.25 : 0.1)
const rep = k => (k <= 1 ? 1 : k === 2 ? 0.5 : k === 3 ? 0.25 : 0.1)
const AVG_MATCH_XP = 12          // a typical round robin match: 16 for a win, 0 to 12 for a loss
function playXp(matches, opponents) {
  const seen = {}
  let total = 0
  for (let i = 0; i < matches; i++) {
    const o = i % opponents; seen[o] = (seen[o] ?? 0) + 1
    total += Math.max(1, Math.round(AVG_MATCH_XP * vol(i + 1) * rep(seen[o])))
  }
  return total
}
const QUEST = { show: 15, hat: 30, chal: 20, punch: 25, fresh: 40, reach: 40 }
const EASY = ['show', 'hat', 'chal', 'punch']

/** The week a player first has `levelXp`, over a 12 week season; null if they never do. */
function weekReached(levelXp, persona) {
  let total = 0, weeksPlayed = 0, vet = false, bounce = false
  const monthWeeks = {}
  for (let w = 1; w <= 12; w++) {
    if (persona.plays(w)) {
      const { matches, opponents, quests } = persona.week(w)
      total += playXp(matches, opponents) + quests.reduce((s, k) => s + QUEST[k], 0)
      weeksPlayed++; monthWeeks[Math.ceil(w / 4)] = (monthWeeks[Math.ceil(w / 4)] ?? 0) + 1
      if (weeksPlayed >= 5 && !vet) { total += 100; vet = true }     // Season Veteran
      if (!bounce) { total += 30; bounce = true }                      // Bounce Back
    }
    if (w % 4 === 0 && persona.monthly) {
      const k = monthWeeks[w / 4] ?? 0
      if (k >= 3) total += 80       // Regular
      if (k >= 1) total += 40       // Social Butterfly
    }
    if (total >= levelXp) return w
  }
  return null
}
const missing = w => ![2, 3, 6, 7].includes(w)
const PERSONAS = {
  regular:       { plays: () => true, monthly: true, week: w => ({ matches: 3, opponents: 3, quests: [...EASY, ...(w % 2 ? ['fresh'] : []), ...(w % 3 === 0 ? ['reach'] : [])] }) },
  completionist: { plays: () => true, monthly: true, week: () => ({ matches: 4, opponents: 4, quests: Object.keys(QUEST) }) },
  catchUp:       { plays: missing,    monthly: true, week: w => ({ matches: 8, opponents: 4, quests: [...EASY, ...(w % 2 ? ['fresh'] : [])] }) },
  spamSameFew:   { plays: missing,    monthly: true, week: () => ({ matches: 10, opponents: 3, quests: EASY }) },
  spamNoQuests:  { plays: missing,    monthly: false, week: () => ({ matches: 10, opponents: 5, quests: [] }) },
  casual:        { plays: w => w % 2 === 0, monthly: true, week: () => ({ matches: 2, opponents: 2, quests: ['show', 'chal'] }) },
}
const top = () => xp.getLevel(99999).xp

test('pacing: someone who plays every week with the easy quests finishes the pass well inside a season', () => {
  const w = weekReached(top(), PERSONAS.regular)
  assert.ok(w !== null && w >= 6 && w <= 9, `week ${w}`)
})

test('pacing: doing every quest every week finishes sooner, but not in the first month', () => {
  const w = weekReached(top(), PERSONAS.completionist)
  assert.ok(w !== null && w >= 5 && w <= 7, `week ${w}`)
})

test('pacing: missing four weeks and then playing eight matches a week still finishes before the season ends', () => {
  const w = weekReached(top(), PERSONAS.catchUp)
  assert.ok(w !== null && w <= 12, `week ${w}`)
})

test('pacing: spamming the same few opponents can catch up, but only just, and only by also ticking the quests it unlocks', () => {
  const w = weekReached(top(), PERSONAS.spamSameFew)
  assert.ok(w !== null && w >= 11, `week ${w}`)
})

test('pacing: spam with no quests does not finish, and casual play does not either', () => {
  assert.equal(weekReached(top(), PERSONAS.spamNoQuests), null)
  assert.equal(weekReached(top(), PERSONAS.casual), null)
})

test('pacing: repeat games really are worth far less: ten games against one person pay a fraction of ten against ten people', () => {
  assert.ok(playXp(10, 1) < playXp(10, 10) / 2)
  assert.ok(playXp(10, 1) >= 10, 'but each still pays at least 1 XP')
})
