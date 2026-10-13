// Round robin behaviour end to end on a real Postgres: reporting scores, match
// points, battle pass Play XP, removing a match, a season that mixes first-to-4
// and full-set-to-6 matches, and upgrading from v0.0.6.3 / v0.0.6.8 without
// disturbing history.   run:  node --test tests/db
//
// The expected numbers come from a small reference model in helpers.mjs that
// is written independently of the SQL, so a bug has to be made twice to slip by.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, rows, dropDb, cloneDb } from '../lib/pg.mjs'
import { replay, apply, seedBaseSql, seasonSql, extraMatchesSql, SEASON, allTo, MIXED, expectedRrPoints, expectedPlayXp, L, T, pid } from './helpers.mjs'

const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const BASE = 'rally_t_base', FRESH = 'rally_t_fresh', REJ = 'rally_t_rej', UPG = 'rally_t_upg'
const sync = db => psql(db, { sql: `select public.sync_quest_progress('${L}')` })

const weeklyRows = db => Object.fromEntries(rows(db, `
  select right(profile_id::text,1), ((week_start::date - date_trunc('week', now())::date) / 7), matches_counted, xp_awarded
    from player_weekly_play_xp where league_id = '${L}'`).map(([p, w, n, xp]) => [`${p}|${w}`, { n: +n, xp: +xp }]))
const rrPoints = db => Object.fromEntries(rows(db, `select right(profile_id::text,1), rr_points from tournament_participants where tournament_id = '${T}'`).map(([p, v]) => [p, +v]))
const questRows = db => rows(db, `select right(profile_id::text,1), quest_template_id, period_start, progress_count, coalesce(completed_at::text,''), xp_awarded from player_quest_progress order by 1,2,3`)
const ptsModel = season => { const e = expectedRrPoints(season); return Object.fromEntries([1, 2, 3, 4, 5, 6].map(p => [p, e[p] ?? 0])) }

before(() => {
  if (skip) return
  replay(BASE)
  psql(BASE, { sql: seedBaseSql() })        // players, a league, a season, three weeks; no matches yet
  for (const d of [FRESH, REJ]) cloneDb(BASE, d)
})
after(() => { if (!skip) for (const d of [BASE, FRESH, REJ, UPG]) dropDb(d) })

// ── Reporting scores ─────────────────────────────────────────────────
test('legal scores are accepted and illegal ones refused with a reason that names both formats', { skip }, () => {
  const out = psql(REJ, { sql: `
    create temp table res(a int, b int, result text);
    do $$
    declare mid uuid; p record;
    begin
      perform set_config('request.jwt.claim.sub','${pid(5)}',false);
      for p in select a, b from generate_series(-1,9) a, generate_series(-1,9) b loop
        insert into tournament_matches(id,tournament_id,phase,player_a_id,player_b_id,format,status,week_id)
          values (gen_random_uuid(),'${T}','round_robin','${pid(5)}','${pid(6)}','singles','pending','00000000-0000-0000-0000-0000000000c2')
          returning id into mid;
        begin
          perform public.report_tournament_match(mid, p.a, p.b);
          insert into res values (p.a, p.b, 'accepted');
        exception when others then
          insert into res values (p.a, p.b, sqlerrm);
        end;
      end loop;
    end $$;
    select a, b, result from res order by a, b;` }).out.split('\n').map(l => l.split('|'))
  assert.equal(out.length, 121)
  for (const [a, b, result] of out) {
    const ok = [4, 6].some(t => (+a === t && +b >= 0 && +b < t) || (+b === t && +a >= 0 && +a < t))
    if (ok) assert.equal(result, 'accepted', `${a}-${b} should be accepted`)
    else { assert.notEqual(result, 'accepted', `${a}-${b} should be refused`); assert.match(result, /first to 4 games, or a full set to 6/, `${a}-${b}: ${result}`) }
  }
})

test('a match cannot be reported twice', { skip }, () => {
  assert.throws(() => psql(REJ, { sql: `
    do $$ declare mid uuid; begin
      perform set_config('request.jwt.claim.sub','${pid(5)}',false);
      insert into tournament_matches(id,tournament_id,phase,player_a_id,player_b_id,format,status,week_id)
        values (gen_random_uuid(),'${T}','round_robin','${pid(5)}','${pid(6)}','singles','pending','00000000-0000-0000-0000-0000000000c2') returning id into mid;
      perform public.report_tournament_match(mid, 6, 1);
      perform public.report_tournament_match(mid, 6, 2);
    end $$;` }), /already been reported/)
})

