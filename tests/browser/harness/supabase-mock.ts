// Stands in for src/lib/supabase.ts during the browser tests, so the real app
// runs against fixtures.ts with no network. Filters are mostly ignored: it
// returns every row of the table, which is plenty for checking layout.
// Test switches (set in localStorage by the test): 'anon' = signed out,
// 'noladder' = no ladder matches, 'pending' = one unreported round robin match.
// RPC calls are recorded on window.__rpc.
import { TABLES, USER, PENDING } from './fixtures'
const flag = (k: string) => localStorage.getItem(k) === '1'
function builder(table: string) {
  let rows = (table === 'matches' && flag('noladder') ? [] : TABLES[table] ?? []).slice()
  if (table === 'tournament_matches' && flag('pending')) rows.push(PENDING)
  const b: any = new Proxy({}, { get(_t, prop: string) {
    if (prop === 'then') return (res: any) => res({ data: rows, error: null, count: rows.length })
    if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: rows[0] ?? null, error: null })
    return (...a: any[]) => {
      if (prop === 'eq' && a[0] === 'id' && table !== 'leagues') { const f = rows.filter(r => r.id === a[1]); if (f.length) rows = f }
      if (prop === 'eq' && a[0] === 'profile_id' && table === 'players') rows = rows.filter(r => r.profile_id === a[1])
      if (prop === 'limit') rows = rows.slice(0, a[0])
      return b
    } } })
  return b
}
const chan: any = { on: () => chan, subscribe: () => chan, unsubscribe: () => {} }
export const supabase: any = {
  from: builder,
  rpc: (name: string, args: any) => {
    ((window as any).__rpc ||= []).push({ name, args })
    return Promise.resolve({ data: name === 'remove_tournament_match' ? { summary: 'test match', recalculated: 1, phase: 'round_robin' } : null, error: null })
  },
  channel: () => chan, removeChannel: () => {}, functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  auth: {
    getSession: () => Promise.resolve({ data: { session: flag('anon') ? null : { user: USER } } }),
    getUser: () => Promise.resolve({ data: { user: flag('anon') ? null : USER } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}),
  },
}
