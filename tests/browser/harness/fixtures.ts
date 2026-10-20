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
// Two more finished wins for the signed-in user, newer than everything else, so that with the
// 'streak' switch on they are on a three-win run (the newest regular match is also a win). Only handed
// out when a test turns that switch on, so the other pages' counts stay put.
export const STREAK_WINS = [4, 5].map((b, k) => ({ id: 'tmS' + k, tournament_id: T, phase: 'round_robin', round: 3, slot: k, week_id: 'w2',
  player_a_id: ids[0], player_b_id: ids[b], player_a2_id: null, player_b2_id: null, format: 'singles',
  score_a: 6, score_b: k + 1, winner_id: ids[0], status: 'completed', reported_by: ids[0], completed_at: day(0.5 - k * 0.25), created_at: day(0.6 - k * 0.25),
  player_a: profiles[0], player_b: profiles[b], player_a2: null, player_b2: null,
  tournament: { id: T, name: tournaments[0].name, league_id: L, status: 'round_robin' } }))
const history = Array.from({ length: 12 }, (_, k) => ({ rating: 1000 + k * 12, recorded_at: day(40 - k * 3), player_id: 'pl0', profile_id: ids[0] }))
const rrHist = [T, 'tp1'].map((tid, k) => ({ tournament_id: tid, match_id: 'tm' + k, rating: 1050 + k * 20, delta: 8, recorded_at: day(k * 30), tournament: { id: tid, league_id: L, name: tournaments[k].name, status: k ? 'completed' : 'round_robin', completed_at: tournaments[k].completed_at } }))
const quests = [
  { id: 'q1', key: 'weekly_show_up', cadence: 'weekly', title: 'Show up', description: 'Play a match this week', criteria_type: 'play_matches', target_count: 1, xp_reward: 15, active: true, sort_order: 1 },
  { id: 'q3', key: 'weekly_punch_up', cadence: 'weekly', title: 'Punch Up', description: 'Play someone rated above you - win or lose', criteria_type: 'play_higher', target_count: 1, xp_reward: 25, active: true, sort_order: 3 },
  { id: 'q4', key: 'weekly_reach', cadence: 'weekly', title: 'Reach', description: 'Play someone rated 100+ above you - win or lose', criteria_type: 'play_much_higher', target_count: 1, xp_reward: 40, active: true, sort_order: 4 },
  { id: 'q5', key: 'weekly_challenger', cadence: 'weekly', title: 'Be the Challenger', description: 'Send a challenge that gets played', criteria_type: 'send_challenge', target_count: 1, xp_reward: 20, active: true, sort_order: 5 },
  { id: 'q2', key: 'weekly_double_header', cadence: 'weekly', title: 'Double header', description: 'Play 2 matches this week against different opponents', criteria_type: 'play_matches', target_count: 2, xp_reward: 30, active: true, sort_order: 2 },
]
// Knockout tournaments (v0.0.8.5). 'bk1' is a six-player event in an eight-slot bracket (seeds 1 and 2 on byes),
// part way through; 'bk2' is a finished four-player event. Seeds follow the ladder ratings above (player 1 = seed 1).
const BK1 = 'bk1', BK2 = 'bk2'
const bkEvents = [
  { id: BK1, league_id: L, name: 'Autumn Open Championship Knockout', seeding: 'ladder', bracket_size: 8, status: 'in_progress', champion_id: null, created_by: ids[0], created_at: day(3), completed_at: null },
  { id: BK2, league_id: L, name: 'Spring Cup', seeding: 'round_robin', bracket_size: 4, status: 'completed', champion_id: ids[0], created_by: ids[0], created_at: day(80), completed_at: day(78) },
]
const bkEntrants = [
  ...ids.map((id, i) => ({ event_id: BK1, profile_id: id, seed: i + 1, profile: profiles[i] })),
  ...ids.slice(0, 4).map((id, i) => ({ event_id: BK2, profile_id: id, seed: i + 1, profile: profiles[i] })),
]
const bm = (event_id: string, round: number, slot: number, a: number | null, b: number | null, extra: any = {}) => ({
  id: `${event_id}-${round}-${slot}`, event_id, round, slot, player_a_id: a == null ? null : ids[a], player_b_id: b == null ? null : ids[b],
  score_a: null, score_b: null, winner_id: null, status: 'pending', completed_at: null, ...extra })
