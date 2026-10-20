// Knockout tournaments (v0.0.8.5): the draw, byes, seeding, scores, corrections,
// who may do what, and that a tournament touches nothing else.
// Runs as the database's own `authenticated` role, like production.
//   run:  node --test tests/db
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, scalar, rows, dropDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, L, T, pid } from './helpers.mjs'

const DB = 'rally_t_brackets', OLD1 = 'rally_t_brackets_old1', OLD2 = 'rally_t_brackets_old2'
const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'

const L2 = '00000000-0000-0000-0000-0000000000a2'
const T0 = '00000000-0000-0000-0000-0000000000b0'
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => uid(from + i))
const arr = list => `array[${list.map(x => `'${x}'`).join(',')}]::uuid[]`
const DENIED = /row-level security|permission denied/

const as = (sub, sql) => psql(DB, { sql: `set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false); ${sql}` })
const anon = sql => psql(DB, { sql: `set role anon; ${sql}` })
const q = sql => scalar(DB, sql)
const last = r => r.out.split('\n').pop()
const ADMIN = uid(1)          // administers league L
const ADMIN2 = uid(2)         // administers league L2 only

/** Create an event as the admin and return its id. */
const create = (name, seeding, list, who = ADMIN, league = L) =>
  last(as(who, `select public.create_bracket_event('${league}','${name}','${seeding}',${arr(list)});`))
/** A match of an event by round and slot. */
const matchId = (ev, round, slot) => q(`select id from bracket_matches where event_id='${ev}' and round=${round} and slot=${slot}`)
/** Report a score as the admin. */
const report = (ev, round, slot, a, b, who = ADMIN) =>
  as(who, `select public.report_bracket_match('${matchId(ev, round, slot)}', ${a}, ${b});`)
const seedOf = (ev, p) => Number(q(`select seed from bracket_entrants where event_id='${ev}' and profile_id='${p}'`))
const slotPlayers = (ev, round, slot) => rows(DB, `select coalesce(player_a_id::text,''), coalesce(player_b_id::text,'') from bracket_matches where event_id='${ev}' and round=${round} and slot=${slot}`)[0]
/** The seed of whoever sits in a match slot ('' when empty). */
const seedsIn = (ev, round, slot) => slotPlayers(ev, round, slot).map(p => p ? seedOf(ev, p) : null)
const count = (t, where = 'true') => Number(q(`select count(*) from public.${t} where ${where}`))

// 70 players. Ladder rating by number, so seeding by the ladder is easy to predict
// (higher number = higher rating = better seed): 1000 + n * 10.
before(() => {
  if (skip) return
  replay(DB)
  psql(DB, {
    sql: seedBaseSql() + `
insert into auth.users(id,email,raw_user_meta_data)
  select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, 'p'||i||'@x.test', jsonb_build_object('username','p'||i) from generate_series(7,70) i;
insert into players(profile_id,league_id)
  select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, '${L}' from generate_series(7,70) i on conflict do nothing;
update players set rating = 1000 + (right(profile_id::text, 12))::int * 10 where league_id = '${L}';
insert into leagues(id,name,sport) values ('${L2}','Other League','tennis');
insert into league_admins(league_id,profile_id) values ('${L2}','${ADMIN2}');
-- an older season (T0) with players 7 and 8, so they have round robin history
insert into tournaments(id,league_id,name,created_at) values ('${T0}','${L}','Old season', now() - interval '60 days');
insert into tournament_participants(tournament_id,profile_id,rr_rating) values
  ('${T0}','${uid(7)}',1400), ('${T0}','${uid(8)}',1100);
-- season T is newer and has players 1-6 with their own round robin ratings
update tournament_participants set rr_rating = 1000 + (right(profile_id::text, 12))::int * 5 where tournament_id = '${T}';
`,
  })
})
after(() => { if (!skip) { dropDb(DB); dropDb(OLD1); dropDb(OLD2) } })

// ── The migration itself ─────────────────────────────────────────────────────────────────
test('v0.0.8.5 can run again and changes nothing', { skip }, () => {
  const before = q(`select count(*) from pg_policies where tablename like 'bracket_%'`)
  const notices = apply(DB, '0.0.8.5')
  assert.ok(notices.some(n => n.includes('v0.0.8.5 OK')), notices.join(' / '))
  assert.equal(q(`select count(*) from pg_policies where tablename like 'bracket_%'`), before)
  assert.equal(count('bracket_events'), 0)
})

