// Runs the test suites.   node tests/run.mjs [js] [db] [browser]   (no arguments = js + db)
// Lists the test files itself so it works the same on every Node version and OS.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { haveDatabase } from './lib/pg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const wanted = process.argv.slice(2)
const suites = wanted.length ? wanted : ['js', 'db']
let failed = false

// The database tests skip themselves when there is no Postgres, and a skip prints
// as "ok". Say so loudly and fail, so nobody reads a green run as "the migrations
// were checked" when they were not.
if (suites.includes('db') && !haveDatabase()) {
  console.error('\n!!! The database tests did NOT run: no Postgres reachable.')
  console.error('!!! Set PGHOST / PGUSER (and PGPASSWORD) for an account that can create databases — see tests/README.md.')
  console.error('!!! To run only the quick checks:  npm run test:js\n')
  failed = true
}

for (const suite of suites) {
  console.log(`\n━━ ${suite} ━━`)
  let r
  if (suite === 'js' || suite === 'db') {
    const files = readdirSync(join(here, suite)).filter(f => f.endsWith('.test.mjs')).map(f => join(here, suite, f))
    // db files share one Postgres server but use their own scratch databases, so run them one after another
    r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' })
  } else if (suite === 'browser') {
    r = spawnSync(process.execPath, [join(here, 'browser', 'run.mjs')], { stdio: 'inherit' })
  } else { console.error(`unknown suite "${suite}" (js, db, browser)`); process.exit(2) }
  if (r.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
