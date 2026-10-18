// The rating-aware weekly quests (v0.0.8.3): Punch Up, Reach, Be the Challenger.
// They count a match when it is played, win or lose, using each player's LADDER rating at the
// time of the match (read back from elo_history), for ladder and round robin matches alike.
//   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, dropDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, L, T, pid } from './helpers.mjs'

const DB = 'rally_t_quests', EARLY = 'rally_t_quests_early'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const WEEK = `date_trunc('week', now())`
const W1 = '00000000-0000-0000-0000-0000000000c0'   // a round robin week from seedBaseSql()
const q = sql => scalar(DB, sql)
const run = sql => psql(DB, { sql })
const sync = () => run(`select public.sync_quest_progress('${L}');`)

/** progress "count/done" for a player on a quest key, this week */
const prog = (p, key) => q(`select coalesce((select progress_count||'/'||(completed_at is not null) from player_quest_progress g
  join quest_templates t on t.id = g.quest_template_id
  where t.key = '${key}' and g.profile_id = '${pid(p)}' and g.league_id = '${L}' and g.period_start = ${WEEK}), 'none')`)
const xp = p => Number(q(`select xp from players where profile_id = '${pid(p)}' and league_id = '${L}'`))

/** Everyone's rating, now and "back then" (one history row before this week began). */
function ratings(r) {
  run(`delete from elo_history;` + Object.entries(r).map(([p, v]) =>
    `update players set rating = ${v} where profile_id = '${pid(p)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(p)}', ${v}, '${L}', ${WEEK} - interval '2 days');`).join('\n'))
}
/** A completed ladder match this week; `secs` orders it within the week. */
const ladder = (ch, op, secs, winner = op, id = 'gen_random_uuid()') =>
  `insert into matches(id, challenger_id, opponent_id, league_id, status, winner_id, completed_at)
   values (${id}, '${pid(ch)}', '${pid(op)}', '${L}', 'completed', '${pid(winner)}', ${WEEK} + interval '${secs} seconds');`
/** A completed round robin match this week. */
const rr = (a, b, secs, o = {}) =>
  `insert into tournament_matches(tournament_id, phase, player_a_id, player_b_id, player_a2_id, player_b2_id, format, status, week_id, challenger_id, completed_at)
   values ('${T}', '${o.phase ?? 'round_robin'}', '${pid(a)}', '${pid(b)}', ${o.a2 ? `'${pid(o.a2)}'` : 'null'}, ${o.b2 ? `'${pid(o.b2)}'` : 'null'},
     '${o.a2 ? 'doubles' : 'singles'}', 'completed', '${W1}', ${o.chal ? `'${pid(o.chal)}'` : 'null'}, ${WEEK} + interval '${secs} seconds');`
const BASE = { 1: 1300, 2: 1100, 3: 1000, 4: 900, 5: 1000, 6: 1000 }
function fresh(r = BASE, ...sql) {
  run(`delete from elo_history; delete from player_quest_progress; delete from matches; delete from tournament_matches; delete from player_weekly_play_xp; update players set xp = 0;`)
  ratings(r)
  if (sql.length) run(sql.join('\n'))
  sync()
}

before(() => {
  if (skip) return
  replay(DB, { through: '0.0.8.0' })      // the quests as they were
  run(seedBaseSql())
})
after(() => { if (!skip) { dropDb(DB); dropDb(EARLY) } })

// ── Before: what the old quests report, so we can prove the migration leaves them alone ──────
let OLD
test('before 8.3: the older quests are what they were, and the new ones do not exist', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2), ladder(3, 4, 20, 3), ladder(5, 3, 30, 5), rr(3, 1, 40), rr(3, 4, 50, { phase: 'challenge', chal: 3 }))
  const keys = ['weekly_show_up', 'weekly_double_header', 'weekly_fresh_face', 'monthly_regular', 'monthly_social', 'monthly_mixer', 'seasonal_veteran', 'seasonal_bounce_back']
  OLD = Object.fromEntries([3, 4, 1].flatMap(p => keys.map(k => [`${p}:${k}`, prog(p, k)])))
  assert.equal(q(`select count(*) from quest_templates where key in ('weekly_punch_up','weekly_reach','weekly_challenger')`), '0')
  assert.ok(Object.values(OLD).some(v => v !== 'none' && v !== '0/false'), 'the scenario should move some old quests: ' + JSON.stringify(OLD))
})

