// The score rules as the DATABASE applies them, checked against the same
// written-out spec as tests/js/score.test.mjs, and against score.ts itself so
// the two can never drift apart.   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, rows, dropDb, psql } from '../lib/pg.mjs'
import { replay, T } from './helpers.mjs'
import { loadScore } from '../lib/load-score.mjs'

const DB = 'rally_t_rules'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const TARGET = 6, WIN = 4, LOSS_CAP = 3
const legal = (a, b) => a >= 0 && b >= 0 && ((a === TARGET && b < TARGET) || (b === TARGET && a < TARGET))
const points = (won, lost) => won > lost ? WIN : Math.min(LOSS_CAP, won)

before(() => { if (!skip) replay(DB) })
after(() => { if (!skip) dropDb(DB) })

test('rr_games_to_win() is the target', { skip }, () => {
  assert.equal(Number(rows(DB, 'select public.rr_games_to_win()')[0][0]), TARGET)
})

test('rr_score_is_legal() follows the rule for every score from -1 to 9, and null is not legal', { skip }, () => {
  const got = rows(DB, `select a, b, public.rr_score_is_legal(a, b) from generate_series(-1,9) a, generate_series(-1,9) b order by a, b`)
  assert.equal(got.length, 121)
  for (const [a, b, ok] of got) assert.equal(ok === 't', legal(+a, +b), `${a}-${b}`)
  assert.equal(rows(DB, 'select public.rr_score_is_legal(null, 6), public.rr_score_is_legal(6, null), public.rr_score_is_legal(null, null)')[0].join(), 'f,f,f')
})

test('rr_match_points() follows the rule for every score from 0 to 9', { skip }, () => {
  const got = rows(DB, `select a, b, public.rr_match_points(a, b) from generate_series(0,9) a, generate_series(0,9) b order by a, b`)
  assert.equal(got.length, 100)
  for (const [a, b, p] of got) assert.equal(+p, points(+a, +b), `${a}-${b}`)
})

test('the front end (score.ts) and the database agree on every score', { skip }, async () => {
  const s = await loadScore()
  const sqlLegal = new Map(rows(DB, `select a, b, public.rr_score_is_legal(a, b) from generate_series(-1,9) a, generate_series(-1,9) b`).map(([a, b, ok]) => [`${a},${b}`, ok === 't']))
  const sqlPts = new Map(rows(DB, `select a, b, public.rr_match_points(a, b) from generate_series(0,9) a, generate_series(0,9) b`).map(([a, b, p]) => [`${a},${b}`, +p]))
  for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++) {
    assert.equal(s.isLegalRrScore(a, b), sqlLegal.get(`${a},${b}`), `legal ${a}-${b}`)
    if (a >= 0 && b >= 0) assert.equal(s.rrMatchPoints(a, b), sqlPts.get(`${a},${b}`), `points ${a}-${b}`)
  }
  assert.equal(s.GAMES_TO_WIN, Number(rows(DB, 'select public.rr_games_to_win()')[0][0]))
})