const bkMatches = [
  // bk1: layout 1v8, 4v5, 2v7, 3v6 -> seeds 1 and 2 have byes
  bm(BK1, 1, 1, 0, null, { status: 'bye', winner_id: ids[0], completed_at: day(3) }),
  bm(BK1, 1, 2, 3, 4, { status: 'completed', score_a: 4, score_b: 2, winner_id: ids[3], completed_at: day(2) }),
  bm(BK1, 1, 3, 1, null, { status: 'bye', winner_id: ids[1], completed_at: day(3) }),
  bm(BK1, 1, 4, 2, 5),
  bm(BK1, 2, 1, 0, 3),
  bm(BK1, 2, 2, 1, null),
  bm(BK1, 3, 1, null, null),
  // bk2: finished
  bm(BK2, 1, 1, 0, 3, { status: 'completed', score_a: 4, score_b: 1, winner_id: ids[0], completed_at: day(79) }),
  bm(BK2, 1, 2, 1, 2, { status: 'completed', score_a: 6, score_b: 3, winner_id: ids[1], completed_at: day(79) }),
  bm(BK2, 2, 1, 0, 1, { status: 'completed', score_a: 4, score_b: 3, winner_id: ids[0], completed_at: day(78) }),
]
// Rating history for the home page's "change this week" column (handed out only with the 'elo' switch).
// Worked out by hand: change = current rating minus the last rating recorded BEFORE the 7-day window.
//   player 1 (1180): 1100 (30 days ago), 1150 (10 days ago), then 1170, 1180 inside the window -> baseline 1150 -> +30
//   player 2 (1120): only entries inside the window -> baseline is the starting 1000          -> +120
//   player 3 (1060): 1090 (20 days ago)                                                        -> -30
//   player 4 (1000): none                                                                      -> 0
//   player 5 (940):  940 (9 days ago)                                                          -> 0
export const ELO_HOME = [
  { profile_id: ids[0], rating: 1100, recorded_at: day(30) }, { profile_id: ids[0], rating: 1150, recorded_at: day(10) },
  { profile_id: ids[0], rating: 1170, recorded_at: day(3) },  { profile_id: ids[0], rating: 1180, recorded_at: day(1) },
  { profile_id: ids[1], rating: 1120, recorded_at: day(2) },
  { profile_id: ids[2], rating: 1090, recorded_at: day(20) },
  { profile_id: ids[4], rating: 940,  recorded_at: day(9) },
]
export const TABLES: Record<string, any[]> = {
  bracket_events: bkEvents, bracket_entrants: bkEntrants, bracket_matches: bkMatches,
  profiles, players, leagues: [league], matches: ladder, tournaments, tournament_participants: [...parts(T), ...parts('tp1')], tournament_weeks: weeks,
  tournament_matches: tm, rating_history: history, rr_rating_history: rrHist, quest_templates: quests, player_quest_progress: [], player_weekly_play_xp: [{ matches_counted: 4, xp_awarded: 40 }],
  league_admins: [{ league_id: L, profile_id: ids[0] }], match_removal_log: [], seasons: [], match_games: [],
}
// An account that has signed up but never joined a league: a profile, and no player record.
export const NEWCOMER_PROFILE = { id: '00000000-0000-0000-0000-000000000099', username: 'nina', display_name: 'Nina Newcomer', unit: '', avatar_url: null, is_admin: false, is_placeholder: false, invited_email: null, invited_at: null }
export const NEWCOMER = { id: NEWCOMER_PROFILE.id, email: 'nina@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: day(1) }
// Someone with an account but no player record in the league, and an accepted challenge against them
// (the state a stuck match was in). Handed out only when a test turns the 'ghost' switch on.
const GHOST_PROFILE = { id: '00000000-0000-0000-0000-000000000098', username: 'gwen', display_name: 'Gwen Ghost', unit: '', avatar_url: null, is_admin: false, is_placeholder: false, invited_email: null, invited_at: null }
export const GHOST_MATCH = { id: 'mghost', league_id: L, challenger_id: ids[0], opponent_id: GHOST_PROFILE.id, status: 'accepted', winner_id: null,
  challenger_reported_winner: null, opponent_reported_winner: null, challenger_reported_score: null, opponent_reported_score: null,
  challenger_score: null, opponent_score: null, quality: null, challenger_delta: null, opponent_delta: null, created_at: day(0.2), completed_at: null,
  challenger: profiles[0], opponent: GHOST_PROFILE, winner: null }
export const USER = { id: ids[0], email: 'alex@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: day(100) }

// A big club: 24 more players, so the Challenge list is several screens tall. Only handed out when a test
// turns the 'crowd' switch on (see supabase-mock.ts).
export const CROWD_PROFILES = Array.from({ length: 24 }, (_, i) => ({ id: `00000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`, username: `crowd${i}`,
  display_name: `Crowd Player ${i + 1}`, unit: '', avatar_url: null, is_admin: false, is_placeholder: false, invited_email: null, invited_at: null }))
export const CROWD_PLAYERS = CROWD_PROFILES.map((pr, i) => ({ id: 'plc' + i, profile_id: pr.id, league_id: L, rating: 900 - i * 10, uncertainty: 150, streak: 0,
  season_wins: 1, season_losses: 1, career_wins: 3, career_losses: 3, last_played: day(i + 1), rr_titles: 0, rr_best_finish: null, rr_seasons_played: 1, xp: 100, profile: pr, league }))

// Players rated ABOVE the signed-in user (1180), for the quest screen. 'above' adds one 70 points up
// (Punch Up applies, Reach does not); 'farabove' adds one 150 up (Reach applies too).
const mkAbove = (n: number, rating: number) => {
  const pr = { id: `00000000-0000-0000-0000-0000000002${String(n).padStart(2, '0')}`, username: `above${n}`, display_name: `Above Player ${n}`, unit: '', avatar_url: null,
    is_admin: false, is_placeholder: false, invited_email: null, invited_at: null }
  return { pr, pl: { id: 'pla' + n, profile_id: pr.id, league_id: L, rating, uncertainty: 100, streak: 0, season_wins: 4, season_losses: 1, career_wins: 20, career_losses: 5,
    last_played: day(2), rr_titles: 0, rr_best_finish: null, rr_seasons_played: 1, xp: 300, profile: pr, league } }
}
export const ABOVE = mkAbove(1, 1250)
export const FARABOVE = mkAbove(2, 1330)