test('the prerequisite check tests behaviour: it refuses a database on the old score rule, and one without v0.0.8.4', { skip }, () => {
  // 0.0.6.4: rr_score_is_legal exists (since 6.3) but only knows first-to-4, so (6,5) is not legal
  replay(OLD1, { through: '0.0.6.4' })
  assert.equal(scalar(OLD1, `select to_regprocedure('public.rr_score_is_legal(integer,integer)') is not null`), 't', 'the function exists, so an existence check would have passed')
  assert.throws(() => apply(OLD1, '0.0.8.5'), /v0\.0\.7\.2/)
  // 0.0.8.3: score rule fine, but no pass_xp column yet
  replay(OLD2, { through: '0.0.8.3' })
  assert.throws(() => apply(OLD2, '0.0.8.5'), /v0\.0\.8\.4/)
})

test('the standard seed layout is right for every bracket size', { skip }, () => {
  const order = n => q(`select array_to_string(public.bracket_seed_order(${n}), ',')`)
  assert.equal(order(2), '1,2')
  assert.equal(order(4), '1,4,2,3')
  assert.equal(order(8), '1,8,4,5,2,7,3,6')
  assert.equal(order(16), '1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11')
  // in any bracket, the two seeds of a first-round pair always add up to size + 1
  for (const n of [2, 4, 8, 16, 32, 64]) {
    const o = order(n).split(',').map(Number)
    for (let i = 0; i < n; i += 2) assert.equal(o[i] + o[i + 1], n + 1, `size ${n}`)
  }
})

// ── Generation and byes ──────────────────────────────────────────────────────────────────
test('11 players make a 16-slot bracket with seeds 1 to 5 on byes', { skip }, () => {
  const ev = create('Eleven', 'ladder', ids(1, 11))
  assert.equal(q(`select bracket_size from bracket_events where id='${ev}'`), '16')
  assert.equal(count('bracket_matches', `event_id='${ev}'`), 15)
  assert.equal(count('bracket_matches', `event_id='${ev}' and status='bye'`), 5)
  // the five byes are exactly seeds 1..5
  const byeSeeds = rows(DB, `select e.seed from bracket_matches m join bracket_entrants e on e.event_id=m.event_id and e.profile_id=m.winner_id where m.event_id='${ev}' and m.status='bye' order by e.seed`).map(r => Number(r[0]))
  assert.deepEqual(byeSeeds, [1, 2, 3, 4, 5])
  // and the layout: slot 1 is 1 v bye, slot 2 is 8 v 9, ... slot 8 is 6 v 11
  assert.deepEqual(seedsIn(ev, 1, 2), [8, 9])
  assert.deepEqual(seedsIn(ev, 1, 6), [7, 10])
  assert.deepEqual(seedsIn(ev, 1, 8), [6, 11])
})

test('byes advance on their own: seed 1 starts round 2, and 4 meets 5', { skip }, () => {
  const ev = create('Byes advance', 'ladder', ids(1, 11))
  assert.deepEqual(seedsIn(ev, 2, 1), [1, null])
  assert.deepEqual(seedsIn(ev, 2, 2), [4, 5])
  assert.deepEqual(seedsIn(ev, 2, 3), [2, null])
  assert.deepEqual(seedsIn(ev, 2, 4), [3, null])
  assert.equal(count('bracket_matches', `event_id='${ev}' and status='bye' and (score_a is not null or score_b is not null)`), 0, 'a bye has no score')
})

test('a full bracket has no byes; the smallest and largest sizes work; the limits hold', { skip }, () => {
  const e16 = create('Sixteen', 'ladder', ids(1, 16))
  assert.equal(count('bracket_matches', `event_id='${e16}' and status='bye'`), 0)
  const e2 = create('Two', 'ladder', ids(1, 2))
  assert.equal(count('bracket_matches', `event_id='${e2}'`), 1)
  const e9 = create('Nine', 'ladder', ids(1, 9))
  assert.equal(count('bracket_matches', `event_id='${e9}' and status='bye'`), 7, '9 players in 16 slots: 7 byes')
  const e64 = create('Sixty four', 'ladder', ids(1, 64))
  assert.equal(count('bracket_matches', `event_id='${e64}'`), 63)
  assert.throws(() => create('One', 'ladder', ids(1, 1)), /between 2 and 64/)
  assert.throws(() => create('Sixty five', 'ladder', ids(1, 65)), /between 2 and 64/)
})

