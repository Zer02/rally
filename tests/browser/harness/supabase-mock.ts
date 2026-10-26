// Stands in for src/lib/supabase.ts during the browser tests, so the real app
// runs against fixtures.ts with no network. Filters are mostly ignored: it
// returns every row of the table, which is plenty for checking layout.
// Test switches (set in localStorage by the test): 'anon' = signed out,
// 'noladder' = no ladder matches, 'pending' = one unreported round robin match,
// 'streak' = two more recent wins for the signed-in user, 'nonmember' = signed in as a new account that
// has not joined a league, 'ghost' = an accepted ladder challenge against someone who has not joined, 'crowd' = 24 more players in the league, 'above' / 'farabove' = a player rated 70 / 150 above the signed-in user.
// RPC calls are recorded on window.__rpc, inserts on window.__inserts, updates on window.__updates.
// Inserting a players row (joining a league) really adds it, so the page can move on afterwards.
import { TABLES, USER, PENDING, STREAK_WINS, NEWCOMER, NEWCOMER_PROFILE, GHOST_MATCH, CROWD_PROFILES, CROWD_PLAYERS, ABOVE, FARABOVE, ELO_HOME } from './fixtures'
const flag = (k: string) => localStorage.getItem(k) === '1'
function builder(table: string) {
  let rows = (table === 'matches' && flag('noladder') ? [] : TABLES[table] ?? []).slice()
  if (table === 'tournament_matches' && flag('pending')) rows.push(PENDING)
  if (table === 'tournament_matches' && flag('streak')) rows.push(...STREAK_WINS)
  if (table === 'profiles' && flag('nonmember')) rows.push(NEWCOMER_PROFILE)
  if (table === 'matches' && flag('ghost')) rows.push(GHOST_MATCH)
  if (table === 'players' && flag('crowd')) rows.push(...CROWD_PLAYERS)
  if (table === 'players' && flag('above')) rows.push(ABOVE.pl)
  if (table === 'elo_history' && flag('elo')) rows = [...ELO_HOME]
  // 'byeweek' = the newest week also has a bye (a player with no opponent), which is not a match
  if (table === 'tournament_matches' && flag('byeweek')) rows.push({ id: 'tmBye', tournament_id: TABLES.tournaments[0].id, phase: 'round_robin', round: 3, slot: 9, week_id: 'w2',
    player_a_id: TABLES.players[5].profile_id, player_b_id: null, player_a2_id: null, player_b2_id: null, format: 'singles', score_a: null, score_b: null,
    winner_id: null, status: 'bye', reported_by: null, completed_at: null, created_at: new Date().toISOString(), player_a: null, player_b: null, player_a2: null, player_b2: null })
  // 'pingpong' = the league plays a table sport; 'noleague' = the site has no leagues yet
  if (table === 'leagues' && flag('pingpong')) rows = rows.map((r: any) => ({ ...r, sport: 'pingpong' }))
  if (table === 'leagues' && flag('noleague')) rows = []
  // 'twoleagues' = the site has a second league (a ping pong one) to switch to
  if (table === 'leagues' && flag('twoleagues')) rows = [...rows, { id: '00000000-0000-0000-0000-0000000000a9', name: 'Building 2 Ping Pong', sport: 'pingpong', icon: '🏓', court_count: 1, created_at: new Date().toISOString() }]
  if (table === 'players' && flag('farabove')) rows.push(FARABOVE.pl)
  if (table === 'profiles' && flag('above')) rows.push(ABOVE.pr)
  if (table === 'profiles' && flag('farabove')) rows.push(FARABOVE.pr)
  // pass XP (this season) is deliberately not the lifetime XP, so a screen showing the wrong one is caught
  // 'notadmin' = the signed-in user is an ordinary player (not a global admin)
  if (table === 'profiles' && flag('notadmin')) rows = rows.map((r: any) => ({ ...r, is_admin: false }))
  if (table === 'players') rows = rows.map((r: any) => ({ pass_xp: Math.floor((r.xp ?? 0) * 0.4), ...r }))
  if (table === 'profiles' && flag('crowd')) rows.push(...CROWD_PROFILES)
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
      if (prop === 'eq' && table.startsWith('bracket_') && (a[0] === 'event_id' || a[0] === 'league_id')) rows = rows.filter(r => r[a[0]] === a[1])
      if (prop === 'eq' && a[0] === 'week_id' && table === 'tournament_matches') rows = rows.filter(r => r.week_id === a[1])
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
    // preview_bracket_seeds: rank the chosen players by ladder rating, like the database does for 'ladder'
    if (name === 'preview_bracket_seeds') {
      const chosen = TABLES.players.filter((p: any) => args.p_profile_ids.includes(p.profile_id)).sort((x: any, y: any) => y.rating - x.rating)
      let size = 2; while (size < chosen.length) size *= 2
      return Promise.resolve({ data: chosen.map((p: any, i: number) => ({ seed: i + 1, profile_id: p.profile_id, rating: p.rating, bracket_size: size, has_bye: i + 1 <= size - chosen.length })), error: null })
    }
    if (name === 'create_bracket_event') return Promise.resolve({ data: 'bk1', error: null })
    if (name === 'report_bracket_match' && flag('bracketerr')) return Promise.resolve({ data: null, error: { message: 'That result cannot be changed: the winner has already played the next round.' } })
    return Promise.resolve({ data: name === 'remove_tournament_match' ? { summary: 'test match', recalculated: 1, phase: 'round_robin' } : null, error: null })
  },
  channel: () => chan, removeChannel: () => {}, functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  auth: {
    getSession: () => Promise.resolve({ data: { session: flag('anon') ? null : { user: flag('nonmember') ? NEWCOMER : USER } } }),
    getUser: () => Promise.resolve({ data: { user: flag('anon') ? null : flag('nonmember') ? NEWCOMER : USER } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => Promise.resolve({}),
  },
}
