// The migration chain: every file applies in version order without a single
// SQL error, the recent ones are safe to run twice, and the ones with
// prerequisites refuse to run without them.   run:  node --test tests/db
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { haveDatabase, psql, dropDb, cloneDb } from '../lib/pg.mjs'
import { replay, apply, migrations, versionName } from './helpers.mjs'

const skip = !haveDatabase() && 'no Postgres reachable (set PGHOST/PGUSER, see tests/README.md)'
const FULL = 'rally_t_mig', EARLY = 'rally_t_mig_early'
after(() => { if (!skip) { dropDb(FULL); dropDb(EARLY) } })

test('base schema + every migration applies in order with no errors', { skip }, () => {
  const notices = replay(FULL)
  assert.ok(migrations().length >= 30, 'found the migration files')
  assert.ok(Object.keys(notices).includes('0.0.6.8'), 'latest migration ran')
})

test('recent migrations are idempotent (a second run changes nothing and raises nothing)', { skip }, () => {
  for (const v of ['0.0.6.3', '0.0.6.4', '0.0.6.8']) assert.doesNotThrow(() => apply(FULL, v), `v${v} second run`)
  assert.doesNotThrow(() => apply(FULL, '0.0.6.8'), 'v0.0.6.8 third run')
})

test('migrations with prerequisites refuse to run without them', { skip }, () => {
  replay(EARLY, { through: '0.0.6.2' })
  assert.throws(() => apply(EARLY, '0.0.6.4'), /Run supabase-migration-v0\.0\.6\.3\.sql first/)
  assert.throws(() => apply(EARLY, '0.0.6.8'), /Run supabase-migration-v0\.0\.6\.3\.sql first/)
  // and once the prerequisite is there they go through
  apply(EARLY, '0.0.6.3'); apply(EARLY, '0.0.6.4'); apply(EARLY, '0.0.6.8')
  cloneDb(EARLY, EARLY + '_g')
  psql(EARLY + '_g', { sql: 'drop function public.rr_match_points(int,int) cascade' })
  assert.throws(() => apply(EARLY + '_g', '0.0.6.3'), /Run supabase-migration-v0\.0\.6\.2\.sql first/)
  dropDb(EARLY + '_g')
})
