// Knockout tournament helpers (src/lib/bracket.ts). Expected values are worked out by hand
// from the rules, not computed with the code under test.   run: npm run test:js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from '../lib/load-score.mjs'

const b = await loadLib('bracket')

test('bracket size is the next power of two, with the leftover slots as byes', () => {
  const cases = [[2, 2, 0], [3, 4, 1], [4, 4, 0], [5, 8, 3], [11, 16, 5], [16, 16, 0], [17, 32, 15], [33, 64, 31], [64, 64, 0]]
  for (const [players, size, byes] of cases) {
    assert.equal(b.bracketSize(players), size, `${players} players`)
    assert.equal(b.byeCount(players), byes, `${players} players`)
  }
  assert.deepEqual([2, 4, 8, 16, 32, 64].map(b.roundCount), [1, 2, 3, 4, 5, 6])
})

test('rounds are named from the final backwards', () => {
  assert.deepEqual([1, 2, 3, 4].map(r => b.roundName(r, 4)), ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'])
  assert.deepEqual([1, 2, 3].map(r => b.roundName(r, 3)), ['Quarterfinals', 'Semifinals', 'Final'])
  assert.deepEqual([1, 2].map(r => b.roundName(r, 2)), ['Semifinals', 'Final'])
  assert.equal(b.roundName(1, 1), 'Final')
  assert.equal(b.roundName(1, 6), 'Round of 64')
  assert.equal(b.roundName(2, 6), 'Round of 32')
})

test('the field must be 2 to 64 players', () => {
  assert.match(b.entrantError(0), /at least 2/)
  assert.match(b.entrantError(1), /at least 2/)
  assert.equal(b.entrantError(2), null)
  assert.equal(b.entrantError(64), null)
  assert.match(b.entrantError(65), /at most 64/)
})

test('matches group by round, in round order and slot order, whatever order they arrive in', () => {
  const m = (round, slot) => ({ id: `${round}-${slot}`, round, slot })
  const grouped = b.groupRounds([m(2, 2), m(1, 2), m(2, 1), m(1, 1), m(3, 1)])
  assert.deepEqual(grouped.map(r => r.map(x => x.id)), [['1-1', '1-2'], ['2-1', '2-2'], ['3-1']])
  assert.deepEqual(b.groupRounds([]), [])
})

test('the loser of a finished match is the other player; byes and unplayed matches have none', () => {
  const base = { id: 'x', round: 1, slot: 1, player_a_id: 'A', player_b_id: 'B', score_a: null, score_b: null, completed_at: null }
  assert.equal(b.matchLoserId({ ...base, status: 'completed', winner_id: 'A', score_a: 4, score_b: 1 }), 'B')
  assert.equal(b.matchLoserId({ ...base, status: 'completed', winner_id: 'B', score_a: 2, score_b: 4 }), 'A')
  assert.equal(b.matchLoserId({ ...base, status: 'pending', winner_id: null }), null)
  assert.equal(b.matchLoserId({ ...base, status: 'bye', player_b_id: null, winner_id: 'A' }), null)
})

test('a result is blocked for a bye, an unknown player, or once the winner has played on (as the database decides)', () => {
  const mk = (round, slot, over = {}) => ({ id: `${round}-${slot}`, round, slot, player_a_id: 'A', player_b_id: 'B', status: 'pending', winner_id: null, score_a: null, score_b: null, completed_at: null, ...over })
  // a 4-player bracket: semifinals 1-1 and 1-2 feed the final 2-1
  const all = () => [mk(1, 1), mk(1, 2), mk(2, 1, { player_a_id: null, player_b_id: null })]
  assert.equal(b.scoreBlock(all()[0], all()), null, 'a fresh semifinal can be scored')
  assert.match(b.scoreBlock(mk(1, 1, { status: 'bye', player_b_id: null }), all()), /bye/)
  assert.match(b.scoreBlock(all()[2], all()), /earlier round/)
  // semifinal done, final not played: still correctable
  const done = [mk(1, 1, { status: 'completed', winner_id: 'A' }), mk(1, 2), mk(2, 1, { player_a_id: 'A', player_b_id: null })]
  assert.equal(b.scoreBlock(done[0], done), null)
  // final played: both semifinals feeding it are locked (slots 1 and 2 both map to final slot 1)
  const locked = [mk(1, 1, { status: 'completed', winner_id: 'A' }), mk(1, 2, { status: 'completed', winner_id: 'B' }), mk(2, 1, { status: 'completed', winner_id: 'A' })]
  assert.match(b.scoreBlock(locked[0], locked), /Locked/)
  assert.match(b.scoreBlock(locked[1], locked), /Locked/)
  assert.equal(b.scoreBlock(locked[2], locked), null, 'the final itself can still be corrected')
  // slot 3 and 4 feed final slot 2, not 1: an unplayed slot-2 match does not lock slot 3
  const eight = [mk(1, 3, { status: 'completed', winner_id: 'A' }), mk(2, 1, { status: 'completed', winner_id: 'A' }), mk(2, 2)]
  assert.equal(b.scoreBlock(eight[0], eight), null)
})

test('names fall back from display name to username to TBD', () => {
  assert.equal(b.profileName({ display_name: 'Cat Jones', username: 'cat' }), 'Cat Jones')
  assert.equal(b.profileName({ display_name: null, username: 'cat' }), 'cat')
  assert.equal(b.profileName({ display_name: '', username: 'cat' }), 'cat')
  assert.equal(b.profileName(null), 'TBD')
  assert.equal(b.profileName(undefined), 'TBD')
})
