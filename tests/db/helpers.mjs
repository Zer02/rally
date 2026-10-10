// Shared pieces for the database tests: find the migrations, replay them in
// version order on a scratch database, and build seed data.
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createDb, psql } from '../lib/pg.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const STUB = join(ROOT, 'tests', 'db', 'stub-supabase.sql')

const versionOf = f => f.match(/v([\d.]+)\.sql$/)[1].split('.').map(Number)
const cmp = (a, b) => { for (let i = 0; i < 4; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d } return 0 }

/** supabase-migration-vX.X.X.X.sql files, oldest first. */
export const migrations = () =>
  readdirSync(ROOT).filter(f => /^supabase-migration-v[\d.]+\.sql$/.test(f)).sort((x, y) => cmp(versionOf(x), versionOf(y)))

export const file = f => join(ROOT, f)
export const versionName = f => f.match(/v([\d.]+)\.sql$/)[1]

/**
 * Fresh database = stub + base schema + migrations up to and including
 * `through` (a version like '0.0.6.3'; default: all of them). Every file must
 * apply without a single SQL error. Returns the notices printed per file.
 */
export function replay(db, { through } = {}) {
  createDb(db)
  psql(db, { file: STUB })
  psql(db, { file: file('supabase-schema.sql') })
  const notices = {}
  for (const m of migrations()) {
    notices[versionName(m)] = psql(db, { file: file(m) }).notices
    if (through && versionName(m) === through) break
  }
  return notices
}

export const apply = (db, version) => psql(db, { file: file(`supabase-migration-v${version}.sql`) }).notices

// ── Seed data ────────────────────────────────────────────────────────
export const L = '00000000-0000-0000-0000-0000000000aa'
export const T = '00000000-0000-0000-0000-0000000000bb'
export const pid = n => `00000000-0000-0000-0000-00000000000${n}`

export function seedBaseSql() {
  return `
insert into leagues(id,name,sport) values ('${L}','Test League','tennis');
insert into auth.users(id,email,raw_user_meta_data)
  select ('00000000-0000-0000-0000-00000000000'||i)::uuid, 'p'||i||'@x.test', jsonb_build_object('username','p'||i) from generate_series(1,6) i;
insert into players(profile_id,league_id)
  select ('00000000-0000-0000-0000-00000000000'||i)::uuid,'${L}' from generate_series(1,6) i on conflict do nothing;
insert into league_admins(league_id,profile_id) values ('${L}','${pid(1)}') on conflict do nothing;
insert into tournaments(id,league_id,name) values ('${T}','${L}','Season T');
insert into tournament_participants(tournament_id,profile_id)
  select '${T}', ('00000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,6) i;
insert into tournament_weeks(id,tournament_id,week_number) values
  ('00000000-0000-0000-0000-0000000000c0','${T}',1),('00000000-0000-0000-0000-0000000000c1','${T}',2),('00000000-0000-0000-0000-0000000000c2','${T}',3);
`
}

// A temporary helper that plays one match (it lives only as long as the psql session,
// so seasonSql() carries it along).
const REP_FN = `
create or replace function pg_temp.rep(wk int, hr int, a int, b int, sa int, sb int,
   c int default null, d int default null, fmt text default 'singles', ph text default 'round_robin') returns uuid language plpgsql as $f$
declare mid uuid := gen_random_uuid(); base timestamptz := date_trunc('week', now());
begin
  insert into tournament_matches(id,tournament_id,phase,player_a_id,player_b_id,player_a2_id,player_b2_id,format,status,week_id)
  values (mid,'${T}',ph,
    ('00000000-0000-0000-0000-00000000000'||a)::uuid, ('00000000-0000-0000-0000-00000000000'||b)::uuid,
    case when c is null then null else ('00000000-0000-0000-0000-00000000000'||c)::uuid end,
    case when d is null then null else ('00000000-0000-0000-0000-00000000000'||d)::uuid end, fmt,'pending',
    case wk when -2 then '00000000-0000-0000-0000-0000000000c0' when -1 then '00000000-0000-0000-0000-0000000000c1' else '00000000-0000-0000-0000-0000000000c2' end::uuid);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000'||a,false);
  perform public.report_tournament_match(mid, sa, sb);
  update tournament_matches set completed_at = base + (wk * interval '7 days') + (hr * interval '1 hour') where id = mid;
  return mid;
end $f$;
`

/**
 * The staged season used by the XP tests. Each match: week offset from this
 * week (-2, -1, 0), hour of that week, the two sides, who won, and how many
 * games the loser took (0-3, so the same list is legal at first-to-4 and
 * first-to-6). `ladder` matches go in the separate 1v1 ladder table.
 */
