// Stands in for src/lib/supabase.ts during the browser tests, so the real app
// runs against fixtures.ts with no network. Filters are mostly ignored: it
// returns every row of the table, which is plenty for checking layout.
// Test switches (set in localStorage by the test): 'anon' = signed out,
// 'noladder' = no ladder matches, 'pending' = one unreported round robin match,
// 'streak' = two more recent wins for the signed-in user, 'nonmember' = signed in as a new account that
// has not joined a league, 'ghost' = an accepted ladder challenge against someone who has not joined.
// RPC calls are recorded on window.__rpc, inserts on window.__inserts, updates on window.__updates.
// Inserting a players row (joining a league) really adds it, so the page can move on afterwards.
import { TABLES, USER, PENDING, STREAK_WINS, NEWCOMER, NEWCOMER_PROFILE, GHOST_MATCH } from './fixtures'
const flag = (k: string) => localStorage.getItem(k) === '1'
function builder(table: string) {
  let rows = (table === 'matches' && flag('noladder') ? [] : TABLES[table] ?? []).slice()
  if (table === 'tournament_matches' && flag('pending')) rows.push(PENDING)
  if (table === 'tournament_matches' && flag('streak')) rows.push(...STREAK_WINS)
  if (table === 'profiles' && flag('nonmember')) rows.push(NEWCOMER_PROFILE)
  if (table === 'matches' && flag('ghost')) rows.push(GHOST_MATCH)
  const b: any = new Proxy({}, { get(_t, prop: string) {
    if (prop === 'then') return (res: any) => res({ data: rows, error: null, count: rows.length })
    if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: rows[0] ?? null, error: null })
    if (prop === 'insert' || prop === 'update') return (payload: any) => {
      const log = ((window as any)['__' + prop + 's'] ||= []); log.push({ table, payload })
      if (prop === 'insert' && table === 'players') {
        TABLES.players.push({ id: 'plj' + log.length, rating: 1000, uncertainty: 200, streak: 0, season_wins: 0, season_losses: 0, career_wins: 0, career_losses: 0,
          last_played: null, rr_titles: 0, rr_best_finish: null, rr_seasons_played: 0, xp: 0, ...payload,
          profile: NEWCOMER_PROFILE, league: TABLES.leagues.find((l: any) => l.id === payload.league_id) })
      }
      return b
    }
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
    getSession: () => Promise.resolve({ data: { session: flag('anon') ? null : { user: flag('nonmember') ? NEWCOMER : USER } } }),
    getUser: () => Promise.resolve({ data: { user: flag('anon') ? null : flag('nonmember') ? NEWCOMER : USER } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}),
  },
}