test('bad input is refused: a blank name, a repeated player, a stranger, an unknown seeding', { skip }, () => {
  assert.throws(() => create('   ', 'ladder', ids(1, 4)), /name/)
  assert.throws(() => create('Dup', 'ladder', [uid(1), uid(2), uid(2)]), /only once/)
  assert.throws(() => create('Stranger', 'ladder', [uid(1), uid(2), uid(99)]), /member of this league/)
  assert.throws(() => create('Bad', 'random', ids(1, 4)), /ladder or round_robin/)
  assert.equal(count('bracket_events', `name in ('', 'Dup', 'Stranger', 'Bad')`), 0, 'a refused event leaves nothing behind')
})

// ── Seeding ──────────────────────────────────────────────────────────────────────────────
test('ladder seeding ranks by the ladder rating', { skip }, () => {
  const ev = create('Ladder seeds', 'ladder', ids(1, 8))
  for (let n = 1; n <= 8; n++) assert.equal(seedOf(ev, uid(n)), 9 - n, `player ${n}`)
})

test('round robin seeding uses the newest season each player took part in, and puts players with no history last', { skip }, () => {
  // 1-6: newest season (rr = 1000 + n*5, so 1005..1030). 7: only the old season (1400). 8: old season (1100).
  // 9 and 10: no round robin history at all -> after everyone else, by ladder rating (10 above 9).
  const ev = create('RR seeds', 'round_robin', [...ids(1, 10)])
  const bySeed = rows(DB, `select seed, right(profile_id::text,2)::int from bracket_entrants where event_id='${ev}' order by seed`).map(r => Number(r[1]))
  // history first, best rr first: 7 (1400), 8 (1100), then 6..1 (1030 down to 1005); then no history, by ladder: 10 (1100), 9 (1090)
  assert.deepEqual(bySeed, [7, 8, 6, 5, 4, 3, 2, 1, 10, 9])
})

test('a player in two seasons is seeded from the newer one, not the older or the best', { skip }, () => {
  // Player 30: 1500 in the older season, 1100 in the newer. Player 31: 1300 in the older season only.
  // Newest-season rule: 31 (1300) outranks 30 (1100). The oldest season (or the best of both) would put 30 first.
  const TA = '00000000-0000-0000-0000-0000000000c8', TB = '00000000-0000-0000-0000-0000000000c9'
  psql(DB, { sql: `
    insert into tournaments(id,league_id,name,created_at) values ('${TA}','${L}','Older',  now() - interval '200 days'),
                                                                 ('${TB}','${L}','Newer',  now() - interval '100 days');
    insert into tournament_participants(tournament_id,profile_id,rr_rating) values
      ('${TA}','${uid(30)}',1500), ('${TB}','${uid(30)}',1100), ('${TA}','${uid(31)}',1300);` })
  const ev = create('Two seasons', 'round_robin', [uid(30), uid(31)])
  assert.deepEqual([seedOf(ev, uid(31)), seedOf(ev, uid(30))], [1, 2])
  psql(DB, { sql: `delete from tournaments where id in ('${TA}','${TB}');` })
})

test('ties break on the other rating, then on profile id', { skip }, () => {
  // make players 11, 12 and 13 tie on ladder; give them different round robin ratings (in a newer season)
  const T2 = '00000000-0000-0000-0000-0000000000b2'
  psql(DB, { sql: `
    update players set rating = 1500 where league_id='${L}' and profile_id in ('${uid(11)}','${uid(12)}','${uid(13)}');
    insert into tournaments(id,league_id,name,created_at) values ('${T2}','${L}','Newest season', now() + interval '1 day');
    insert into tournament_participants(tournament_id,profile_id,rr_rating) values ('${T2}','${uid(11)}',1200),('${T2}','${uid(12)}',1300),('${T2}','${uid(13)}',1300);` })
  const ev = create('Ties', 'ladder', [uid(11), uid(12), uid(13)])
  // ladder tie -> higher round robin first (12 and 13 at 1300, 11 at 1200); 12 and 13 tie again -> profile id (12 first)
  assert.deepEqual([seedOf(ev, uid(12)), seedOf(ev, uid(13)), seedOf(ev, uid(11))], [1, 2, 3])
  // round robin seeding with the same data: rr tie (12, 13) breaks on ladder (tied) then id
  const ev2 = create('Ties RR', 'round_robin', [uid(11), uid(12), uid(13)])
  assert.deepEqual([seedOf(ev2, uid(12)), seedOf(ev2, uid(13)), seedOf(ev2, uid(11))], [1, 2, 3])
  psql(DB, { sql: `delete from tournaments where id='${T2}'; update players set rating = 1000 + (right(profile_id::text, 12))::int * 10 where league_id='${L}';` })
})

