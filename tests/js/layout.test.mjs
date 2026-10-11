// Repository layout: the database files live under supabase/, and the tests can find them.
// Node only (no Postgres), so it runs in `npm run test:js` too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('base schema and operational scripts are under supabase/', () => {
  assert.ok(existsSync(join(ROOT, 'supabase', 'schema.sql')), 'supabase/schema.sql is missing')
  for (const f of ['reset-for-launch.sql', 'reset-round-robin.sql'])
    assert.ok(existsSync(join(ROOT, 'supabase', 'scripts', f)), `supabase/scripts/${f} is missing`)
})

test('no SQL files are left in the repo root', () => {
  const stray = readdirSync(ROOT).filter(f => f.endsWith('.sql'))
  assert.deepEqual(stray, [], `move these under supabase/: ${stray.join(', ')}`)
})

test('every migration is in supabase/migrations/ and named supabase-migration-vX.X.X.X.sql', () => {
  const files = readdirSync(join(ROOT, 'supabase', 'migrations'))
  assert.ok(files.length > 0, 'supabase/migrations/ is empty')
  const bad = files.filter(f => !/^supabase-migration-v\d+(\.\d+){1,3}\.sql$/.test(f))
  assert.deepEqual(bad, [], `unexpected files in supabase/migrations/: ${bad.join(', ')}`)
})
