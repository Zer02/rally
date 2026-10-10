// Fake league data for the browser tests. Names are deliberately long, and the
// profiles still carry a `unit` (the database column was left in place) so the
// tests can prove the app no longer shows it.
const L = '00000000-0000-0000-0000-0000000000aa', T = '00000000-0000-0000-0000-0000000000bb'
const names = ['Alexandra Rivera-Montgomery', 'Bartholomew Nakamura', 'Cat', 'Dmitri Volkov-Santos', 'Eloise Fairweather', 'Finn']
export const ids = names.map((_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`)
const profiles = names.map((n, i) => ({ id: ids[i], username: n.split(' ')[0].toLowerCase(), display_name: n, unit: ['4B', '12A', '', '7C', '3D', '9F'][i], avatar_url: null, is_admin: i === 0, is_placeholder: false, invited_email: null, invited_at: null }))
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString()
const league = { id: L, name: 'Riverside Tennis Club', sport: 'tennis', icon: null, court_count: 2, created_at: day(90) }
const players = names.map((_, i) => ({
  id: 'pl' + i, profile_id: ids[i], league_id: L, rating: 1180 - i * 60, uncertainty: 120, streak: (i % 3) - 1, season_wins: 7 - i, season_losses: i + 2,
  career_wins: 30 - i * 3, career_losses: 12 + i, last_played: day(i), rr_titles: i === 0 ? 2 : 0, rr_best_finish: i + 1, rr_seasons_played: 3, xp: 1450 - i * 180,
  profile: profiles[i], league }))
const ladder = Array.from({ length: 6 }, (_, k) => {
  const a = k % 3, b = 3 + (k % 3), win = k % 2 === 0
  return { id: 'm' + k, league_id: L, challenger_id: ids[a], opponent_id: ids[b], winner_id: win ? ids[a] : ids[b],
    challenger_score: win ? '11,9,11' : '8,11,6,11', opponent_score: win ? '7,11,5' : '11,7,11,5', status: 'completed', quality: 0.7,
    challenger_delta: win ? 14 : -11, opponent_delta: win ? -14 : 11, created_at: day(k + 1), completed_at: day(k + 1),
    challenger: profiles[a], opponent: profiles[b], winner: profiles[win ? a : b] }
})
const tournaments = [
  { id: T, league_id: L, name: 'Autumn Season 2026', status: 'round_robin', format: 'singles', created_at: day(20), completed_at: null, created_by: ids[0] },
  { id: 'tp1', league_id: L, name: 'Summer Season 2026 (Doubles Edition)', status: 'completed', format: 'singles', created_at: day(120), completed_at: day(60), created_by: ids[0] },
]
const parts = (tid: string) => names.map((_, i) => ({ id: tid + 'p' + i, tournament_id: tid, profile_id: ids[i], wins: 5 - i, losses: i, points_for: 40 - i * 4, points_against: 20 + i * 3,
  adjusted_score: 41.5 - i * 3, seed: i + 1, bonus_points: i === 0 ? 1 : 0, rr_points: 22 - i * 3, rr_rating: 1100 - i * 25, profile: profiles[i], tournament: tournaments.find(t => t.id === tid) }))
const weeks = [{ id: 'w1', tournament_id: T, week_number: 1, label: null, created_at: day(14), created_by: ids[0] }, { id: 'w2', tournament_id: T, week_number: 2, label: null, created_at: day(7), created_by: ids[0] }]
const tm = Array.from({ length: 6 }, (_, k) => {
  const b = 1 + (k % 5), win = k % 2 === 0
  const sa = win ? 6 : k % 4, sb = win ? k % 4 : 6
  return { id: 'tm' + k, tournament_id: T, phase: k === 5 ? 'challenge' : 'round_robin', round: 1, slot: k, week_id: k < 3 ? 'w1' : 'w2',
    player_a_id: ids[0], player_b_id: ids[b], player_a2_id: k === 1 ? ids[2] : null, player_b2_id: k === 1 ? ids[3] : null, format: k === 1 ? 'doubles' : 'singles',
    score_a: sa, score_b: sb, winner_id: win ? ids[0] : ids[b], status: 'completed', reported_by: ids[0], completed_at: day(k + 1), created_at: day(k + 2),
    player_a: profiles[0], player_b: profiles[b], player_a2: k === 1 ? profiles[2] : null, player_b2: k === 1 ? profiles[3] : null,
    tournament: { id: T, name: tournaments[0].name, league_id: L, status: 'round_robin' } }
})
// One match nobody has reported yet, between the signed-in user and a player with a long name. Only handed
// out when a test turns the 'pending' switch on (see supabase-mock.ts), so the other pages' counts stay put.
export const PENDING = { id: 'tmP', tournament_id: T, phase: 'round_robin', round: 2, slot: 0, week_id: 'w2',
  player_a_id: ids[0], player_b_id: ids[3], player_a2_id: null, player_b2_id: null, format: 'singles',
  score_a: null, score_b: null, winner_id: null, status: 'pending', reported_by: null, completed_at: null, created_at: day(0),
  player_a: profiles[0], player_b: profiles[3], player_a2: null, player_b2: null,
  tournament: { id: T, name: tournaments[0].name, league_id: L, status: 'round_robin' } }
const history = Array.from({ length: 12 }, (_, k) => ({ rating: 1000 + k * 12, recorded_at: day(40 - k * 3), player_id: 'pl0', profile_id: ids[0] }))
const rrHist = [T, 'tp1'].map((tid, k) => ({ tournament_id: tid, match_id: 'tm' + k, rating: 1050 + k * 20, delta: 8, recorded_at: day(k * 30), tournament: { id: tid, league_id: L, name: tournaments[k].name, status: k ? 'completed' : 'round_robin', completed_at: tournaments[k].completed_at } }))
const quests = [
  { id: 'q1', key: 'weekly_show_up', cadence: 'weekly', title: 'Show up', description: 'Play a match this week', criteria_type: 'play_matches', target_count: 1, xp_reward: 15, active: true, sort_order: 1 },
  { id: 'q2', key: 'weekly_double_header', cadence: 'weekly', title: 'Double header', description: 'Play 2 matches this week against different opponents', criteria_type: 'play_matches', target_count: 2, xp_reward: 30, active: true, sort_order: 2 },
]
export const TABLES: Record<string, any[]> = {
  profiles, players, leagues: [league], matches: ladder, tournaments, tournament_participants: [...parts(T), ...parts('tp1')], tournament_weeks: weeks,
  tournament_matches: tm, rating_history: history, rr_rating_history: rrHist, quest_templates: quests, player_quest_progress: [], player_weekly_play_xp: [{ matches_counted: 4, xp_awarded: 40 }],
  league_admins: [{ league_id: L, profile_id: ids[0] }], match_removal_log: [], seasons: [], match_games: [],
}
export const USER = { id: ids[0], email: 'alex@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: day(100) }