test('seeds are stored at generation: later rating changes do not redraw the bracket', { skip }, () => {
  const ev = create('Stored seeds', 'ladder', ids(1, 4))
  const before = rows(DB, `select profile_id, seed from bracket_entrants where event_id='${ev}' order by seed`)
  psql(DB, { sql: `update players set rating = 500 where profile_id='${uid(4)}' and league_id='${L}';` })
  assert.deepEqual(rows(DB, `select profile_id, seed from bracket_entrants where event_id='${ev}' order by seed`), before)
  psql(DB, { sql: `update players set rating = 1000 + 4 * 10 where profile_id='${uid(4)}' and league_id='${L}';` })
})

test('the preview shows the same draw that creating would, and saves nothing', { skip }, () => {
  const eventsBefore = count('bracket_events'), matchesBefore = count('bracket_matches')
  const p = as(ADMIN, `select seed, profile_id, bracket_size, has_bye from public.preview_bracket_seeds('${L}','ladder',${arr(ids(1, 11))}) order by seed;`).out.split('\n').slice(1).map(l => l.split('|'))
  assert.equal(p.length, 11)
  assert.deepEqual(p.map(r => r[3]), ['t', 't', 't', 't', 't', 'f', 'f', 'f', 'f', 'f', 'f'], 'seeds 1-5 have byes')
  assert.ok(p.every(r => r[2] === '16'))
  assert.equal(count('bracket_events'), eventsBefore, 'previewing saved nothing')
  assert.equal(count('bracket_matches'), matchesBefore)
  const ev = create('Matches preview', 'ladder', ids(1, 11))
  assert.deepEqual(p.map(r => seedOf(ev, r[1])), p.map(r => Number(r[0])), 'the preview and the real draw agree')
  assert.equal(count('bracket_events'), eventsBefore + 1)
  assert.equal(count('bracket_matches'), matchesBefore + 15, 'only the one real event added rows')
})

// ── Scores ───────────────────────────────────────────────────────────────────────────────
test('only finished scores are accepted: first to 4 or a full set to 6, no ties', { skip }, () => {
  const ev = create('Scores', 'ladder', ids(1, 4))
  for (const [a, b] of [[4, 4], [5, 3], [3, 3], [7, 5], [7, 6], [4, 5], [6, 6], [0, 0], [5, 5]]) {
    assert.throws(() => report(ev, 1, 1, a, b), /not a finished score/, `${a}-${b}`)
  }
  assert.equal(q(`select status from bracket_matches where id='${matchId(ev, 1, 1)}'`), 'pending', 'refused scores save nothing')
  for (const [slot, a, b] of [[1, 4, 3], [2, 0, 6]]) report(ev, 1, slot, a, b)
  assert.equal(q(`select score_a||'-'||score_b from bracket_matches where id='${matchId(ev, 1, 1)}'`), '4-3')
  assert.equal(q(`select score_a||'-'||score_b from bracket_matches where id='${matchId(ev, 1, 2)}'`), '0-6')
  const ev2 = create('Scores 6-5', 'ladder', ids(1, 2))
  report(ev2, 1, 1, 6, 5)
  assert.equal(q(`select status from bracket_matches where id='${matchId(ev2, 1, 1)}'`), 'completed')
})

test('winners move to the right slot: odd slots feed side A, even slots feed side B', { skip }, () => {
  const ev = create('Advance', 'ladder', ids(1, 8))
  // 8 players: layout 1v8, 4v5, 2v7, 3v6. Slot 1 (odd) and 2 (even) feed round 2 slot 1.
  const winner1 = slotPlayers(ev, 1, 1)[0]            // the 1 seed, side A
  report(ev, 1, 1, 4, 0)
  assert.equal(slotPlayers(ev, 2, 1)[0], winner1, 'slot 1 winner is side A of round 2')
  const winner2 = slotPlayers(ev, 1, 2)[1]            // the 5 seed, side B, wins this time
  report(ev, 1, 2, 2, 4)
  assert.equal(slotPlayers(ev, 2, 1)[1], winner2, 'slot 2 winner is side B of round 2')
})

