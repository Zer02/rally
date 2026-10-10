// Thin wrapper around the `psql` command line, so the database tests need nothing
// installed beyond Postgres itself. Connection settings come from the standard
// PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); the account
// needs to be able to create and drop databases.
import { spawnSync } from 'node:child_process'

export function haveDatabase() {
  const r = spawnSync('psql', ['-X', '-Atc', 'select 1', '-d', process.env.PGDATABASE || 'postgres'], { encoding: 'utf8' })
  return r.status === 0 && r.stdout.trim() === '1'
}

/** Run SQL (text) or a file in `db`. Throws on any SQL error. Returns { out, notices }. */
export function psql(db, { sql, file }) {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db]
  if (file) args.push('-f', file)
  const r = spawnSync('psql', args, { encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024 })
  const notices = (r.stderr || '').split('\n').filter(l => l.includes('NOTICE:')).map(l => l.replace(/^.*NOTICE:\s*/, ''))
  if (r.status !== 0) {
    const err = new Error(`psql failed (${file ?? 'inline sql'}):\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`)
    err.stderr = r.stderr
    throw err
  }
  return { out: r.stdout.trim(), notices }
}

/** Rows as arrays of strings (columns split on '|'). */
export function rows(db, sql) {
  const { out } = psql(db, { sql })
  return out === '' ? [] : out.split('\n').map(l => l.split('|'))
}
export const scalar = (db, sql) => rows(db, sql)[0]?.[0]

export function createDb(name) { dropDb(name); psql('postgres', { sql: `create database "${name}"` }) }
export function dropDb(name) { psql('postgres', { sql: `drop database if exists "${name}" with (force)` }) }
export function cloneDb(from, to) { dropDb(to); psql('postgres', { sql: `create database "${to}" template "${from}"` }) }
