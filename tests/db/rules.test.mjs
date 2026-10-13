// The score rules as the DATABASE applies them, checked against the same
// written-out spec as tests/js/score.test.mjs, and against score.ts itself so
// the two can never drift apart.   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, rows, dropDb } from '../lib/pg.mjs'
import { replay } from './helpers.mjs'
import { loadScore } from '../lib/load-score.mjs'

const DB = 'rally_t_rules'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const TARGETS = [4, 6], WIN = 4
const LOSS = { 4: [0, 1, 2, 3], 6: [0, 1, 1, 2, 2, 3] }
const legal = (a, b) => a >= 0 && b >= 0 && TARGETS.some(t => (a === t && b < t) || (b === t && a < t))
// For a pair that is not a finished score the points are not meaningful, so only legal results are compared.
const points = (won, lost) => won > lost ? WIN : LOSS[lost][won]

before(() => { if (!skip) replay(DB) })
after(() => { if (!skip) dropDb(DB) })

test('there is no single target any more: rr_games_to_win() is gone', { skip }, () => {
  assert.equal(rows(DB, `select count(*) from pg_proc where proname = 'rr_games_to_win'`)[0][0], '0')
})

test('rr_score_is_legal() follows the rule for every score from -1 to 9, and null is not legal', { skip }, () => {
  const got = rows(DB, `select a, b, public.rr_score_is_legal(a, b) from generate_series(-1,9) a, generate_series(-1,9) b order by a, b`)
  assert.equal(got.length, 121)
  for (const [a, b, ok] of got) assert.equal(ok === 't', legal(+a, +b), `${a}-${b}`)
  assert.equal(rows(DB, 'select public.rr_score_is_legal(null, 6), public.rr_score_is_legal(6, null), public.rr_score_is_legal(null, null)')[0].join(), 'f,f,f')
})

test('rr_match_points() follows the rule for every finished score, both formats, both ways round', { skip }, () => {
  const got = rows(DB, `select a, b, public.rr_match_points(a, b) from generate_series(0,9) a, generate_series(0,9) b order by a, b`)
  assert.equal(got.length, 100)
  let checked = 0
  for (const [a, b, p] of got) {
    if (!legal(+a, +b)) continue
    checked++
    assert.equal(+p, +a > +b ? WIN : LOSS[+b][+a], `${a}-${b}`)
  }
  assert.equal(checked, 2 * (4 + 6), 'every finished score was checked: 4 and 6 per side')
})

test('the front end (score.ts) and the database agree on every score', { skip }, async () => {
  const s = await loadScore()
  const sqlLegal = new Map(rows(DB, `select a, b, public.rr_score_is_legal(a, b) from generate_series(-1,9) a, generate_series(-1,9) b`).map(([a, b, ok]) => [`${a},${b}`, ok === 't']))
  const sqlPts = new Map(rows(DB, `select a, b, public.rr_match_points(a, b) from generate_series(0,9) a, generate_series(0,9) b`).map(([a, b, p]) => [`${a},${b}`, +p]))
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++) {
    assert.equal(s.isLegalRrScore(a, b), sqlLegal.get(`${a},${b}`), `legal ${a}-${b}`)
    // every pair, finished or not: the two implementations of the points rule must match everywhere
    if (a >= 0 && b >= 0) assert.equal(s.rrMatchPoints(a, b), sqlPts.get(`${a},${b}`), `points ${a}-${b}`)
  }
  assert.deepEqual([...s.GAME_TARGETS], TARGETS)
})