test('you cannot score a match before both players are known, or a bye', { skip }, () => {
  const ev = create('Order', 'ladder', ids(1, 11))
  assert.throws(() => report(ev, 3, 1, 4, 0), /Both players are not known yet/)
  assert.throws(() => report(ev, 2, 1, 4, 0), /Both players are not known yet/, 'seed 1 is waiting for the 8 v 9 winner')
  const bye = q(`select id from bracket_matches where event_id='${ev}' and round=1 and status='bye' limit 1`)
  assert.throws(() => as(ADMIN, `select public.report_bracket_match('${bye}', 4, 0);`), /bye/)
})

test('the final crowns a champion and completes the event', { skip }, () => {
  const ev = create('Champion', 'ladder', ids(1, 4))     // 1v4, 2v3
  report(ev, 1, 1, 4, 1); report(ev, 1, 2, 4, 2)
  assert.equal(q(`select status from bracket_events where id='${ev}'`), 'in_progress')
  const finalist1 = slotPlayers(ev, 2, 1)[0]
  report(ev, 2, 1, 6, 3)
  assert.equal(q(`select champion_id from bracket_events where id='${ev}'`), finalist1)
  assert.equal(q(`select status from bracket_events where id='${ev}'`), 'completed')
  assert.notEqual(q(`select completed_at from bracket_events where id='${ev}'`), '')
})

// ── Corrections and locking ──────────────────────────────────────────────────────────────
test('a result can be corrected until the next match has been played, and the new winner takes the slot', { skip }, () => {
  const ev = create('Correct', 'ladder', ids(1, 4))
  report(ev, 1, 1, 4, 0)                                  // seed 1 beats seed 4
  const seed1 = slotPlayers(ev, 1, 1)[0], seed4 = slotPlayers(ev, 1, 1)[1]
  assert.equal(slotPlayers(ev, 2, 1)[0], seed1)
  report(ev, 1, 1, 2, 4)                                  // correction: seed 4 actually won
  assert.equal(slotPlayers(ev, 2, 1)[0], seed4, 'the corrected winner moved up')
  assert.equal(q(`select winner_id from bracket_matches where id='${matchId(ev, 1, 1)}'`), seed4)
  report(ev, 1, 1, 4, 1)                                  // and back again
  assert.equal(slotPlayers(ev, 2, 1)[0], seed1)
  report(ev, 1, 1, 4, 2)                                  // same winner, different score: fine
  assert.equal(q(`select score_a||'-'||score_b from bracket_matches where id='${matchId(ev, 1, 1)}'`), '4-2')
})

test('once the next match is played the earlier result is locked', { skip }, () => {
  const ev = create('Locked', 'ladder', ids(1, 4))
  report(ev, 1, 1, 4, 0); report(ev, 1, 2, 4, 0)
  report(ev, 2, 1, 4, 1)                                  // the final is played
  assert.throws(() => report(ev, 1, 1, 0, 4), /already played the next round/)
  assert.throws(() => report(ev, 1, 2, 3, 4), /already played the next round/)
  assert.equal(q(`select score_a||'-'||score_b from bracket_matches where id='${matchId(ev, 1, 1)}'`), '4-0', 'unchanged')
  // the final itself can still be corrected, and the champion follows
  const [a, b] = slotPlayers(ev, 2, 1)
  report(ev, 2, 1, 1, 4)
  assert.equal(q(`select champion_id from bracket_events where id='${ev}'`), b)
  report(ev, 2, 1, 4, 1)
  assert.equal(q(`select champion_id from bracket_events where id='${ev}'`), a)
})

// ── Permissions ──────────────────────────────────────────────────────────────────────────
test('only a league admin can create, preview, score or delete; being admin of another league does not count', { skip }, () => {
  const ev = create('Guarded', 'ladder', ids(1, 4))
  const m = matchId(ev, 1, 1)
  for (const who of [uid(3), ADMIN2]) {                   // a plain player, and the admin of a different league
    assert.throws(() => as(who, `select public.create_bracket_event('${L}','Nope','ladder',${arr(ids(1, 4))});`), /Only a league admin/, who)
    assert.throws(() => as(who, `select * from public.preview_bracket_seeds('${L}','ladder',${arr(ids(1, 4))});`), /Only a league admin/, who)
    assert.throws(() => as(who, `select public.report_bracket_match('${m}', 4, 0);`), /Only a league admin/, who)
    assert.throws(() => as(who, `select public.delete_bracket_event('${ev}');`), /Only a league admin/, who)
  }
  assert.throws(() => anon(`select public.create_bracket_event('${L}','Nope','ladder',${arr(ids(1, 4))});`), DENIED)
  assert.throws(() => anon(`select public.report_bracket_match('${m}', 4, 0);`), DENIED)
  assert.equal(q(`select status from bracket_matches where id='${m}'`), 'pending')
  assert.equal(count('bracket_events', `name='Nope'`), 0)
  // the other league's admin can run events in their own league
  psql(DB, { sql: `insert into players(profile_id,league_id) values ('${uid(20)}','${L2}'),('${uid(21)}','${L2}') on conflict do nothing;` })
  assert.ok(create('Other league', 'ladder', [uid(20), uid(21)], ADMIN2, L2))
})

