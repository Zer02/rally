// src/types/index.ts — v0.0.6.2

export interface Profile {
  id:           string
  username:     string
  display_name: string | null
  avatar_url:   string | null
  is_admin:     boolean
  is_placeholder?: boolean
  invited_email?:  string | null
  invited_at?:     string | null
  created_at:   string
}

// v0.0.5.9 — Player accounts panel. The server decides the status and
// hands back only a MASKED email (j***@g***.com); the full address never
// reaches the browser.
export type AccountStatus = 'name_only' | 'invited' | 'unconfirmed' | 'active' | 'unknown'

export interface AccountInfo {
  profile_id:      string
  status:          AccountStatus
  masked_email:    string | null
  last_sign_in_at: string | null
  is_admin:        boolean
}

export interface AccountLogEntry {
  id:          string
  created_at:  string
  actor_id:    string | null
  actor_name:  string | null
  target_id:   string | null
  target_name: string | null
  action:      'send_reset' | 'change_email'
  detail: {
    email_masked?:     string | null
    old_email_masked?: string | null
    new_email_masked?: string | null
    reset_sent?:       boolean
  }
}

export interface Player {
  id:                string
  profile_id:        string
  rating:            number
  uncertainty:       number
  streak:            number
  season_wins:       number
  season_losses:     number
  career_wins:       number
  career_losses:     number
  last_played:       string | null
  rr_titles:         number
  rr_best_finish:    number | null
  rr_seasons_played: number
  xp?: number              // battle-pass XP (v0.0.5.0); absent before the migration runs
  profile?: Profile
  xp: number        // lifetime XP, never resets
  pass_xp: number   // XP earned this round robin season (the pass)
}

export interface Match {
  id:               string
  challenger_id:    string
  opponent_id:      string
  winner_id:        string | null
  challenger_score: string | null
  opponent_score:   string | null
  challenger_reported_winner: string | null
  challenger_reported_score:  string | null
  opponent_reported_winner:   string | null
  opponent_reported_score:    string | null
  status:           'pending' | 'accepted' | 'completed' | 'declined' | 'disputed'
  quality:          number | null
  challenger_delta: number | null
  opponent_delta:   number | null
  created_at:       string
  completed_at:     string | null
  challenger?: Profile
  opponent?:   Profile
  winner?:     Profile | null
}

export interface EloHistory {
  id:          string
  profile_id:  string
  rating:      number
  match_id:    string | null
  recorded_at: string
}

export interface Season {
  id:            string
  season_number: number
  started_at:    string
  ended_at:      string | null
}

export interface SeasonRecord {
  id:         string
  season_id:  string
  profile_id: string
  wins:       number
  losses:     number
  created_at: string
}

export interface Tournament {
  id:           string
  league_id:    string
  name:         string
  status:       'round_robin' | 'bracket' | 'completed'
  created_at:   string
  completed_at: string | null
}

export interface TournamentParticipant {
  id:             string
  tournament_id:  string
  profile_id:     string
  wins:           number
  losses:         number
  points_for:     number
  points_against: number
  bonus_points:   number
  rr_points:      number   // v0.0.6.2: match points (4 per win; a loss earns 0–3 by how close it was)
  rr_rating:      number
  adjusted_score: number | null
  seed:           number | null
  profile?: Profile
}

export interface TournamentWeek {
  id:            string
  tournament_id: string
  week_number:   number
  label:         string | null
  created_at:    string
  created_by:    string | null
}

export interface TournamentMatch {
  id:            string
  tournament_id: string
  phase:         'round_robin' | 'bracket' | 'challenge'
  format:        'singles' | 'doubles'
  round:         number | null
  slot:          number | null
  week_id:       string | null
  challenger_id: string | null
  player_a_id:   string | null
  player_b_id:   string | null
  player_a2_id:  string | null
  player_b2_id:  string | null
  score_a:       number | null
  score_b:       number | null
  winner_id:     string | null
  status:        'pending' | 'in_progress' | 'completed' | 'bye'
  court:         number | null
  started_at:    string | null
  reported_by:   string | null
  created_at:    string
  completed_at:  string | null
  player_a?: Profile
  player_b?: Profile
  player_a2?: Profile
  player_b2?: Profile
}

export interface QuestTemplate {
  id:            string
  key:           string
  cadence:       'weekly' | 'monthly' | 'seasonal'
  title:         string
  description:   string
  criteria_type: string
  target_count:  number
  xp_reward:     number
  active:        boolean
}

export interface PlayerQuestProgress {
  id:                string
  league_id:         string
  profile_id:        string
  quest_template_id: string
  period_start:      string
  period_end:        string
  progress_count:    number
  completed_at:      string | null
  xp_awarded:        number
}

export interface Database {
  public: {
    Tables: {
      profiles:       { Row: Profile;      Insert: Omit<Profile, 'created_at'>;             Update: Partial<Profile> }
      players:        { Row: Player;       Insert: Omit<Player, 'id'>;                       Update: Partial<Player> }
      matches:        { Row: Match;        Insert: Omit<Match, 'id' | 'created_at'>;         Update: Partial<Match> }
      elo_history:    { Row: EloHistory;   Insert: Omit<EloHistory, 'id' | 'recorded_at'>;   Update: Partial<EloHistory> }
      seasons:        { Row: Season;             Insert: Omit<Season, 'id' | 'started_at'>;             Update: Partial<Season> }
      season_records: { Row: SeasonRecord;       Insert: Omit<SeasonRecord, 'id' | 'created_at'>;       Update: Partial<SeasonRecord> }
      tournaments:              { Row: Tournament;            Insert: Omit<Tournament, 'id' | 'created_at'>;            Update: Partial<Tournament> }
      tournament_participants:  { Row: TournamentParticipant; Insert: Omit<TournamentParticipant, 'id'>;                Update: Partial<TournamentParticipant> }
      tournament_weeks:         { Row: TournamentWeek;        Insert: Omit<TournamentWeek, 'id' | 'created_at'>;        Update: Partial<TournamentWeek> }
      tournament_matches:       { Row: TournamentMatch;       Insert: Omit<TournamentMatch, 'id' | 'created_at'>;       Update: Partial<TournamentMatch> }
    }
  }
}

// v0.0.8.5 — knockout tournaments (bracket_events / bracket_entrants / bracket_matches).
// Separate from Tournament above, which is a round robin SEASON.
export interface BracketEvent {
  id:           string
  league_id:    string
  name:         string
  seeding:      'ladder' | 'round_robin'
  bracket_size: number
  status:       'in_progress' | 'completed'
  champion_id:  string | null
  created_by:   string | null
  created_at:   string
  completed_at: string | null
}

export interface BracketEntrant {
  event_id:   string
  profile_id: string
  seed:       number
  profile?:   Profile
}

export interface BracketMatch {
  id:           string
  event_id:     string
  round:        number          // 1 = first round
  slot:         number          // 1-based position within the round
  player_a_id:  string | null
  player_b_id:  string | null
  score_a:      number | null
  score_b:      number | null
  winner_id:    string | null
  status:       'pending' | 'completed' | 'bye'
  completed_at: string | null
}

/** One row of the draw as preview_bracket_seeds returns it. */
export interface SeedPreviewRow {
  seed:         number
  profile_id:   string
  rating:       number | null   // the rating the seeding used; null = no round robin history
  bracket_size: number
  has_bye:      boolean
}