test('v0.0.8.3 applies cleanly, and says so', { skip }, () => {
  const notices = apply(DB, '0.0.8.3')
  assert.ok(notices.some(n => n.includes('v0.0.8.3 OK')), notices.join(' / '))
})

test('after 8.3: every older quest reports exactly what it did before', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2), ladder(3, 4, 20, 3), ladder(5, 3, 30, 5), rr(3, 1, 40), rr(3, 4, 50, { phase: 'challenge', chal: 3 }))
  const keys = ['weekly_show_up', 'weekly_double_header', 'weekly_fresh_face', 'monthly_regular', 'monthly_social', 'monthly_mixer', 'seasonal_veteran', 'seasonal_bounce_back']
  const now = Object.fromEntries([3, 4, 1].flatMap(p => keys.map(k => [`${p}:${k}`, prog(p, k)])))
  assert.deepEqual(now, OLD)
})

// ── Punch Up and Reach: the thresholds ───────────────────────────────────────────────────────
for (const [gap, punch, reach] of [[24, '0/false', '0/false'], [25, '1/true', '0/false'], [99, '1/true', '0/false'], [100, '1/true', '1/true']]) {
  for (const result of ['loses', 'wins']) {
    test(`an opponent ${gap} above you: Punch Up ${punch}, Reach ${reach} (you ${result})`, { skip }, () => {
      fresh({ ...BASE, 2: 1000 + gap }, ladder(3, 2, 10, result === 'wins' ? 3 : 2))
      assert.equal(prog(3, 'weekly_punch_up'), punch)
      assert.equal(prog(3, 'weekly_reach'), reach)
    })
  }
}

test('a close or lower-rated opponent does not count for someone who is not at the top', { skip }, () => {
  fresh(BASE, ladder(3, 4, 10, 3), ladder(3, 5, 20, 3))     // p3 (1000) plays 900 and 1000; p1 and p2 are above p3
  assert.equal(prog(3, 'weekly_punch_up'), '0/false')
  assert.equal(prog(3, 'weekly_reach'), '0/false')
  fresh(BASE, ladder(2, 4, 10, 2))                          // p2 (1100) is not at the top either: p1 is 200 above
  assert.equal(prog(2, 'weekly_punch_up'), '0/false')
})

test('it is the rating then that counts: an opponent who has since dropped below you still counts', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2),
    // p2 was 1100 when they played; a later match took them down to 800
    `update players set rating = 800 where profile_id = '${pid(2)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(2)}', 800, '${L}', ${WEEK} + interval '1 hour');`)
  assert.equal(q(`select rating from players where profile_id = '${pid(2)}'`), '800')
  assert.equal(prog(3, 'weekly_reach'), '1/true', 'p2 was 100 above p3 when it was played')
})

test('and your own rating then counts too: you have since climbed past them, it still counts', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 3),
    // p3 was 1000 when it was played (p2 at 1100); a later win took p3 up to 1300
    `update players set rating = 1300 where profile_id = '${pid(3)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(3)}', 1300, '${L}', ${WEEK} + interval '1 hour');`)
  assert.equal(prog(3, 'weekly_reach'), '1/true', 'p2 was 100 above p3 at the time, whatever p3 is now')
})

test('and it is the rating before the match, not the rating the match itself produced', { skip }, () => {
  const M = '00000000-0000-0000-0000-0000000000e1'
  fresh(BASE, ladder(3, 2, 10, 3, `'${M}'`),
    // the match moved them to 1040 and 1060 (a 20 gap); the 100 gap before it is what counts
    `insert into elo_history(profile_id, rating, match_id, league_id, recorded_at) values
       ('${pid(3)}', 1040, '${M}', '${L}', ${WEEK} + interval '10 seconds'),
       ('${pid(2)}', 1060, '${M}', '${L}', ${WEEK} + interval '10 seconds');`)
  assert.equal(prog(3, 'weekly_reach'), '1/true')
})

test('someone who has not played yet counts as 1000', { skip }, () => {
  fresh(BASE, `delete from elo_history where profile_id = '${pid(3)}';`, ladder(3, 2, 10, 2))
  assert.equal(prog(3, 'weekly_reach'), '1/true', 'p3 has no history: 1000, against p2 at 1100')
})

