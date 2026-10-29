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

test('no sport\'s wording mentions a building or neighbors, and the court pitch reads as intended', () => {
  const words = /building|neighbo/i
  for (const surface of ['table', 'court']) for (const label of ['Ping Pong', 'Tennis', 'League']) {
    for (const [k, v] of Object.entries(h.heroCopy({ surface, label }))) assert.doesNotMatch(String(v), words, `${surface} ${label} ${k}: ${v}`)
  }
  assert.equal(h.heroCopy({ surface: 'table', label: 'Ping Pong' }).sub, 'Challenge other players, track your rating, and turn casual games into a living league.')
  assert.equal(h.heroCopy({ surface: 'court', label: 'Tennis' }).sub, 'Live ratings for everyone in your league. Challenge other players, log scores, climb the leaderboard.')
})

// ── v0.0.9.1: the pictures behind the home page and the profile header ──────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** A JPEG's real width and height, read from its start-of-frame header (not from anything we declared). */
function jpegSize(buf) {
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8, 'not a JPEG (no start-of-image marker)')
  let i = 2
  while (i < buf.length) {
    assert.equal(buf[i], 0xff, `bad marker at byte ${i}`)
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2)
    // SOF0..SOF15 carry the size, except DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('no size found in the JPEG')
}
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')

test('heroScene: the declared picture sizes equal the real files', () => {
  for (const art of ['court', 'table']) {
    const sc = h.heroScene(art)
    assert.equal(sc.art, art)
    const real = jpegSize(readFileSync(join(PUBLIC, sc.src.replace(/^\//, ''))))
    assert.deepEqual({ width: sc.width, height: sc.height }, real, `${art}: ${sc.src} is ${real.width}x${real.height} but heroScene says ${sc.width}x${sc.height}`)
  }
})

test('heroScene: files and banner crops are written down once and match the design', () => {
  const c = h.heroScene('court'), t = h.heroScene('table')
  assert.deepEqual([c.src, c.banner, c.bannerNarrow], ['/hero/tennis.jpg', '100% 78%', '80% 78%'])
  assert.deepEqual([t.src, t.banner, t.bannerNarrow], ['/hero/table.jpg', '30% 86%', '38% 84%'])
  // the visitor hero keeps the crops it always had
  assert.deepEqual([c.wide, c.narrow, c.block], ['100% 50%', '78% 50%', '72%'])
  assert.deepEqual([t.wide, t.narrow, t.block], ['20% 82%', '40% 50%', '60%'])
  // every sport's art resolves to one of the two
  for (const surface of ['court', 'table']) assert.equal(h.heroScene(h.heroCopy({ surface, label: 'X' }).art).art, surface === 'table' ? 'table' : 'court')
})

// ── v0.0.9.2: the round robin standings under the ladder (tennis only) ──────────────────────────────────────
const P = (id, rr_points, wins, losses, points_for, profile) => ({ profile_id: id, rr_points, wins, losses, points_for, profile })

test('roundRobinTop: points, then wins, then games won; the top five by default', () => {
  // given out of order. By hand: D 22 pts 6 wins; C 22 pts 5 wins 44 games; B 22 pts 5 wins 40 games; E 16; A 10; F has nothing (null counts as 0).
  const input = [
    P('A', 10, 2, 3, 30, { display_name: 'Ann Lee', username: 'ann' }),
    P('B', 22, 5, 0, 40, { display_name: 'Bo Tan', username: 'bo' }),
    P('C', 22, 5, 1, 44, { display_name: null, username: 'cy' }),
    P('D', 22, 6, 0, 10, { display_name: 'Di Wu', username: 'di' }),
    P('E', 16, 3, 2, 20, { display_name: 'Ed Ng', username: 'ed' }),
    P('F', null, null, null, null, null),
  ]
  const before = JSON.stringify(input)
  const top = h.roundRobinTop(input)
  assert.deepEqual(top.map(r => r.profile_id), ['D', 'C', 'B', 'E', 'A'])
  assert.deepEqual(top.map(r => r.rank), [1, 2, 3, 4, 5])
  assert.deepEqual(top.map(r => r.points), [22, 22, 22, 16, 10])
  assert.deepEqual(top.map(r => `${r.wins}-${r.losses}`), ['6-0', '5-1', '5-0', '3-2', '2-3'])
  assert.equal(top[1].name, 'cy', 'no display name: the username')
  assert.equal(top[0].name, 'Di Wu')
  assert.equal(JSON.stringify(input), before, 'the input is not reordered')
  assert.deepEqual(h.roundRobinTop(input, 3).map(r => r.profile_id), ['D', 'C', 'B'])
  const all = h.roundRobinTop(input, 10)
  assert.equal(all.length, 6); assert.deepEqual({ ...all[5] }, { rank: 6, profile_id: 'F', name: 'Player', points: 0, wins: 0, losses: 0 })
  assert.deepEqual(h.roundRobinTop([]), [])
})

test('showsRoundRobinBoard: tennis only', () => {
  assert.equal(h.showsRoundRobinBoard('tennis'), true)
  for (const k of ['pingpong', 'pickleball', 'padel', 'squash', 'badminton', '', null, undefined]) assert.equal(h.showsRoundRobinBoard(k), false, String(k))
})