test('the app cannot write the bracket tables directly, and cannot call the internal functions', { skip }, () => {
  const ev = create('Direct', 'ladder', ids(1, 4))
  for (const who of ['authenticated', 'anon']) {
    const run = sql => psql(DB, { sql: `set role ${who}; select set_config('request.jwt.claim.sub','${ADMIN}',false); ${sql}` })
    assert.throws(() => run(`insert into public.bracket_events(league_id,name,seeding,bracket_size) values ('${L}','Sneak','ladder',2);`), DENIED, who)
    assert.throws(() => run(`update public.bracket_matches set winner_id = player_a_id where event_id='${ev}';`), DENIED, who)
    assert.throws(() => run(`delete from public.bracket_entrants where event_id='${ev}';`), DENIED, who)
    assert.throws(() => run(`update public.bracket_events set champion_id = '${uid(1)}' where id='${ev}';`), DENIED, who)
    assert.throws(() => run(`select public.bracket_place_winner('${matchId(ev, 1, 1)}');`), DENIED, who)
    assert.throws(() => run(`select * from public.bracket_seed_players('${L}','ladder',${arr(ids(1, 4))});`), DENIED, who)
  }
  // reading is open to everyone, signed in or not
  assert.equal(anon(`select count(*) from public.bracket_matches where event_id='${ev}';`).out, '3')
  assert.equal(as(uid(3), `select count(*) from public.bracket_events where id='${ev}';`).out.split('\n').pop(), '1')
})

// ── Standing alone ───────────────────────────────────────────────────────────────────────
test('a tournament touches nothing else: ratings, matches, history, seasons, XP, pass and quests are unchanged', { skip }, () => {
  const tables = ['players', 'matches', 'elo_history', 'tournaments', 'tournament_participants', 'tournament_matches',
    'tournament_weeks', 'player_quest_progress', 'player_weekly_play_xp']
  const fingerprint = () => tables.map(t => q(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), 'empty') from public.${t} x`)).join(',')
  const windowStart = () => q(`select public.pass_window_start('${L}')::text`)
  const sync = () => as(ADMIN, `select public.sync_quest_progress('${L}');`)
  sync()                                                  // bring XP and quests up to date first, so the comparison is fair
  const snap = fingerprint(), win = windowStart()
  const ev = create('Alone', 'ladder', ids(1, 8))
  for (let slot = 1; slot <= 4; slot++) report(ev, 1, slot, 4, slot % 4)
  for (let slot = 1; slot <= 2; slot++) report(ev, 2, slot, 6, 2)
  report(ev, 3, 1, 4, 3)
  assert.equal(q(`select status from bracket_events where id='${ev}'`), 'completed', 'the whole event was played')
  assert.equal(fingerprint(), snap, 'nothing outside the bracket tables changed')
  assert.equal(windowStart(), win, 'the battle pass did not restart')
  sync()                                                  // and the XP and quest sync finds nothing new to count
  assert.equal(fingerprint(), snap, 'the quest and XP sync did not count any tournament match')
})

// ── Deleting ─────────────────────────────────────────────────────────────────────────────
test('deleting an event removes its entrants and matches and nothing else', { skip }, () => {
  const keep = create('Keep me', 'ladder', ids(1, 4))
  const gone = create('Delete me', 'ladder', ids(1, 8))
  const keepRows = [count('bracket_entrants', `event_id='${keep}'`), count('bracket_matches', `event_id='${keep}'`)]
  as(ADMIN, `select public.delete_bracket_event('${gone}');`)
  assert.equal(count('bracket_events', `id='${gone}'`), 0)
  assert.equal(count('bracket_entrants', `event_id='${gone}'`), 0)
  assert.equal(count('bracket_matches', `event_id='${gone}'`), 0)
  assert.deepEqual([count('bracket_entrants', `event_id='${keep}'`), count('bracket_matches', `event_id='${keep}'`)], keepRows)
  assert.throws(() => as(ADMIN, `select public.delete_bracket_event('${gone}');`), /does not exist/)
})
