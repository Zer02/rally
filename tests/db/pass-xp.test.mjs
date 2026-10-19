// The per-season battle pass and the diminishing play XP (v0.0.8.4).
//   * play XP: from the rule's start week, each match pays its own XP times a volume factor
//     (matches already played that week) and a repeat factor (meetings with the same opponent that
//     week), never less than 1 XP unless it was worth 0. Earlier weeks keep the old rule.
//   * players.xp stays the lifetime total; players.pass_xp is what was earned since the week the
//     newest round robin season was created, and restarts when the next one is created.
// The expected numbers below are worked out here from those rules, NOT read from the migration.
//   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, dropDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, L, T, pid } from './helpers.mjs'

const DB = 'rally_t_pass', EARLY = 'rally_t_pass_early'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const WEEK = `date_trunc('week', now())`
const W1 = '00000000-0000-0000-0000-0000000000c0'
const q = sql => scalar(DB, sql)
const run = sql => psql(DB, { sql })
const sync = () => run(`select public.sync_quest_progress('${L}');`)

// ── the rules, written out ───────────────────────────────────────────────────────────────────
const VOL = n => (n <= 5 ? 1 : n <= 8 ? 0.5 : n <= 12 ? 0.25 : 0.1)
const REP = k => (k <= 1 ? 1 : k === 2 ? 0.5 : k === 3 ? 0.25 : 0.1)
/** What a week of matches should pay: [[baseXp, opponent], ...] in the order they finished. */
function expected(matches) {
  const seen = {}
  return matches.reduce((sum, [base, opp], i) => {
    seen[opp] = (seen[opp] ?? 0) + 1
    return sum + (base === 0 ? 0 : Math.max(1, Math.round(base * VOL(i + 1) * REP(seen[opp]))))
  }, 0)
}
const LADDER = 15   // a ladder match's own XP
const RR_WIN = 16   // a round robin 4-0 win: 4 match points x 4 XP

const playXp = (p, weekSql = WEEK) => Number(q(`select coalesce((select xp_awarded from player_weekly_play_xp where profile_id = '${pid(p)}' and league_id = '${L}' and week_start = ${weekSql}), 0)`))
const lifetime = p => Number(q(`select xp from players where profile_id = '${pid(p)}' and league_id = '${L}'`))
const passXp = p => Number(q(`select pass_xp from players where profile_id = '${pid(p)}' and league_id = '${L}'`))

/** a completed ladder match; `secs` (or a full SQL timestamp) says when */
const ladder = (ch, op, when) =>
  `insert into matches(challenger_id, opponent_id, league_id, status, winner_id, completed_at)
   values ('${pid(ch)}', '${pid(op)}', '${L}', 'completed', '${pid(op)}', ${typeof when === 'number' ? `${WEEK} + interval '${when} seconds'` : when});`
/** a completed round robin match with a score (a, b); a2/b2 make it doubles */
const rr = (a, b, secs, [sa, sb], o = {}) =>
  `insert into tournament_matches(tournament_id, phase, player_a_id, player_b_id, player_a2_id, player_b2_id, format, status, week_id, score_a, score_b, completed_at)
   values ('${T}', 'round_robin', '${pid(a)}', '${pid(b)}', ${o.a2 ? `'${pid(o.a2)}'` : 'null'}, ${o.b2 ? `'${pid(o.b2)}'` : 'null'},
     '${o.a2 ? 'doubles' : 'singles'}', 'completed', '${W1}', ${sa}, ${sb}, ${WEEK} + interval '${secs} seconds');`

/** a clean slate; the decay rule applies from `decayFrom` (default: this week) */
function fresh(sql = '', decayFrom = WEEK) {
  run(`delete from player_weekly_play_xp; delete from player_quest_progress; delete from matches; delete from tournament_matches; delete from elo_history;
       update players set xp = 0, pass_xp = 0;
       update play_xp_rule set decay_from = ${decayFrom};`)
  if (sql) run(sql)
  sync()
}

before(() => {
  if (skip) return
  replay(DB, { through: '0.0.8.3' })
  run(seedBaseSql())
})
after(() => { if (!skip) { dropDb(DB); dropDb(EARLY) } })

