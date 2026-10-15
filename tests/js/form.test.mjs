// Streaks and head-to-head (src/lib/form.ts). Expected values are worked out by hand from
// small match lists, not computed with the code under test.   run: npm run test:js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from '../lib/load-score.mjs'

const f = await loadLib('form')
const ME = 'me', DANA = 'dana', FINN = 'finn', SAM = 'sam'

// A finished singles match: a vs b, scores, day number (later = more recent).
let n = 0
const m = (a, b, sa, sb, day, extra = {}) => ({
  id: `m${++n}`, status: 'completed', player_a_id: a, player_b_id: b, player_a2_id: null, player_b2_id: null,
  score_a: sa, score_b: sb, completed_at: new Date(2026, 9, day).toISOString(), created_at: new Date(2026, 9, day - 1).toISOString(), ...extra,
})

test('sideOf: a, b, or not in the match; doubles partners share a side', () => {
  const dbl = m(ME, DANA, 6, 3, 1, { player_a2_id: SAM, player_b2_id: FINN })
  assert.equal(f.sideOf(dbl, ME), 'a'); assert.equal(f.sideOf(dbl, SAM), 'a')
  assert.equal(f.sideOf(dbl, DANA), 'b'); assert.equal(f.sideOf(dbl, FINN), 'b')
  assert.equal(f.sideOf(dbl, 'nobody'), null); assert.equal(f.sideOf(dbl, ''), null)
})

test('resultFor: W or L from your own side; nothing for unfinished, tied or someone else\'s match', () => {
  assert.equal(f.resultFor(m(ME, DANA, 6, 3, 1), ME), 'W')
  assert.equal(f.resultFor(m(ME, DANA, 6, 3, 1), DANA), 'L')
  assert.equal(f.resultFor(m(DANA, ME, 2, 6, 1), ME), 'W')      // you on side b
  assert.equal(f.resultFor(m(DANA, ME, 6, 4, 1), ME), 'L')
  assert.equal(f.resultFor(m(ME, DANA, null, null, 1, { status: 'pending' }), ME), null)
  assert.equal(f.resultFor(m(ME, DANA, 6, 3, 1, { status: 'in_progress' }), ME), null)
  assert.equal(f.resultFor(m(ME, DANA, 4, 4, 1), ME), null)      // a tie is not a result
  assert.equal(f.resultFor(m(DANA, FINN, 6, 0, 1), ME), null)
})

test('winStreak: counts wins back from the latest match, whatever order the list is in', () => {
  // oldest to newest: W L W W W  -> 3
  const list = [m(ME, DANA, 6, 1, 1), m(ME, FINN, 2, 6, 2), m(ME, DANA, 6, 0, 3), m(FINN, ME, 1, 6, 4), m(ME, SAM, 6, 5, 5)]
  assert.equal(f.winStreak(list, ME), 3)
  assert.equal(f.winStreak([...list].reverse(), ME), 3, 'input order does not matter')
  assert.equal(f.winStreak([...list, m(ME, DANA, 3, 6, 6)], ME), 0, 'a loss on the latest match ends it')
  assert.equal(f.winStreak([], ME), 0)
  assert.equal(f.winStreak([m(ME, DANA, 6, 1, 1)], ME), 1)
})

test('winStreak ignores matches that are not finished, not yours, or tied, and counts doubles and challenges', () => {
  const list = [
    m(ME, DANA, 6, 1, 1),
    m(ME, FINN, null, null, 9, { status: 'pending' }),            // not played yet: does not break it
    m(DANA, FINN, 0, 6, 8),                                       // someone else's match
    m(ME, SAM, 4, 4, 7),                                          // a tie: ignored
    m(ME, DANA, 6, 2, 3, { player_a2_id: SAM, player_b2_id: FINN, phase: 'round_robin' }),   // doubles win
    m(ME, FINN, 6, 3, 4, { phase: 'challenge' }),                 // challenge win
  ]
  assert.equal(f.winStreak(list, ME), 3)
})

test('headToHead: your record against one player, singles only, from either side', () => {
  const list = [
    m(ME, DANA, 6, 2, 1), m(DANA, ME, 6, 4, 2), m(DANA, ME, 1, 6, 3),     // W, L, W vs Dana
    m(ME, FINN, 3, 6, 4),                                                   // L vs Finn
    m(ME, DANA, 6, 0, 5, { player_a2_id: SAM, player_b2_id: FINN }),        // doubles: not counted
    m(ME, DANA, null, null, 6, { status: 'pending' }),                      // not played
    m(SAM, DANA, 6, 0, 7),                                                  // not you
  ]
  assert.deepEqual(f.headToHead(list, ME, DANA), { wins: 2, losses: 1 })
  assert.deepEqual(f.headToHead(list, ME, FINN), { wins: 0, losses: 1 })
  assert.deepEqual(f.headToHead(list, ME, SAM), { wins: 0, losses: 0 })
  assert.deepEqual(f.headToHead(list, DANA, ME), { wins: 1, losses: 2 }, 'the same matches from Dana\'s side')
  assert.deepEqual(f.headToHead(list, ME, ME), { wins: 0, losses: 0 })
  assert.deepEqual(f.headToHead(list, ME, ''), { wins: 0, losses: 0 })
})

test('headToHeadText: lead, trail, level, first meeting', () => {
  assert.equal(f.headToHeadText({ wins: 2, losses: 0 }), 'You lead 2–0 this season')
  assert.equal(f.headToHeadText({ wins: 0, losses: 1 }), 'You trail 0–1 this season')
  assert.equal(f.headToHeadText({ wins: 1, losses: 1 }), 'Level 1–1 this season')
  assert.equal(f.headToHeadText({ wins: 0, losses: 0 }), 'First meeting this season')
})