test('the same opponent twice counts once; two different opponents count twice', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2), ladder(2, 3, 20, 3))
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
  fresh(BASE, ladder(3, 2, 10, 2), ladder(3, 1, 20, 1))
  assert.equal(prog(3, 'weekly_punch_up'), '2/true')
})

test('last week does not count', { skip }, () => {
  fresh(BASE, `insert into matches(challenger_id, opponent_id, league_id, status, winner_id, completed_at)
     values ('${pid(3)}', '${pid(2)}', '${L}', 'completed', '${pid(2)}', ${WEEK} - interval '1 day');`)
  assert.equal(prog(3, 'weekly_punch_up'), '0/false')
})

test('a match that is not completed does not count', { skip }, () => {
  fresh(BASE, `insert into matches(challenger_id, opponent_id, league_id, status, completed_at)
     values ('${pid(3)}', '${pid(2)}', '${L}', 'pending', ${WEEK} + interval '5 seconds');`)
  assert.equal(prog(3, 'weekly_punch_up'), '0/false')
})

// ── At the top: Punch Up becomes Fair Fight or Mentor ────────────────────────────────────────
test('at the top, a close match or a lower-rated opponent counts, and Reach cannot be earned', { skip }, () => {
  fresh(BASE, ladder(1, 4, 10, 1))                          // p1 (1300), nobody 25+ above; plays a 900
  assert.equal(prog(1, 'weekly_punch_up'), '1/true', 'Mentor')
  fresh(BASE, ladder(1, 2, 10, 2))                          // 1100
  assert.equal(prog(1, 'weekly_punch_up'), '1/true', 'a match below counts too')
  assert.equal(prog(1, 'weekly_reach'), '0/false')
  fresh({ ...BASE, 2: 1320 }, ladder(1, 2, 10, 2))          // p2 is 20 above p1: still "at the top" (under 25), and a close match
  assert.equal(prog(1, 'weekly_punch_up'), '1/true', 'Fair Fight')
})

test('when everyone is still on 1000 everybody is at the top, so any match counts', { skip }, () => {
  fresh({ 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000 }, ladder(3, 4, 10, 3))
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
  assert.equal(prog(3, 'weekly_reach'), '0/false')
})

// ── Be the Challenger ────────────────────────────────────────────────────────────────────────
test('Be the Challenger: counts when you sent the challenge, whatever the ratings or the result', { skip }, () => {
  fresh(BASE, ladder(3, 4, 10, 4))                          // p3 challenges a lower player and loses
  assert.equal(prog(3, 'weekly_challenger'), '1/true')
  assert.equal(prog(4, 'weekly_challenger'), '0/false', 'the player who was challenged does not get it')
})

test('Be the Challenger: a round robin week\'s challenge match counts; an assigned pairing does not', { skip }, () => {
  fresh(BASE, rr(3, 4, 10, { phase: 'challenge', chal: 3 }))
  assert.equal(prog(3, 'weekly_challenger'), '1/true')
  assert.equal(prog(4, 'weekly_challenger'), '0/false')
  fresh(BASE, rr(3, 4, 10), rr(5, 3, 20, { chal: 3 }))      // assigned (even if a challenger id is present)
  assert.equal(prog(3, 'weekly_challenger'), '0/false')
})

// ── Round robin ──────────────────────────────────────────────────────────────────────────────
test('round robin singles count for Punch Up and Reach, using ladder ratings', { skip }, () => {
  fresh(BASE, rr(3, 2, 10))                                 // 1000 vs 1100
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
  assert.equal(prog(3, 'weekly_reach'), '1/true')
  assert.equal(prog(2, 'weekly_punch_up'), '0/false', 'and from the other side p2 played someone below')
})

test('round robin is judged by the ladder rating, not the round robin rating', { skip }, () => {
  fresh(BASE, `update tournament_participants set rr_rating = 1500 where profile_id = '${pid(4)}';`, rr(3, 4, 10))
  assert.equal(prog(3, 'weekly_punch_up'), '0/false', 'p4 is 900 on the ladder however good their round robin rating is')
})