// ── Before: what the quests report, so the migration can be shown to leave them alone ────────
let OLD
test('before 8.4: the quests report what they do, and players have no pass XP column yet', { skip }, () => {
  run(`delete from player_weekly_play_xp; delete from player_quest_progress; delete from matches; delete from tournament_matches; delete from elo_history;`)
  run([ladder(3, 2, 10), ladder(3, 4, 20), ladder(5, 3, 30), rr(3, 1, 40, [4, 1])].join('\n')); sync()
  OLD = q(`select string_agg(t.key||':'||p.profile_id||'='||p.progress_count||'/'||(p.completed_at is not null), ',' order by t.key, p.profile_id)
             from player_quest_progress p join quest_templates t on t.id = p.quest_template_id where p.period_start = ${WEEK}`)
  assert.ok(OLD.length > 100, 'the scenario should move several quests')
  assert.equal(q(`select count(*) from information_schema.columns where table_name = 'players' and column_name = 'pass_xp'`), '0')
})

test('v0.0.8.4 applies cleanly, says so, and the new rule starts next Monday', { skip }, () => {
  const notices = apply(DB, '0.0.8.4')
  assert.ok(notices.some(n => n.includes('v0.0.8.4 OK')), notices.join(' / '))
  assert.equal(q(`select (decay_from = ${WEEK} + interval '7 days')::text from play_xp_rule`), 'true')
  assert.equal(q(`select count(*) from information_schema.columns where table_name = 'players' and column_name = 'pass_xp'`), '1')
})

test('after 8.4: every quest reports exactly what it did before', { skip }, () => {
  run(`delete from player_weekly_play_xp; delete from player_quest_progress; delete from matches; delete from tournament_matches; delete from elo_history; update players set xp = 0;`)
  run([ladder(3, 2, 10), ladder(3, 4, 20), ladder(5, 3, 30), rr(3, 1, 40, [4, 1])].join('\n')); sync()
  const now = q(`select string_agg(t.key||':'||p.profile_id||'='||p.progress_count||'/'||(p.completed_at is not null), ',' order by t.key, p.profile_id)
                   from player_quest_progress p join quest_templates t on t.id = p.quest_template_id where p.period_start = ${WEEK}`)
  assert.equal(now, OLD)
})

// ── Diminishing play XP ──────────────────────────────────────────────────────────────────────
test('the two factors are the ones written down: volume 1/.5/.25/.1, repeats 1/.5/.25/.1', { skip }, () => {
  for (let n = 1; n <= 16; n++) assert.equal(Number(q(`select public.play_xp_volume_factor(${n})`)), VOL(n), `volume ${n}`)
  for (let k = 1; k <= 6; k++) assert.equal(Number(q(`select public.play_xp_repeat_factor(${k})`)), REP(k), `repeat ${k}`)
})

test('five different opponents in a week still pay in full', { skip }, () => {
  fresh([1, 2, 4, 5, 6].map((o, i) => ladder(3, o, 10 + i)).join('\n'))
  assert.equal(playXp(3), 5 * LADDER)
  assert.equal(playXp(3), expected([1, 2, 4, 5, 6].map(o => [LADDER, o])))
})

test('beating the same opponent over and over pays less each time, but never nothing', { skip }, () => {
  fresh(Array.from({ length: 14 }, (_, i) => ladder(3, 2, 10 + i)).join('\n'))
  const want = expected(Array.from({ length: 14 }, () => [LADDER, 2]))
  assert.equal(playXp(3), want)
  assert.ok(want > 14 && want < 14 * LADDER / 3, `14 games against one person should be worth some but not much: ${want}`)
  // the last games each pay exactly 1: spam is slow, not free of value
  const lastSix = expected(Array.from({ length: 14 }, () => [LADDER, 2])) - expected(Array.from({ length: 8 }, () => [LADDER, 2]))
  assert.equal(lastSix, 6, 'games 9 to 14 against the same person pay 1 XP each')
})

test('volume alone: more matches in a week pay less, whoever they are against', { skip }, () => {
  // 6 matches, first meetings only where possible: p3 plays p1, p2, p4, p5, p6, then p1 again
  const opps = [1, 2, 4, 5, 6, 1, 2, 4]
  fresh(opps.map((o, i) => ladder(3, o, 10 + i)).join('\n'))
  assert.equal(playXp(3), expected(opps.map(o => [LADDER, o])))
  assert.ok(playXp(3) < 8 * LADDER && playXp(3) > 5 * LADDER, 'more than five matches pay more in total, but each extra one pays less')
})

