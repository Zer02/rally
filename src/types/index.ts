// src/types/index.ts

export interface Profile {
  id:           string
  username:     string
  display_name: string | null
  unit:         string | null   // apartment/unit number
  avatar_url:   string | null
  created_at:   string
}

export interface Player {
  id:            string
  profile_id:    string
  rating:        number
  uncertainty:   number
  streak:        number          // positive = win streak, negative = loss streak
  season_wins:   number
  season_losses: number
  career_wins:   number
  career_losses: number
  last_played:   string | null
  // joined
  profile?: Profile
}

export interface Match {
  id:               string
  challenger_id:    string
  opponent_id:      string
  winner_id:        string | null
  challenger_score: string | null   // e.g. "11,8,11"
  opponent_score:   string | null
  status:           'pending' | 'accepted' | 'completed' | 'declined' | 'disputed'
  quality:          number | null
  challenger_delta: number | null
  opponent_delta:   number | null
  created_at:       string
  completed_at:     string | null
  // joined
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

// Supabase DB shape (minimal — expand as needed)
export interface Database {
  public: {
    Tables: {
      profiles:    { Row: Profile;    Insert: Omit<Profile, 'created_at'>;    Update: Partial<Profile> }
      players:     { Row: Player;     Insert: Omit<Player, 'id'>;             Update: Partial<Player> }
      matches:     { Row: Match;      Insert: Omit<Match, 'id' | 'created_at'>; Update: Partial<Match> }
      elo_history: { Row: EloHistory; Insert: Omit<EloHistory, 'id' | 'recorded_at'>; Update: Partial<EloHistory> }
    }
  }
}
