// The round robin score rules as the front end applies them (src/lib/score.ts).
// The expected values are written out here from the rules themselves, NOT read
// from score.ts, so changing a rule means changing it here too on purpose.
//   run:  node --test tests/js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadScore } from '../lib/load-score.mjs'

const s = await loadScore()

// The rules, in one place: a match is first to 4, or a full set to 6.
const TARGETS = [4, 6]
const WIN = 4              // points for a win
const LOSS_CAP = 3         // a loss one game short earns this
// Loss points by games won, spelled out for each format.
const LOSS = { 4: [0, 1, 2, 3], 6: [0, 1, 1, 2, 2, 3] }
const legal = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 &&
  TARGETS.some(t => (a === t && b < t) || (b === t && a < t))

test('constants match the rules', () => {
  assert.deepEqual([...s.GAME_TARGETS], TARGETS)
  assert.equal(s.MAX_GAMES, 6)
  assert.equal(s.WIN_POINTS, WIN)
  assert.equal(s.LOSS_MAX_POINTS, LOSS_CAP)
  assert.equal(s.XP_PER_POINT, 4)
})

test('legal scores: 4-0 to 4-3 or 6-0 to 6-5, either way round, and nothing else', () => {
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++)
    assert.equal(s.isLegalRrScore(a, b), legal(a, b), `${a}-${b}`)
  for (let n = 0; n < 4; n++) { assert.ok(s.isLegalRrScore(4, n)); assert.ok(s.isLegalRrScore(n, 4)) }
  for (let n = 0; n < 6; n++) { assert.ok(s.isLegalRrScore(6, n)); assert.ok(s.isLegalRrScore(n, 6)) }
  // the ones people will try
  for (const [a, b] of [[5, 3], [5, 4], [4, 4], [5, 5], [6, 6], [7, 5], [7, 6], [4, 5]])
    assert.equal(s.isLegalRrScore(a, b), false, `${a}-${b} is not a finished score`)
  for (const [a, b] of [[6, 5], [5, 6], [6, 4], [4, 6], [4, 3], [3, 4]])
    assert.equal(s.isLegalRrScore(a, b), true, `${a}-${b} is a finished score`)
})

test('scores that are not whole non-negative numbers are never legal', () => {
  for (const [a, b] of [[null, 6], [6, ''], [6.5, 0], [undefined, undefined], ['6', 0], [NaN, 6], [Infinity, 6], [-1, 6], [4, null]])
    assert.equal(s.isLegalRrScore(a, b), false, JSON.stringify([a, b]))
})

test('every illegal score has a reason and every legal one has none', () => {
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++) {
    const err = s.rrScoreError(a, b)
    assert.equal(err === null, legal(a, b), `${a}-${b} -> ${err}`)
    if (err !== null) assert.ok(typeof err === 'string' && err.length > 10)
  }
})

test('reasons say which formats exist', () => {
  assert.match(s.rrScoreError(7, 2), /first to 4 games, or a full set to 6.*more than 6/)
  assert.match(s.rrScoreError(5, 5), /can.t be equal/)
  assert.match(s.rrScoreError(6, 6), /can.t be equal/)
  assert.match(s.rrScoreError(5, 3), /exactly 4 games.*exactly 6/)
  assert.match(s.rrScoreError(null, 4), /whole numbers/)
})

test('match points: a win is 4 in either format', () => {
  for (const t of TARGETS) for (let n = 0; n < t; n++) assert.equal(s.rrMatchPoints(t, n), WIN, `win ${t}-${n}`)
})

test('match points: the loss scale for each format, spelled out', () => {
  for (const t of TARGETS) assert.deepEqual([...Array(t).keys()].map(n => s.rrMatchPoints(n, t)), LOSS[t], `lost to ${t}`)
  // one game short of the target is worth the same in both formats
  assert.equal(s.rrMatchPoints(3, 4), s.rrMatchPoints(5, 6))
  // first to 4 keeps the scale it always had: the games you won
  assert.deepEqual([0, 1, 2, 3].map(n => s.rrMatchPoints(n, 4)), [0, 1, 2, 3])
  // never above the cap
  for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) assert.ok(s.rrMatchPoints(a, b) <= WIN)
})

test('battle pass XP is 4 per match point', () => {
  assert.equal(s.rrMatchXp(4, 0), 16)
  assert.equal(s.rrMatchXp(6, 3), 16)
  assert.deepEqual([0, 1, 2, 3].map(n => s.rrMatchXp(n, 4)), [0, 4, 8, 12])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => s.rrMatchXp(n, 6)), [0, 4, 4, 8, 8, 12])
})