test('round robin pays 4 per match point: a 4-0 win 16, a 0-4 loss stays 0 (the floor is for matches worth something)', { skip }, () => {
  fresh(rr(3, 4, 10, [4, 0]) + rr(5, 3, 20, [4, 0]))     // p3 wins, then loses 0-4 as player b
  assert.equal(playXp(3), expected([[RR_WIN, 4], [0, 5]]))
  assert.equal(playXp(3), RR_WIN)
})

test('ladder and round robin share one count: the same opponent in both is a repeat', { skip }, () => {
  fresh(ladder(3, 2, 10) + rr(3, 2, 20, [4, 0]))
  assert.equal(playXp(3), expected([[LADDER, 2], [RR_WIN, 2]]))
  assert.equal(playXp(3), LADDER + Math.round(RR_WIN * 0.5))
})

test('doubles: the opposing pair counts as one opponent, and a different pair is a fresh one', { skip }, () => {
  fresh(rr(3, 1, 10, [4, 0], { a2: 4, b2: 2 }) + rr(3, 2, 20, [4, 0], { a2: 4, b2: 1 }))   // same pair p1+p2, either way round
  assert.equal(playXp(3), expected([[RR_WIN, 'p1p2'], [RR_WIN, 'p1p2']]))
  fresh(rr(3, 1, 10, [4, 0], { a2: 4, b2: 2 }) + rr(3, 5, 20, [4, 0], { a2: 4, b2: 6 }))   // p1+p2, then p5+p6
  assert.equal(playXp(3), 2 * RR_WIN)
})

test('weeks before the rule starts keep the old rule: five at full rate, then 2 XP each', { skip }, () => {
  const opps = [1, 2, 4, 5, 6, 1, 2]
  fresh(opps.map((o, i) => ladder(3, o, 10 + i)).join('\n'), `${WEEK} + interval '7 days'`)
  assert.equal(playXp(3), 5 * LADDER + 2 * 2)
})

test('a past week is not re-rated: the week before the rule keeps the old rate, this week uses the new', { skip }, () => {
  const lastWeek = [1, 1, 1, 1, 1, 1].map((o, i) => ladder(3, o, `${WEEK} - interval '5 days' + interval '${i} seconds'`))
  fresh(lastWeek.join('\n') + ladder(3, 2, 10) + ladder(3, 2, 20))
  assert.equal(playXp(3, `${WEEK} - interval '7 days'`), 5 * LADDER + 2, 'last week: first five at 15, then 2')
  assert.equal(playXp(3), expected([[LADDER, 2], [LADDER, 2]]), 'this week: the new rule')
})

test('syncing again changes nothing, in either ledger', { skip }, () => {
  fresh([1, 1, 1, 2, 4, 5, 6, 1, 2].map((o, i) => ladder(3, o, 10 + i)).join('\n'))
  const before = [playXp(3), lifetime(3), passXp(3)]
  sync(); sync()
  assert.deepEqual([playXp(3), lifetime(3), passXp(3)], before)
})

test('lifetime XP follows the new play XP: it is exactly what the ledgers add up to', { skip }, () => {
  fresh([1, 1, 1, 1, 2, 4].map((o, i) => ladder(3, o, 10 + i)).join('\n'))
  const ledgers = Number(q(`select coalesce((select sum(xp_awarded) from player_weekly_play_xp where profile_id = '${pid(3)}'), 0)
                                  + coalesce((select sum(xp_awarded) from player_quest_progress where profile_id = '${pid(3)}'), 0)`))
  assert.equal(lifetime(3), ledgers)
})

// ── The season pass ──────────────────────────────────────────────────────────────────────────
/** match times: this week, last week, two weeks ago (the season's first week), three weeks ago */
const SPREAD = () => [
  ladder(3, 2, 10), ladder(3, 4, `${WEEK} - interval '3 days'`), ladder(3, 5, `${WEEK} - interval '10 days'`), ladder(3, 6, `${WEEK} - interval '17 days'`),
].join('\n')
/** the pass XP worked out independently, from the ledgers, for a window start */
const passFrom = (p, startSql) => Number(q(`select coalesce((select sum(xp_awarded) from player_weekly_play_xp where profile_id = '${pid(p)}' and league_id = '${L}' and week_start >= ${startSql}), 0)
  + coalesce((select sum(xp_awarded) from player_quest_progress where profile_id = '${pid(p)}' and league_id = '${L}' and completed_at is not null and completed_at >= ${startSql}), 0)`))

