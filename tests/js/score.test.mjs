// The round robin score rules as the front end applies them (src/lib/score.ts).
// The expected values are written out here from the rules themselves, NOT read
// from score.ts, so changing a rule means changing it here too on purpose.
//   run:  node --test tests/js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadScore } from '../lib/load-score.mjs'

const s = await loadScore()

// The rules, in one place.
const TARGET = 6           // games to win a match
const WIN = 4              // points for a win
const LOSS_CAP = 3         // a loss earns the games you won, up to this
const legal = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 &&
  ((a === TARGET && b < TARGET) || (b === TARGET && a < TARGET))
const points = (won, lost) => won > lost ? WIN : Math.min(LOSS_CAP, won)

test('constants match the rules', () => {
  assert.equal(s.GAMES_TO_WIN, TARGET)
  assert.equal(s.WIN_POINTS, WIN)
  assert.equal(s.LOSS_MAX_POINTS, LOSS_CAP)
  assert.equal(s.XP_PER_POINT, 4)
})

test('legal scores: exactly one side on the target, the other 0 up to one less', () => {
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++)
    assert.equal(s.isLegalRrScore(a, b), legal(a, b), `${a}-${b}`)
  for (let n = 0; n < TARGET; n++) { assert.ok(s.isLegalRrScore(TARGET, n)); assert.ok(s.isLegalRrScore(n, TARGET)) }
})

test('scores that are not whole non-negative numbers are never legal', () => {
  for (const [a, b] of [[null, 6], [6, ''], [6.5, 0], [undefined, undefined], ['6', 0], [NaN, 6], [Infinity, 6], [-1, 6]])
    assert.equal(s.isLegalRrScore(a, b), false, JSON.stringify([a, b]))
})

test('every illegal score has a reason and every legal one has none', () => {
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++) {
    const err = s.rrScoreError(a, b)
    assert.equal(err === null, legal(a, b), `${a}-${b} -> ${err}`)
    if (err !== null) assert.ok(typeof err === 'string' && err.length > 10)
  }
})

test('reasons name the target so they stay true if it changes', () => {
  assert.match(s.rrScoreError(7, 2), new RegExp(`more than ${TARGET}`))
  assert.match(s.rrScoreError(TARGET, TARGET), /Only one side/)
  assert.match(s.rrScoreError(3, 2), new RegExp(`winner needs ${TARGET}`))
  assert.match(s.rrScoreError(null, 4), /whole numbers/)
})

test('match points: win 4; a loss is the games won, 0 to 3', () => {
  for (let n = 0; n < TARGET; n++) {
    assert.equal(s.rrMatchPoints(TARGET, n), WIN, `win ${TARGET}-${n}`)
    assert.equal(s.rrMatchPoints(n, TARGET), points(n, TARGET), `loss ${n}-${TARGET}`)
  }
  // the points scale for first to 6, spelled out
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => s.rrMatchPoints(n, 6)), [0, 1, 2, 3, 3, 3])
})

test('battle pass XP is 4 per match point', () => {
  assert.equal(s.rrMatchXp(TARGET, 0), 16)
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => s.rrMatchXp(n, 6)), [0, 4, 8, 12, 12, 12])
})
