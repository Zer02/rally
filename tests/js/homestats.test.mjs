// Home page numbers (src/lib/homeStats.ts). Expected values are worked out by hand, not by the code under test.
//   run: npm run test:js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from '../lib/load-score.mjs'

const h = await loadLib('homeStats')
// A fixed "now": Wednesday 21 October 2026, 15:00 local time.
const NOW = new Date(2026, 9, 21, 15, 0, 0)
const at = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh, 0, 0).toISOString()

test('day streak counts days in a row ending today', () => {
  assert.equal(h.dayStreak([at(2026, 10, 21), at(2026, 10, 20), at(2026, 10, 19)], NOW), 3)
  assert.equal(h.dayStreak([at(2026, 10, 21, 8), at(2026, 10, 21, 20)], NOW), 1, 'several matches on one day are one day')
})

test('a streak is still alive if only yesterday had a match, and ends after a whole empty day', () => {
  assert.equal(h.dayStreak([at(2026, 10, 20), at(2026, 10, 19)], NOW), 2)
  assert.equal(h.dayStreak([at(2026, 10, 19), at(2026, 10, 18)], NOW), 0, 'nothing today or yesterday')
})

test('a gap breaks the streak, and older days do not count past it', () => {
  // 21st, 20th, then a gap on the 19th, then the 18th and 17th
  assert.equal(h.dayStreak([at(2026, 10, 21), at(2026, 10, 20), at(2026, 10, 18), at(2026, 10, 17)], NOW), 2)
})

test('empty, missing and invalid timestamps are ignored; it works across a month boundary', () => {
  assert.equal(h.dayStreak([], NOW), 0)
  assert.equal(h.dayStreak([null, undefined, '', 'not a date'], NOW), 0)
  const first = new Date(2026, 10, 1, 12)         // 1 November
  assert.equal(h.dayStreak([at(2026, 11, 1), at(2026, 10, 31), at(2026, 10, 30)], first), 3)
})

test('matches in the last 7 days: the edge is inclusive and the future is excluded', () => {
  const stamps = [at(2026, 10, 21, 14), at(2026, 10, 14, 15), at(2026, 10, 14, 14), at(2026, 10, 1), at(2026, 10, 22), null]
  // 21st 14:00 yes; 14th 15:00 is exactly 7 days before NOW, yes; 14th 14:00 is an hour too old; 1st no; tomorrow no
  assert.equal(h.countWithin(stamps, NOW), 2)
  assert.equal(h.countWithin(stamps, NOW, 30), 4, 'a wider window counts the 1st too')
})

test('rating change is measured from the last rating before the window, or from 1000 if there is none', () => {
  const hist = [
    { rating: 1100, recorded_at: at(2026, 9, 21) },   // 30 days ago
    { rating: 1150, recorded_at: at(2026, 10, 11) },  // 10 days ago: the last one before the window
    { rating: 1170, recorded_at: at(2026, 10, 18) },  // inside the window
    { rating: 1180, recorded_at: at(2026, 10, 20) },
  ]
  assert.equal(h.ratingChange(hist, 1180, NOW), 30)
  assert.equal(h.ratingChange(hist, 1150, NOW), 0, 'unchanged since before the window')
  assert.equal(h.ratingChange([{ rating: 1120, recorded_at: at(2026, 10, 19) }], 1120, NOW), 120, 'a new player starts from 1000')
  assert.equal(h.ratingChange([], 1000, NOW), 0)
  assert.equal(h.ratingChange([{ rating: 1090, recorded_at: at(2026, 10, 1) }], 1060, NOW), -30)
  // order in the list does not matter
  assert.equal(h.ratingChange([...hist].reverse(), 1180, NOW), 30)
})

test('names: short form, initials and the thousands separator', () => {
  assert.equal(h.shortName('Jayden Rivera'), 'Jayden R.')
  assert.equal(h.shortName('Mary Jane Watson'), 'Mary W.')
  assert.equal(h.shortName('Cat'), 'Cat')
  assert.equal(h.shortName('  '), '')
  assert.equal(h.initials('Jayden Rivera'), 'JR')
  assert.equal(h.initials('cat'), 'C')
  assert.equal(h.initials('Mary Jane Watson'), 'MW')
  assert.equal(h.initials(''), '?')
  assert.equal(h.formatRating(1842), '1,842')
  assert.equal(h.formatRating(940), '940')
  assert.equal(h.formatRating(1000.4), '1,000')
})

test('hero wording follows the sport: table sports get the table line, a court sport its own, unknown gets the general eyebrow', () => {
  const t = h.heroCopy({ surface: 'table', label: 'Ping Pong' })
  assert.deepEqual([t.line1, t.line2, t.art, t.eyebrow], ['Every table has a story.', 'Make yours count.', 'table', 'Ping Pong'])
  const c = h.heroCopy({ surface: 'court', label: 'Tennis' })
  assert.deepEqual([c.line1, c.line2, c.art, c.eyebrow], ['Track every rally.', 'Own the court.', 'court', 'Tennis'])
  assert.equal(h.heroCopy({ surface: 'court', label: 'League' }).eyebrow, 'Your league. Your game.')
  assert.equal(h.heroCopy({ surface: 'table', label: 'League' }).eyebrow, 'Your league. Your game.')
})

test('table tennis wording never mentions a building or neighbors, and neither does the general fallback', () => {
  const words = /building|neighbo/i
  for (const label of ['Ping Pong', 'League']) {
    const t = h.heroCopy({ surface: 'table', label })
    for (const [k, v] of Object.entries(t)) assert.doesNotMatch(String(v), words, `table copy, ${label}, ${k}: ${v}`)
  }
  assert.doesNotMatch(h.heroCopy({ surface: 'court', label: 'League' }).eyebrow, words, 'unknown-sport eyebrow')
  assert.equal(h.heroCopy({ surface: 'table', label: 'Ping Pong' }).sub, 'Challenge other players, track your rating, and turn casual games into a living league.')
  // the court sports keep the original wording from the mockup
  assert.match(h.heroCopy({ surface: 'court', label: 'Tennis' }).sub, /in the building\. Challenge neighbors/)
})
