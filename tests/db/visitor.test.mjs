// What a signed-out visitor can see and do (v0.0.8.8). Anyone may look at every league and board without an
// account, so every table behind the leaderboards must read for the `anon` role, and nothing that changes
// data may work for them. Runs as the database's own `anon` and `authenticated` roles.   run: node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, dropDb } from '../lib/pg.mjs'
import { replay, seedBaseSql, L, T, pid } from './helpers.mjs'

const DB = 'rally_t_visitor'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const q = sql => scalar(DB, sql)
const anon = sql => psql(DB, { sql: `set role anon; ${sql}` })
const as = (sub, sql) => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false); ${sql}` })

// every table a board, profile or bracket page reads
const READ = ['leagues', 'league_admins', 'profiles', 'players', 'matches', 'elo_history', 'tournaments', 'tournament_participants',
  'tournament_matches', 'tournament_weeks', 'rr_rating_history', 'quest_templates', 'player_quest_progress',
  'bracket_events', 'bracket_entrants', 'bracket_matches']
// one column to try to change in each
const COL = { leagues: "name = 'x'", league_admins: "league_id = league_id", profiles: "username = 'x'", players: 'rating = 1', matches: "status = 'x'",
  elo_history: 'rating = 1', tournaments: "name = 'x'", tournament_participants: 'rr_rating = 1', tournament_matches: "status = 'x'",
  tournament_weeks: 'week_number = 99', rr_rating_history: 'rating = 1', quest_templates: "name = 'x'", player_quest_progress: 'progress = 99',
  bracket_events: "name = 'x'", bracket_entrants: 'seed = 99', bracket_matches: "status = 'x'" }
const fingerprint = () => READ.map(t => q(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), 'empty') from public.${t} x`)).join(',')
let matchId

before(() => {
  if (skip) return
  replay(DB)
  psql(DB, { sql: seedBaseSql() + `
    insert into tournament_matches(tournament_id, player_a_id, player_b_id, status) values ('${T}','${pid(1)}','${pid(2)}','pending');` })
  matchId = q(`select id from tournament_matches limit 1`)
  as(pid(1), `select public.create_bracket_event('${L}','Visitor test','ladder',array['${pid(1)}','${pid(2)}','${pid(3)}','${pid(4)}']::uuid[]);`)
})
after(() => { if (!skip) dropDb(DB) })

test('a signed-out visitor can read every table behind the leagues, leaderboards, round robin and brackets', { skip }, () => {
  for (const t of READ) {
    const asVisitor = Number(anon(`select count(*) from public.${t};`).out.split('\n').pop())
    assert.equal(asVisitor, Number(q(`select count(*) from public.${t}`)), `${t}: a visitor sees the same rows as anyone`)
  }
  for (const t of ['leagues', 'profiles', 'players', 'tournaments', 'tournament_participants', 'bracket_events', 'bracket_matches']) {
    assert.ok(Number(q(`select count(*) from public.${t}`)) > 0, `${t} has data, so the comparison above means something`)
  }
})

test('a visitor cannot change any of those tables', { skip }, () => {
  const before = fingerprint()
  for (const t of READ) {
    try { anon(`delete from public.${t};`) } catch { /* refused is fine */ }
    try { anon(`update public.${t} set ${COL[t]};`) } catch { /* refused is fine */ }
  }
  assert.equal(fingerprint(), before, 'nothing in any of them changed')
  assert.throws(() => anon(`insert into public.leagues(name, sport) values ('Sneak','tennis');`), /permission denied|row-level security/)
  assert.throws(() => anon(`insert into public.bracket_events(league_id,name,seeding,bracket_size) values ('${L}','Sneak','ladder',2);`), /permission denied|row-level security/)
  assert.equal(Number(q(`select count(*) from public.leagues where name='Sneak'`)), 0)
})

test('a visitor is refused every round robin, season and match action, and nothing changes', { skip }, () => {
  const A = `'${pid(1)}'::uuid, '${pid(2)}'::uuid`
  const calls = {
    add_tournament_match: [`select public.add_tournament_match('${T}', ${A}, null::uuid, null::uuid)`, /Only admins/],
    call_match_to_court: [`select public.call_match_to_court('${matchId}', 1)`, /Only admins/],
    cancel_tournament_match: [`select public.cancel_tournament_match('${matchId}')`, /Only admins/],
    remove_tournament_match: [`select public.remove_tournament_match('${matchId}')`, /Only admins/],
    uncall_match: [`select public.uncall_match('${matchId}')`, /Only admins/],
    create_tournament: [`select public.create_tournament('${L}', 'Sneak')`, /Only admins/],
    finalize_tournament: [`select public.finalize_tournament('${T}')`, /Only admins/],
    generate_court_matches: [`select public.generate_court_matches('${T}', array[${A}]::uuid[], 1)`, /Only admins/],
    start_tournament_week: [`select public.start_tournament_week('${T}', array[${A}]::uuid[], 4)`, /Only admins/],
    reset_season: [`select public.reset_season('${L}')`, /Only admins/],
    report_tournament_match: [`select public.report_tournament_match('${matchId}', 4, 1)`, /Not authorized/],
    create_challenge: [`select public.create_challenge('${T}', '${pid(2)}')`, /signed in/i],
    create_league: [`select public.create_league('Sneak', 'tennis', 'x')`, /logged in/i],
    create_bracket_event: [`select public.create_bracket_event('${L}', 'Sneak', 'ladder', array[${A}]::uuid[])`, /Only a league admin|permission denied/],
    report_bracket_match: [`select public.report_bracket_match((select id from bracket_matches limit 1), 4, 0)`, /Only a league admin|permission denied/],
    delete_bracket_event: [`select public.delete_bracket_event((select id from bracket_events limit 1))`, /Only a league admin|permission denied/],
  }
  const before = fingerprint()
  for (const [name, [sql, why]] of Object.entries(calls)) assert.throws(() => anon(sql + ';'), why, `${name} as a visitor`)
  assert.equal(fingerprint(), before, 'and nothing changed')
})

test('a signed-in player who is not an admin is refused the same actions', { skip }, () => {
  const before = fingerprint()
  const stranger = pid(3)                                  // a player, not an admin of the league
  for (const sql of [
    `select public.create_tournament('${L}', 'Sneak')`,
    `select public.finalize_tournament('${T}')`,
    `select public.remove_tournament_match('${matchId}')`,
    `select public.start_tournament_week('${T}', array['${pid(1)}','${pid(2)}']::uuid[], 4)`,
    `select public.create_bracket_event('${L}', 'Sneak', 'ladder', array['${pid(1)}','${pid(2)}']::uuid[])`,
  ]) assert.throws(() => as(stranger, sql + ';'), /Only admins|Only a league admin/, sql)
  assert.equal(fingerprint(), before)
})
