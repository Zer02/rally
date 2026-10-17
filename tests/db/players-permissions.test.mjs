// Who may write to `players` and `elo_history` (v0.0.8.0). Runs as the database's own
// `authenticated` role, the same role the app uses, so policies and privileges apply
// exactly as they do in production.
// First on the rules as they were (to show each hole is real), then on the migration.
//   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, dropDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, L, pid } from './helpers.mjs'

const DB = 'rally_t_playerperms', EARLY = 'rally_t_playerperms_early'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'

// Players 1-6 are members (player 1 administers the league). 7, 8 and 9 have accounts but never joined.
const P7 = pid(7), P8 = pid(8), P9 = pid(9)
const DENIED = /row-level security|permission denied/

/** Run SQL as a signed-in app user (the `authenticated` role, with that user's id as the caller). */
const as = (sub, sql) => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false); ${sql}` })
/** Same, but signed out (the `anon` role). */
const anon = sql => psql(DB, { sql: `set role anon; ${sql}` })
const q = sql => scalar(DB, sql)
/** The value a query returned: the last line of output (set_config above echoes the caller's id first). */
const last = r => r.out.split('\n').pop()
const rating = p => q(`select rating from public.players where profile_id='${p}' and league_id='${L}'`)
const hasPlayer = p => q(`select count(*) from public.players where profile_id='${p}' and league_id='${L}'`)

before(() => {
  if (skip) return
  replay(DB, { through: '0.0.7.9' })      // the rules as they were before this fix
  psql(DB, {
    sql: seedBaseSql() + [P7, P8, P9].map((p, i) =>
      `insert into auth.users(id,email,raw_user_meta_data) values ('${p}','p${7 + i}@x.test','{"username":"p${7 + i}"}');`).join('\n'),
  })
})
after(() => { if (!skip) { dropDb(DB); dropDb(EARLY) } })

// ── BEFORE: each hole is real ────────────────────────────────────────────────────────────
test('BEFORE: a signed-in user can create a player record for someone else (the open insert policy)', { skip }, () => {
  as(P7, `insert into public.players(profile_id, league_id) values ('${P9}','${L}');`)   // p7 enrols p9
  assert.equal(hasPlayer(P9), '1', 'p9 never asked to join, and is now a member')
})

test('BEFORE: a joining user can choose their own starting rating', { skip }, () => {
  as(P7, `insert into public.players(profile_id, league_id, rating, xp) values ('${P7}','${L}', 2500, 99999);`)
  assert.equal(rating(P7), '2500')
})

test('BEFORE: a player can set their own rating', { skip }, () => {
  as(pid(2), `update public.players set rating = 3000 where profile_id='${pid(2)}';`)
  assert.equal(rating(pid(2)), '3000')
})

test('BEFORE: anyone signed in can write fake rating history', { skip }, () => {
  as(P8, `insert into public.elo_history(profile_id, rating, league_id) values ('${pid(3)}', 1, '${L}');`)
  assert.equal(q(`select count(*) from public.elo_history where rating = 1`), '1')
})

test('v0.0.8.0 applies cleanly, and says so', { skip }, () => {
  // put the tampered rows right again, as a migration cannot know they were fake
  psql(DB, { sql: `update public.players set rating=1000, xp=0 where profile_id in ('${P7}','${pid(2)}'); delete from public.players where profile_id='${P9}'; delete from public.elo_history;` })
  const notices = apply(DB, '0.0.8.0')
  assert.ok(notices.some(n => n.includes('v0.0.8.0 OK')), notices.join(' / '))
})

// ── AFTER: the doors are shut ────────────────────────────────────────────────────────────
test('AFTER: you cannot create a player record for someone else', { skip }, () => {
  assert.throws(() => as(P7, `insert into public.players(profile_id, league_id) values ('${P9}','${L}');`), DENIED)
  assert.equal(hasPlayer(P9), '0')
})

test('AFTER: you cannot choose your own rating, XP or record when joining', { skip }, () => {
  for (const col of ['rating', 'xp', 'career_wins', 'season_wins', 'streak', 'uncertainty']) {
    assert.throws(() => as(P7, `insert into public.players(profile_id, league_id, ${col}) values ('${P7}','${L}', 50);`), DENIED, col)
  }
  assert.equal(hasPlayer(P7), '1', 'still only the one record from before')   // set above; not re-created
})

test('AFTER: joining a league still works, and starts you at the defaults', { skip }, () => {
  as(P8, `insert into public.players(profile_id, league_id) values ('${P8}','${L}');`)
  assert.equal(hasPlayer(P8), '1')
  assert.equal(q(`select rating||'/'||xp||'/'||career_wins from public.players where profile_id='${P8}'`), '1000/0/0')
  assert.equal(q(`select public.is_league_member('${L}','${P8}')`), 't', 'and that makes you a member')
})

test('AFTER: you cannot join twice, or join as someone else with a league admin\'s help', { skip }, () => {
  assert.throws(() => as(P8, `insert into public.players(profile_id, league_id) values ('${P8}','${L}');`), /duplicate key|unique/)
  assert.throws(() => as(pid(1), `insert into public.players(profile_id, league_id) values ('${P9}','${L}');`), DENIED, 'even the league admin cannot')
})

test('AFTER: nobody can edit or remove a player record directly', { skip }, () => {
  for (const sql of [
    `update public.players set rating = 3000 where profile_id='${pid(2)}';`,
    `update public.players set rating = 3000 where profile_id='${pid(3)}';`,
    `update public.players set career_wins = 99 where profile_id='${P8}';`,
    `delete from public.players where profile_id='${pid(2)}';`,
  ]) assert.throws(() => as(pid(2), sql), DENIED, sql)
  assert.throws(() => as(pid(1), `update public.players set rating = 1 where profile_id='${pid(2)}';`), DENIED, 'not even the league admin')
  assert.equal(rating(pid(2)), '1000')
})

test('AFTER: nobody can write rating history directly, and signed-out visitors can write nothing', { skip }, () => {
  assert.throws(() => as(P8, `insert into public.elo_history(profile_id, rating, league_id) values ('${pid(3)}', 1, '${L}');`), DENIED)
  assert.throws(() => anon(`insert into public.players(profile_id, league_id) values ('${P9}','${L}');`), DENIED)
  assert.throws(() => anon(`update public.players set rating = 1;`), DENIED)
  assert.throws(() => anon(`insert into public.elo_history(profile_id, rating, league_id) values ('${pid(3)}', 1, '${L}');`), DENIED)
})

test('AFTER: the standings are still readable, by members, non-members and visitors', { skip }, () => {
  assert.ok(+last(as(P9, `select count(*) from public.players;`)) >= 7, 'a non-member can read')
  assert.ok(+last(anon(`select count(*) from public.players;`)) >= 7, 'a visitor can read')
  assert.doesNotThrow(() => as(P9, `select count(*) from public.elo_history;`))
})

// ── AFTER: everything the app does through its own functions still works ────────────────
test('AFTER: reporting a result still moves ratings and writes history (finalize_match runs as the owner)', { skip }, () => {
  const M = '00000000-0000-0000-0000-0000000000d1'
  psql(DB, { sql: `insert into public.matches(id, challenger_id, opponent_id, league_id, status) values ('${M}','${pid(2)}','${pid(3)}','${L}','accepted');` })
  as(pid(2), `select public.finalize_match('${M}','${pid(2)}','${pid(3)}', 1016, 190, 1, 984, 190, -1, 0.5, 16, -16, '4', '2');`)
  assert.equal(rating(pid(2)), '1016')
  assert.equal(rating(pid(3)), '984')
  assert.equal(q(`select count(*) from public.elo_history where match_id='${M}'`), '2')
})

test('AFTER: creating a league still works for a signed-in user (create_league runs as the owner)', { skip }, () => {
  const id = last(as(P9, `select public.create_league('P9 League','tennis','🎾');`))
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(q(`select count(*) from public.players where profile_id='${P9}' and league_id='${id}'`), '1', 'the creator is enrolled')
})

test('AFTER: starting a new season (reset_season) still works for the league admin', { skip }, () => {
  assert.doesNotThrow(() => as(pid(1), `select public.reset_season('${L}');`))
})

// ── The migration itself ─────────────────────────────────────────────────────────────────
test('running v0.0.8.0 again changes nothing and raises nothing', { skip }, () => {
  const notices = apply(DB, '0.0.8.0')
  assert.ok(notices.some(n => n.includes('v0.0.8.0 OK')))
  assert.throws(() => as(P9, `update public.players set rating = 1;`), DENIED)
})

test('v0.0.8.0 refuses to run without v0.0.7.9', { skip }, () => {
  replay(EARLY, { through: '0.0.7.2' })
  assert.throws(() => apply(EARLY, '0.0.8.0'), /Run supabase-migration-v0\.0\.7\.9\.sql first/)
})