export const SEASON = [
  // two weeks ago: player 1 plays 3
  { wk: -2, hr: 10, a: [1], b: [2], win: 'b', lg: 0 },
  { wk: -2, hr: 20, a: [1], b: [3], win: 'a', lg: 1 },
  { wk: -2, hr: 30, a: [1], b: [4], win: 'a', lg: 3 },
  // last week: player 1 plays 7
  { wk: -1, hr: 10, a: [1], b: [2], win: 'a', lg: 0 },
  { wk: -1, hr: 20, a: [1], b: [3], win: 'b', lg: 0 },
  { wk: -1, hr: 30, a: [1], b: [4], win: 'b', lg: 3 },
  { wk: -1, hr: 40, a: [1], b: [5], win: 'b', lg: 2 },
  { wk: -1, hr: 50, a: [1], b: [6], win: 'a', lg: 2 },
  { wk: -1, hr: 60, a: [1], b: [2], win: 'b', lg: 1 },
  { wk: -1, hr: 70, a: [1], b: [3], win: 'a', lg: 0 },
  // this week: six round robin matches, a challenge, a doubles match, a ladder match
  { wk: 0, hr: 12, a: [1], b: [2], win: 'a', lg: 0 },
  { wk: 0, hr: 13, a: [1], b: [3], win: 'b', lg: 0 },
  { wk: 0, hr: 14, a: [1], b: [4], win: 'b', lg: 3 },
  { wk: 0, hr: 15, a: [1], b: [5], win: 'b', lg: 2 },
  { wk: 0, hr: 16, a: [1], b: [6], win: 'a', lg: 2 },
  { wk: 0, hr: 17, a: [1], b: [2], win: 'b', lg: 1 },
  { wk: 0, hr: 18, a: [1], b: [3], win: 'a', lg: 0, phase: 'challenge' },
  { wk: 0, hr: 20, a: [3, 4], b: [5, 6], win: 'b', lg: 3, fmt: 'doubles' },
  { wk: 0, hr: 5, a: [1], b: [2], win: 'a', ladder: true },
]

/** SQL that plays SEASON, with winners reaching `target` games. */
export function seasonSql(target) {
  return REP_FN + SEASON.map(m => {
    if (m.ladder) return `insert into matches(league_id,challenger_id,opponent_id,winner_id,challenger_score,opponent_score,status,completed_at)
      values ('${L}','${pid(m.a[0])}','${pid(m.b[0])}','${pid(m.a[0])}','11,11','5,6','completed', date_trunc('week', now()) + interval '${m.hr} hours');`
    const sa = m.win === 'a' ? target : m.lg, sb = m.win === 'b' ? target : m.lg
    const [a, c] = m.a, [b, d] = m.b
    return `select pg_temp.rep(${m.wk},${m.hr},${a},${b},${sa},${sb},${c ?? 'null'},${d ?? 'null'},'${m.fmt ?? 'singles'}','${m.phase ?? 'round_robin'}');`
  }).join('\n')
}

// ── Reference model (written independently of the SQL) ──────────────────
export const pointsFor = (won, lost) => won > lost ? 4 : Math.max(0, Math.min(3, won))

/** Expected round robin points per player (challenge matches earn none). */
export function expectedRrPoints(season = SEASON) {
  const pts = {}
  for (const m of season) {
    if (m.ladder || m.phase === 'challenge') continue
    const winners = m.win === 'a' ? m.a : m.b, losers = m.win === 'a' ? m.b : m.a
    for (const p of winners) pts[p] = (pts[p] ?? 0) + 4
    for (const p of losers) pts[p] = (pts[p] ?? 0) + pointsFor(m.lg, 99)
  }
  return pts
}

/**
 * Expected Play XP per player and week: the first 5 matches of a week (by
 * completion time) earn their own XP, later ones 2. A match's own XP is a flat
 * 15 for ladder matches, challenge matches and any week before the new rule
 * started (`ruleStartWk`, an offset from this week); otherwise 4 per match point.
 * Returns { 'player|week': { n, xp } }.
 */
export function expectedPlayXp(season = SEASON, ruleStartWk = 0, { skip = new Set() } = {}) {
  const per = {}
  season.forEach((m, i) => {
    if (skip.has(i)) return
    const sides = m.ladder ? [[m.a[0]], [m.b[0]]] : [m.a, m.b]
    sides.forEach((side, si) => {
      const won = m.ladder ? (si === 0) : (m.win === (si === 0 ? 'a' : 'b'))
      const xp = (m.ladder || m.phase === 'challenge' || m.wk < ruleStartWk) ? 15 : 4 * (won ? 4 : pointsFor(m.lg, 99))
      for (const p of side) (per[`${p}|${m.wk}`] ??= []).push({ hr: m.hr, xp })
    })
  })
  const out = {}
  for (const [k, list] of Object.entries(per)) {
    list.sort((x, y) => x.hr - y.hr)
    out[k] = { n: list.length, xp: list.reduce((s, e, i) => s + (i < 5 ? e.xp : 2), 0) }
  }
  return out
}
