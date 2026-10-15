// Who may create a challenge (v0.0.7.9). Runs as the database's own `authenticated` role, the
// same role the app uses, so row-level security applies exactly as it does in production.
// First on the rules as they were (to show the bug), then on the migration that fixes it.
//   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, dropDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, L, pid } from './helpers.mjs'

const DB = 'rally_t_perms'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'

// Players 1-6 belong to the league and player 1 administers it. Player 7 has an account but never joined.
const OUTSIDER = pid(7)
const RLS = /row-level security/

/** Run SQL as a signed-in app user (the `authenticated` role, with that user's id as the caller). */
const as = (sub, sql) => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false); ${sql}` })
const challenge = (by, against) => `insert into public.matches(challenger_id, opponent_id, league_id, status) values ('${by}','${against}','${L}','pending');`
const matchCount = () => +scalar(DB, `select count(*) from public.matches`)

before(() => {
  if (skip) return
  replay(DB, { through: '0.0.7.2' })     // the rules as they were before this fix
  psql(DB, { sql: seedBaseSql() + `insert into auth.users(id,email,raw_user_meta_data) values ('${OUTSIDER}','p7@x.test','{"username":"p7"}');` })
})
after(() => { if (!skip) dropDb(DB) })

test('signing up makes an account but does not join a league', { skip }, () => {
  assert.equal(scalar(DB, `select count(*) from public.profiles where id = '${OUTSIDER}'`), '1')
  assert.equal(scalar(DB, `select count(*) from public.players where profile_id = '${OUTSIDER}'`), '0')
})

test('BEFORE the fix: someone who never joined can create a challenge, and can be challenged (the bug)', { skip }, () => {
  as(OUTSIDER, challenge(OUTSIDER, pid(2)))       // a non-member challenges a member
  as(pid(2), challenge(pid(2), OUTSIDER))         // a member challenges a non-member
  assert.equal(matchCount(), 2, 'both were accepted: nothing stopped them')
})

test('v0.0.7.9 audit lists those open challenges by name, and changes nothing', { skip }, () => {
  const before = scalar(DB, `select string_agg(id::text || status, ',' order by id) from public.matches`)
  const notices = apply(DB, '0.0.7.9')
  assert.ok(notices.some(n => /Audit: 2 open challenge\(s\)/.test(n)), notices.join(' / '))
  assert.equal(notices.filter(n => n.startsWith('Open challenge')).length, 2)
  assert.ok(notices.some(n => /not a member of the league: p7/.test(n)), 'it names who has not joined')
  assert.ok(notices.some(n => n.includes('v0.0.7.9 OK')))
  assert.equal(scalar(DB, `select string_agg(id::text || status, ',' order by id) from public.matches`), before, 'no match was touched')
})

test('is_league_member() says yes for members and no for everyone else', { skip }, () => {
  assert.equal(scalar(DB, `select public.is_league_member('${L}', '${pid(2)}')`), 't')
  assert.equal(scalar(DB, `select public.is_league_member('${L}', '${OUTSIDER}')`), 'f')
  assert.equal(scalar(DB, `select public.is_league_member('${L}', null)`), 'f', 'null is not a member')
})

test('AFTER the fix: member against member still works', { skip }, () => {
  const n = matchCount()
  as(pid(2), challenge(pid(2), pid(3)))
  assert.equal(matchCount(), n + 1)
})

test('AFTER the fix: a non-member cannot challenge, and cannot be challenged', { skip }, () => {
  const n = matchCount()
  assert.throws(() => as(OUTSIDER, challenge(OUTSIDER, pid(2))), RLS)
  assert.throws(() => as(pid(2), challenge(pid(2), OUTSIDER)), RLS)
  assert.equal(matchCount(), n, 'nothing was saved')
})

test('AFTER the fix: you still cannot challenge on someone else\'s behalf', { skip }, () => {
  assert.throws(() => as(pid(2), challenge(pid(3), pid(4))), RLS)
})

test('AFTER the fix: the league admin can still enter a match between two players', { skip }, () => {
  const n = matchCount()
  as(pid(1), challenge(pid(2), pid(3)))        // admin acts for two members
  assert.equal(matchCount(), n + 1)
})

test('the admin route is not a loophole for non-members', { skip }, () => {
  assert.throws(() => as(OUTSIDER, challenge(pid(2), pid(3))), RLS)
})

test('joining the league (inserting your own player record) makes you eligible', { skip }, () => {
  as(OUTSIDER, `insert into public.players(profile_id, league_id) values ('${OUTSIDER}','${L}');`)
  assert.equal(scalar(DB, `select public.is_league_member('${L}', '${OUTSIDER}')`), 't')
  const n = matchCount()
  as(OUTSIDER, challenge(OUTSIDER, pid(2)))
  assert.equal(matchCount(), n + 1)
})

test('once they have joined, the audit is clean, and running the migration again changes nothing', { skip }, () => {
  const notices = apply(DB, '0.0.7.9')
  assert.ok(notices.some(n => n.includes('Audit: every open challenge is between league members')), notices.join(' / '))
  assert.ok(notices.some(n => n.includes('v0.0.7.9 OK')))
})