// ── Points and battle pass XP on a fresh install ─────────────────────
// A season that mixes the two formats, as a real one does (odd-numbered matches
// of the staged season are played to 6, the rest to 4).
test('fresh install: round robin points and weekly Play XP match the reference model', { skip }, () => {
  psql(FRESH, { sql: seasonSql(MIXED) })
  sync(FRESH)
  assert.deepEqual(rrPoints(FRESH), ptsModel(MIXED))
  assert.deepEqual(weeklyRows(FRESH), expectedPlayXp(MIXED, 0))
})

test('the weekly XP model is exercised: full rate, trickle after five, flat for ladder and challenges', { skip }, () => {
  const w = weeklyRows(FRESH)
  // player 1, this week, in order: ladder 15, win 16, loss 0-6 = 0, loss 3-4 = 12,
  // loss 2-6 = 4 (those five are the full-rate slots: 47), then a win, a 1-6 loss and a
  // challenge, each at the trickle rate of 2 (+6) = 53
  assert.equal(w['1|0'].n, 8)
  assert.equal(w['1|0'].xp, 53)
  // player 1 earlier weeks are untouched by the new rule (flat 15 per match, five at full rate)
  assert.equal(w['1|-2'].xp, 45)
  assert.equal(w['1|-1'].xp, 5 * 15 + 2 * 2)
})

test('both formats in one season: a loss one game short earns 3 in either, and each format has its own scale', { skip }, () => {
  const pts = (w, l) => +rows(FRESH, `select public.rr_match_points(${w}, ${l})`)[0][0]
  assert.equal(pts(3, 4), 3); assert.equal(pts(5, 6), 3)
  assert.deepEqual([0, 1, 2, 3].map(n => pts(n, 4)), [0, 1, 2, 3])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => pts(n, 6)), [0, 1, 1, 2, 2, 3])
  // and the season really did contain both formats
  const played = rows(FRESH, `select score_a, score_b from tournament_matches where status='completed' and phase<>'challenge'`)
  assert.ok(played.some(([a, b]) => Math.max(+a, +b) === 6), 'the season contains sets played to 6')
  assert.ok(played.some(([a, b]) => Math.max(+a, +b) === 4), 'and matches played to 4')
})

test('syncing again changes nothing', { skip }, () => {
  const before = [weeklyRows(FRESH), rrPoints(FRESH), questRows(FRESH)]
  sync(FRESH); sync(FRESH)
  assert.deepEqual([weeklyRows(FRESH), rrPoints(FRESH), questRows(FRESH)], before)
})

test('removing a match takes back its points and XP, and a later match moves into the full-rate five', { skip }, () => {
  const idx = MIXED.findIndex(m => m.wk === 0 && m.hr === 13)            // player 1 loses 0-6 this week
  const ids = rows(FRESH, `select id from tournament_matches where tournament_id='${T}' and status='completed' and date_trunc('hour', completed_at) = date_trunc('week', now()) + interval '13 hours'`)
  assert.equal(ids.length, 1)
  psql(FRESH, { sql: `select set_config('request.jwt.claim.sub','${pid(1)}',false); select public.remove_tournament_match('${ids[0][0]}')` })
  sync(FRESH)
  const remaining = MIXED.filter((_, i) => i !== idx)
  assert.deepEqual(rrPoints(FRESH), ptsModel(remaining))
  assert.deepEqual(weeklyRows(FRESH), expectedPlayXp(MIXED, 0, { skip: new Set([idx]) }))
})

// ── Upgrading a live league from v0.0.6.3 ────────────────────────────
// This league is first to 4 throughout, as it was before first to 6 existed.
const OLD = allTo(4)