test('doubles: the other pair\'s average is compared with your own rating', { skip }, () => {
  fresh(BASE, rr(3, 1, 10, { a2: 4, b2: 2 }))               // p3+p4 v p1+p2: opposing average 1200
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
  assert.equal(prog(3, 'weekly_reach'), '1/true')
  assert.equal(prog(4, 'weekly_reach'), '1/true', 'p4 (900) is 300 below that pair')
  fresh({ ...BASE, 5: 1080 }, rr(3, 2, 10, { a2: 4, b2: 5 })) // opposing pair p2 (1100) + p5 (1080): average 1090, 90 above p3
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
  assert.equal(prog(3, 'weekly_reach'), '0/false')
  fresh(BASE, rr(3, 5, 10, { a2: 4, b2: 6 }))               // 1000 and 1000
  assert.equal(prog(3, 'weekly_punch_up'), '0/false')
})

test('round robin uses the ratings at the time too, for you and for them, singles and doubles', { skip }, () => {
  // you climbed past them later
  fresh(BASE, rr(3, 2, 10),
    `update players set rating = 1300 where profile_id = '${pid(3)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(3)}', 1300, '${L}', ${WEEK} + interval '1 hour');`)
  assert.equal(prog(3, 'weekly_reach'), '1/true', 'p3 was 1000 and p2 1100 when it was played')
  // they fell below you later
  fresh(BASE, rr(3, 2, 10),
    `update players set rating = 700 where profile_id = '${pid(2)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(2)}', 700, '${L}', ${WEEK} + interval '1 hour');`)
  assert.equal(prog(3, 'weekly_reach'), '1/true', 'p2 was 1100 when it was played')
  // doubles: the pair's average then (1300 and 1100 = 1200), though one of them has since collapsed
  fresh(BASE, rr(3, 1, 10, { a2: 4, b2: 2 }),
    `update players set rating = 600 where profile_id = '${pid(1)}';
     insert into elo_history(profile_id, rating, league_id, recorded_at) values ('${pid(1)}', 600, '${L}', ${WEEK} + interval '1 hour');`)
  assert.equal(prog(3, 'weekly_reach'), '1/true')
})

test('ladder and round robin share one count: the same opponent in both counts once', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2), rr(3, 2, 20))
  assert.equal(prog(3, 'weekly_punch_up'), '1/true')
})

// ── XP ───────────────────────────────────────────────────────────────────────────────────────
test('each quest pays once: 25, 40 and 20 XP, and syncing again pays nothing more', { skip }, () => {
  fresh({ ...BASE, 2: 1100 }, ladder(3, 2, 10, 2))
  const t = q(`select string_agg(t.key||'='||g.xp_awarded, ',' order by t.key) from player_quest_progress g join quest_templates t on t.id = g.quest_template_id
    where g.profile_id = '${pid(3)}' and g.league_id = '${L}' and g.completed_at is not null and t.key in ('weekly_punch_up','weekly_reach','weekly_challenger')`)
  assert.equal(t, 'weekly_challenger=20,weekly_punch_up=25,weekly_reach=40')
  const before = xp(3)
  sync(); sync()
  assert.equal(xp(3), before)
})

// ── Not for the app to call ──────────────────────────────────────────────────────────────────
test('the two helper functions are internal; the app cannot call them directly', { skip }, () => {
  for (const sql of [`select public.quest_match_facts('${L}','${pid(3)}', now() - interval '7 days', now());`, `select public.ladder_rating_at('${L}','${pid(3)}', now());`])
    assert.throws(() => psql(DB, { sql: `set role authenticated; ${sql}` }), /permission denied/)
})

test('a signed-in player can still open /progress (the sync runs for them)', { skip }, () => {
  assert.doesNotThrow(() => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${pid(3)}',false); select public.sync_quest_progress('${L}');` }))
})

// ── The migration itself ─────────────────────────────────────────────────────────────────────
test('running v0.0.8.3 again changes nothing and raises nothing', { skip }, () => {
  fresh(BASE, ladder(3, 2, 10, 2))
  const before = prog(3, 'weekly_reach')
  const notices = apply(DB, '0.0.8.3')
  assert.ok(notices.some(n => n.includes('v0.0.8.3 OK')))
  assert.equal(q(`select count(*) from quest_templates where key in ('weekly_punch_up','weekly_reach','weekly_challenger')`), '3')
  sync()
  assert.equal(prog(3, 'weekly_reach'), before)
})

test('v0.0.8.3 refuses to run without v0.0.6.4', { skip }, () => {
  replay(EARLY, { through: '0.0.6.3' })
  assert.throws(() => apply(EARLY, '0.0.8.3'), /Run supabase-migration-v0\.0\.6\.4\.sql first/)
})