test('the pass counts from the week the newest season was created, not before', { skip }, () => {
  fresh(SPREAD() + `update tournaments set created_at = ${WEEK} - interval '10 days' where id = '${T}';`)
  sync()
  assert.equal(passXp(3), passFrom(3, `${WEEK} - interval '14 days'`))
  assert.equal(playXp(3, `${WEEK} - interval '21 days'`), LADDER, 'three weeks ago is on the books')
  assert.ok(lifetime(3) - passXp(3) >= LADDER, 'but it is not in the pass: lifetime is larger by at least that match')
  // the three weeks in the window each paid one ladder match; the quests this week come on top
  assert.equal(passXp(3) - 3 * LADDER, Number(q(`select coalesce(sum(xp_awarded), 0) from player_quest_progress where profile_id = '${pid(3)}' and completed_at >= ${WEEK} - interval '14 days'`)))
})

test('a new season restarts the pass; lifetime XP does not move', { skip }, () => {
  const lifeBefore = lifetime(3), passBefore = passXp(3)
  run(`insert into tournaments(league_id, name, status, created_at) values ('${L}', 'Season 2', 'round_robin', now());`)
  sync()
  assert.equal(lifetime(3), lifeBefore, 'lifetime is untouched')
  assert.ok(passXp(3) < passBefore, 'the pass restarted')
  assert.equal(passXp(3), passFrom(3, WEEK), 'now only this week counts')
  assert.equal(passXp(5), passFrom(5, WEEK), 'for everyone in the league')
})

test('with no season at all the pass is the whole history, and equals lifetime XP', { skip }, () => {
  run(`delete from tournaments;`)
  sync()
  assert.equal(passXp(3), lifetime(3))
  assert.ok(passXp(3) > 0)
})

test('quests count towards the pass by when they were completed', { skip }, () => {
  fresh(ladder(3, 2, 10) + `delete from tournaments;`)   // Show Up etc. complete this week; no season: everything counts
  assert.ok(Number(q(`select coalesce(sum(xp_awarded), 0) from player_quest_progress where profile_id = '${pid(3)}' and completed_at is not null`)) >= 15)
  assert.equal(passXp(3), lifetime(3))
  run(`insert into tournaments(id, league_id, name, status, created_at) values (gen_random_uuid(), '${L}', 'S', 'round_robin', now() + interval '10 days');`)
  sync()
  assert.equal(passXp(3), 0, 'a season that starts later than everything so far leaves the pass at 0')
  assert.ok(lifetime(3) > 0)
})

// ── Not for the app to call or write ─────────────────────────────────────────────────────────
test('the app cannot write pass XP or call the internal functions', { skip }, () => {
  const as = sql => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${pid(3)}',false); ${sql}` })
  assert.throws(() => as(`update public.players set pass_xp = 9999 where profile_id = '${pid(3)}';`), /permission denied|row-level security/)
  for (const f of [`public.refresh_pass_xp('${L}')`, `public.pass_window_start('${L}')`, `public.play_xp_volume_factor(1)`, `public.play_xp_repeat_factor(1)`])
    assert.throws(() => as(`select ${f};`), /permission denied/, f)
  assert.doesNotThrow(() => as(`select public.sync_quest_progress('${L}');`), 'but the quest sync still runs for a signed-in player')
  assert.doesNotThrow(() => as(`select pass_xp from public.players;`), 'and everyone can read pass XP')
})

// ── The migration itself ─────────────────────────────────────────────────────────────────────
test('running v0.0.8.4 again changes nothing and keeps the rule start', { skip }, () => {
  const start = q(`select decay_from::text from play_xp_rule`)
  const notices = apply(DB, '0.0.8.4')
  assert.ok(notices.some(n => n.includes('v0.0.8.4 OK')))
  assert.equal(q(`select decay_from::text from play_xp_rule`), start)
})

test('v0.0.8.4 refuses to run without v0.0.8.3', { skip }, () => {
  replay(EARLY, { through: '0.0.8.0' })
  assert.throws(() => apply(EARLY, '0.0.8.4'), /Run supabase-migration-v0\.0\.8\.3\.sql first/)
})