test('upgrade from 6.3: history keeps its XP, this week is re-scored, quests are untouched', { skip }, () => {
  replay(UPG, { through: '0.0.6.3' })
  psql(UPG, { sql: seedBaseSql() + seasonSql(OLD) })        // a first-to-4 league, as it was before this version
  sync(UPG)
  const flatBefore = weeklyRows(UPG)
  assert.deepEqual(flatBefore, expectedPlayXp(OLD, 99), 'before the upgrade every match is a flat 15')
  const questsBefore = questRows(UPG)

  apply(UPG, '0.0.6.4'); sync(UPG)
  assert.deepEqual(rrPoints(UPG), ptsModel(OLD), 'points recomputed under the new loss rule')
  const after = weeklyRows(UPG)
  assert.deepEqual(after, expectedPlayXp(OLD, 0))
  for (const k of Object.keys(flatBefore).filter(k => !k.endsWith('|0'))) assert.deepEqual(after[k], flatBefore[k], `past week ${k} unchanged`)
  assert.notDeepEqual(after['1|0'], flatBefore['1|0'], 'this week was re-scored')
  assert.deepEqual(questRows(UPG), questsBefore, 'quest progress and quest XP are byte-identical')

  apply(UPG, '0.0.6.4'); sync(UPG)
  assert.deepEqual(weeklyRows(UPG), after, 're-running 6.4 changes nothing (the cut-off week is kept)')
})

test('upgrade to first-to-6 (6.8): old first-to-4 results still count exactly as before, and the audit lists them', { skip }, () => {
  const ptsBefore = rrPoints(UPG), xpBefore = weeklyRows(UPG)
  const notices = apply(UPG, '0.0.6.8'); sync(UPG)
  const completed = SEASON.filter(m => !m.ladder).length
  assert.ok(notices.some(n => n.includes(`${completed} completed match(es) are not first-to-6 scores`)), notices.join(' / '))
  assert.equal(notices.filter(n => n.startsWith('Not a first-to-6 score')).length, Math.min(25, completed), 'lists each one, up to 25')
  assert.deepEqual(rrPoints(UPG), ptsBefore)
  assert.deepEqual(weeklyRows(UPG), xpBefore)
  assert.deepEqual(rrPoints(UPG), ptsModel(OLD))
})

test('upgrade to 7.2: first-to-4 results are legal again and unchanged; sets played to 6 under 6.8 are re-scored', { skip }, () => {
  // Under 6.8 (first to 6, losses capped at 3) two sets are played: player 5 beats 6 by 6-3, then 6 beats 5 by 6-4.
  psql(UPG, { sql: extraMatchesSql([{ wk: 0, hr: 40, a: 5, b: 6, sa: 6, sb: 3 }, { wk: 0, hr: 41, a: 6, b: 5, sa: 6, sb: 4 }]) })
  sync(UPG)
  const base = ptsModel(OLD), ptsBefore = rrPoints(UPG), xpBefore = weeklyRows(UPG)
  // 6.8 rule: each loss was worth 3, so each of the two players has 4 + 3 more than the first-to-4 season
  assert.deepEqual(ptsBefore, { ...base, 5: base[5] + 7, 6: base[6] + 7 })

  const notices = apply(UPG, '0.0.7.2'); sync(UPG)
  assert.ok(notices.some(n => n.startsWith('Re-scored: 2 completed match(es) were played to 6')), notices.join(' / '))
  assert.ok(notices.some(n => n.includes('Score audit: every completed match is a legal first-to-4 or full-set-to-6 score')), notices.join(' / '))
  // new scale: 3-6 earns 2 and 4-6 earns 2, so each of the two players ends with 4 + 2 more
  assert.deepEqual(rrPoints(UPG), { ...base, 5: base[5] + 6, 6: base[6] + 6 })
  // Play XP follows (4 per point): each of the two players' losses drops from 12 to 8, and nobody else moves
  const xpAfter = weeklyRows(UPG)
  for (const k of Object.keys(xpBefore)) {
    const drop = k === '5|0' || k === '6|0' ? 4 : 0
    assert.equal(xpAfter[k].xp, xpBefore[k].xp - drop, `play XP ${k}`)
    assert.equal(xpAfter[k].n, xpBefore[k].n, `matches counted ${k}`)
  }
  // re-running it changes nothing
  const again = apply(UPG, '0.0.7.2'); sync(UPG)
  assert.deepEqual(rrPoints(UPG), { ...base, 5: base[5] + 6, 6: base[6] + 6 })
  assert.deepEqual(weeklyRows(UPG), xpAfter)
  assert.ok(again.some(n => n.includes('v0.0.7.2 OK')), again.join(' / '))
})
