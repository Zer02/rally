// What the rating-aware weekly quests look like for one player (src/lib/quests.ts, v0.0.8.3).
// The expected values are written out here from the rules, NOT read from quests.ts, so changing
// a rule means changing it here (and in the database migration) on purpose.
//   run:  node --test tests/js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from '../lib/load-score.mjs'

const q = await loadLib('quests')
const PUNCH = { key: 'weekly_punch_up', title: 'Punch Up', description: 'Play someone rated above you' }
const REACH = { key: 'weekly_reach', title: 'Reach', description: 'Play someone rated 100+ above you' }
const CHAL  = { key: 'weekly_challenger', title: 'Be the Challenger', description: 'Send a challenge that gets played' }

test('the gaps are the ones the database uses: 25, 100, 100', () => {
  assert.deepEqual([q.PUNCH_UP_GAP, q.REACH_GAP, q.CLOSE_GAP], [25, 100, 100])
})

test('at the top means nobody is rated 25 or more above you', () => {
  assert.equal(q.isAtTop(1000, [1024, 900]), true)
  assert.equal(q.isAtTop(1000, [1025]), false)
  assert.equal(q.isAtTop(1000, []), true, 'alone in the league')
  assert.equal(q.isAtTop(1000, [1000, 1000, 1000]), true, 'a fresh league: everybody is at the top')
})

test('Reach is possible when somebody is 100 or more above you', () => {
  assert.equal(q.canReach(1000, [1099]), false)
  assert.equal(q.canReach(1000, [1100]), true)
  assert.equal(q.canReach(1000, [900, 1000]), false)
})

test('Reach is hidden while nobody is far enough above you; shown otherwise', () => {
  assert.equal(q.questForPlayer(REACH, 1000, [1050, 900]), null)
  assert.deepEqual(q.questForPlayer(REACH, 1000, [1100]), REACH)
})

test('Punch Up is Punch Up until you are at the top, then Fair Fight or Mentor', () => {
  assert.deepEqual(q.questForPlayer(PUNCH, 1000, [1100, 900]), PUNCH)
  const top = q.questForPlayer(PUNCH, 1300, [1100, 900])
  assert.equal(top.title, 'Fair Fight or Mentor')
  assert.match(top.description, /close match \(within 100 points\) or someone rated below you/)
  assert.equal(top.key, 'weekly_punch_up', 'still the same quest underneath')
})

test('other quests are shown exactly as they are', () => {
  assert.deepEqual(q.questForPlayer(CHAL, 1000, [1100]), CHAL)
  assert.deepEqual(q.questForPlayer(CHAL, 1300, []), CHAL)
  const show = { key: 'weekly_show_up', title: 'Show Up', description: 'Play a match' }
  assert.deepEqual(q.questForPlayer(show, 1300, [900]), show)
})

test('the helper does not change the quest it is given', () => {
  const before = JSON.stringify(PUNCH)
  q.questForPlayer(PUNCH, 1300, [900])
  assert.equal(JSON.stringify(PUNCH), before)
})
