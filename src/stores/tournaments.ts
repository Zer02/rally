// src/stores/tournaments.ts — v0.0.3.3
//
// A "tournament" is now a season: created empty, played out over weekly
// rounds. Each week is an explicit admin action (start_tournament_week)
// with a chosen list of attendees — pairings are generated only for that
// week's group, and wins/losses/points accumulate across the whole season.
// Ladder-style challenges (create_challenge / reported via the same
// report_tournament_match RPC) let a player climb via bonus_points without
// touching the real win/loss record.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import { useAuth } from '@/composables/useAuth'
import type { Tournament, TournamentParticipant, TournamentMatch, TournamentWeek } from '@/types'

const PARTICIPANT_SELECT = '*, profile:profiles(id, username, display_name, unit, avatar_url)'
const MATCH_SELECT = `
  *,
  player_a:profiles!tournament_matches_player_a_id_fkey(id, username, display_name, avatar_url),
  player_b:profiles!tournament_matches_player_b_id_fkey(id, username, display_name, avatar_url),
  player_a2:profiles!tournament_matches_player_a2_id_fkey(id, username, display_name, avatar_url),
  player_b2:profiles!tournament_matches_player_b2_id_fkey(id, username, display_name, avatar_url)
`

export const useTournamentsStore = defineStore('tournaments', () => {
  const active       = ref<Tournament | null>(null)
  const participants  = ref<TournamentParticipant[]>([])
  const matches        = ref<TournamentMatch[]>([])
  const weeks          = ref<TournamentWeek[]>([])
  const pastSeasons    = ref<Tournament[]>([])
  const loading       = ref(false)
  const error         = ref<string | null>(null)

  // Live, unadjusted standings — sorted by wins, then total games won
  // (points_for). Differential deliberately isn't part of this: with
  // short first-to-4 no-ad sets, a 4-3 loss and a 4-0 loss should count
  // the same for tiebreak purposes — total games won rewards playing
  // close matches instead of rewarding blowouts. Same ordering
  // create_challenge() uses server-side to decide who's ranked above
  // whom, so it doubles as the "can I challenge them" reference order.
  // bonus_points is shown alongside but doesn't affect this sort — it
  // only shows up in the final adjusted_score once the season is
  // finalized.
  const standings = computed(() =>
    [...participants.value].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.points_for - a.points_for
    })
  )

  // profile_id -> 1-based rank, matching the standings order above.
  const rankByProfileId = computed(() => {
    const map = new Map<string, number>()
    standings.value.forEach((p, i) => map.set(p.profile_id, i + 1))
    return map
  })

  const currentWeek = computed(() =>
    weeks.value.length ? weeks.value[weeks.value.length - 1] : null
  )

  const pendingMatches    = computed(() => matches.value.filter(m => m.status === 'pending'))
  const inProgressMatches = computed(() => matches.value.filter(m => m.status === 'in_progress'))
  const completedMatches  = computed(() => matches.value.filter(m => m.status === 'completed'))

  // court number -> the match currently on it, for a simple courtside board.
  const courtsInUse = computed(() => {
    const map = new Map<number, TournamentMatch>()
    inProgressMatches.value.forEach(m => { if (m.court) map.set(m.court, m) })
    return map
  })

  const currentWeekMatches = computed(() =>
    currentWeek.value ? matches.value.filter(m => m.week_id === currentWeek.value!.id) : []
  )

  // Whether the signed-in user has already used their one challenge for
  // the current week. UI-side convenience only — create_challenge()
  // enforces this for real server-side.
  const myChallengeUsedThisWeek = computed(() => {
    const { user } = useAuth()
    if (!user.value || !currentWeek.value) return false
    return matches.value.some(m =>
      m.phase === 'challenge' &&
      m.week_id === currentWeek.value!.id &&
      m.challenger_id === user.value!.id
    )
  })

  function canChallenge(profileId: string): boolean {
    const { user } = useAuth()
    if (!user.value || myChallengeUsedThisWeek.value) return false
    if (profileId === user.value.id) return false
    const myRank    = rankByProfileId.value.get(user.value.id)
    const theirRank = rankByProfileId.value.get(profileId)
    if (!myRank || !theirRank) return false
    return theirRank < myRank
  }

  async function fetchActive() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { active.value = null; participants.value = []; matches.value = []; weeks.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('tournaments')
      .select('*')
      .eq('league_id', leagueId)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (err) {
      error.value = err.message
      loading.value = false
      return
    }

    active.value = data as Tournament | null
    if (active.value) {
      await Promise.all([fetchParticipants(), fetchMatches(), fetchWeeks()])
    } else {
      participants.value = []
      matches.value = []
      weeks.value = []
    }
    loading.value = false
  }

  async function fetchParticipants() {
    if (!active.value) return
    const { data, error: err } = await supabase
      .from('tournament_participants')
      .select(PARTICIPANT_SELECT)
      .eq('tournament_id', active.value.id)

    if (!err) participants.value = (data ?? []) as TournamentParticipant[]
  }

  async function fetchMatches() {
    if (!active.value) return
    const { data, error: err } = await supabase
      .from('tournament_matches')
      .select(MATCH_SELECT)
      .eq('tournament_id', active.value.id)
      .order('created_at', { ascending: true })

    if (!err) matches.value = (data ?? []) as TournamentMatch[]
  }

  async function fetchWeeks() {
    if (!active.value) return
    const { data, error: err } = await supabase
      .from('tournament_weeks')
      .select('*')
      .eq('tournament_id', active.value.id)
      .order('week_number', { ascending: true })

    if (!err) weeks.value = (data ?? []) as TournamentWeek[]
  }

  // Finalizing a season doesn't delete anything — it just gets excluded
  // from fetchActive()'s query. This is what makes a finalized season
  // browsable again instead of looking like it vanished.
  async function fetchPastSeasons() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { pastSeasons.value = []; return }

    const { data, error: err } = await supabase
      .from('tournaments')
      .select('*')
      .eq('league_id', leagueId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })

    if (!err) pastSeasons.value = (data ?? []) as Tournament[]
  }

  // Final standings for one past season. Returned directly rather than
  // stored on the state, since more than one season card can be expanded
  // at once — each panel keeps its own local copy.
  async function fetchSeasonStandings(tournamentId: string): Promise<TournamentParticipant[]> {
    const { data, error: err } = await supabase
      .from('tournament_participants')
      .select(PARTICIPANT_SELECT)
      .eq('tournament_id', tournamentId)
      .order('seed', { ascending: true, nullsFirst: false })

    if (err) throw new Error(err.message)
    return (data ?? []) as TournamentParticipant[]
  }

  async function createTournament(name: string) {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')

    const { data, error: err } = await supabase.rpc('create_tournament', {
      p_league_id: leagueId,
      p_name: name,
    })
    if (err) throw new Error(err.message)

    await fetchActive()
    return data as string
  }

  // Admin-only. Starts the next week of the active season with the given
  // attendees (profile ids), targeting `targetMatches` matches per
  // attendee (~4-6 fits a 2-hour session — the RPC pairs people by
  // closeness in season points + rr_rating, avoiding season rematches
  // until someone's played everyone else present that week).
  async function startWeek(attendeeIds: string[], targetMatches = 5) {
    if (!active.value) throw new Error('No active season')

    const { data, error: err } = await supabase.rpc('start_tournament_week', {
      p_tournament_id: active.value.id,
      p_attendee_ids: attendeeIds,
      p_target_matches: targetMatches,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchParticipants(), fetchMatches(), fetchWeeks()])
    return data as string
  }

  // Issues a challenge against a player currently ranked above the caller.
  // Server-side RPC re-validates rank and the once-per-week cap regardless
  // of what canChallenge() says client-side.
  async function createChallenge(challengedId: string) {
    if (!active.value) throw new Error('No active season')

    const { data, error: err } = await supabase.rpc('create_challenge', {
      p_tournament_id: active.value.id,
      p_challenged_id: challengedId,
    })
    if (err) throw new Error(err.message)

    await fetchMatches()
    return data as string
  }

  // Reports a score for either a round-robin match or a challenge — the
  // RPC branches on the match's phase. Challenge wins add to bonus_points
  // only; round-robin wins update wins/losses/points_for/points_against.
  async function reportMatch(matchId: string, scoreA: number, scoreB: number) {
    const { error: err } = await supabase.rpc('report_tournament_match', {
      p_match_id: matchId,
      p_score_a:  scoreA,
      p_score_b:  scoreB,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchParticipants(), fetchMatches()])
  }

  // Admin-only. Ends the season: assigns final seeds by wins, then total
  // games won (points_for) plus bonus_points as a flat top-up — no
  // differential or opponent-strength weighting, same ordering as the
  // live standings. Also writes career round-robin stats onto each
  // participant's players row, and locks the tournament.
  async function finalizeTournament() {
    if (!active.value) throw new Error('No active season')

    const { error: err } = await supabase.rpc('finalize_tournament', {
      p_tournament_id: active.value.id,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchActive(), fetchPastSeasons()])
  }

  // Admin-only. Calls a pending match to a court, whenever that court frees
  // up — there's no auto-scheduler, this is purely "who's next, which court
  // just opened."
  async function callToCourt(matchId: string, court: number) {
    const { error: err } = await supabase.rpc('call_match_to_court', {
      p_match_id: matchId,
      p_court: court,
    })
    if (err) throw new Error(err.message)
    await fetchMatches()
  }

  // Admin-only. Reverts a mis-called match back to the pending queue.
  async function uncallMatch(matchId: string) {
    const { error: err } = await supabase.rpc('uncall_match', { p_match_id: matchId })
    if (err) throw new Error(err.message)
    await fetchMatches()
  }

  // Admin-only. Manually creates one match for the current week — for
  // whenever the smart pairing missed a matchup the admin wants, or a
  // rematch is wanted on purpose. Attaches to the most recently started
  // week; auto-enrolls either player if they're not already in the season.
  // Pass partner ids for a doubles match, or leave them off for singles.
  async function addMatch(
    playerAId: string, playerBId: string,
    playerA2Id?: string, playerB2Id?: string
  ) {
    if (!active.value) throw new Error('No active season')

    const { data, error: err } = await supabase.rpc('add_tournament_match', {
      p_tournament_id: active.value.id,
      p_player_a_id: playerAId,
      p_player_b_id: playerBId,
      p_player_a2_id: playerA2Id ?? null,
      p_player_b2_id: playerB2Id ?? null,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchParticipants(), fetchMatches()])
    return data as string
  }

  // Admin-only. Given who showed up and how many courts are free, works
  // out the best mix of singles/doubles to fill them (maximizing players
  // playing, then courts used), groups people by current blended
  // strength, and balances each doubles foursome as strongest+weakest vs
  // the middle two. Attaches to the current week without creating a new
  // one — safe to call repeatedly for "next round" within one session.
  // Doesn't check for season rematches (unlike startWeek) — this is a
  // quick best-matches-right-now snapshot, not a fairness rotation.
  async function generateCourtMatches(attendeeIds: string[], courtCount: number) {
    if (!active.value) throw new Error('No active season')

    const { data, error: err } = await supabase.rpc('generate_court_matches', {
      p_tournament_id: active.value.id,
      p_attendee_ids: attendeeIds,
      p_court_count: courtCount,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchParticipants(), fetchMatches()])
    return data as {
      week_id: string
      doubles_count: number
      singles_count: number
      match_ids: string[]
      benched_profile_ids: string[]
    }
  }

  // Admin-only. Deletes a match that's lingering and won't be played —
  // only allowed while it's still pending/in_progress, since a completed
  // match is a real result. Nothing to re-fetch besides matches: a
  // pending/in_progress match never touched wins/losses/points/rr_rating.
  async function cancelMatch(matchId: string) {
    const { error: err } = await supabase.rpc('cancel_tournament_match', { p_match_id: matchId })
    if (err) throw new Error(err.message)
    await fetchMatches()
  }

  // A player's own past-season results (for the Profile page's Round
  // Robin section) — final seed/record for every completed season in
  // this league they were part of, newest first.
  async function fetchProfileRoundRobinHistory(profileId: string) {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) return []

    const { data, error: err } = await supabase
      .from('tournament_participants')
      .select(`
        wins, losses, seed, adjusted_score,
        tournament:tournaments!inner(id, name, completed_at, league_id, status)
      `)
      .eq('profile_id', profileId)
      .eq('tournament.league_id', leagueId)
      .eq('tournament.status', 'completed')

    if (err) throw new Error(err.message)

    type Row = { wins: number; losses: number; seed: number | null; adjusted_score: number | null; tournament: Tournament }
    return ((data ?? []) as unknown as Row[]).sort(
      (a, b) => new Date(b.tournament.completed_at ?? 0).getTime() - new Date(a.tournament.completed_at ?? 0).getTime()
    )
  }

  return {
    active, participants, matches, weeks, pastSeasons, loading, error,
    standings, rankByProfileId, currentWeek, currentWeekMatches,
    pendingMatches, inProgressMatches, completedMatches, courtsInUse,
    myChallengeUsedThisWeek, canChallenge,
    fetchActive, fetchParticipants, fetchMatches, fetchWeeks,
    fetchPastSeasons, fetchSeasonStandings, fetchProfileRoundRobinHistory,
    createTournament, startWeek, createChallenge, reportMatch, finalizeTournament,
    callToCourt, uncallMatch, addMatch, cancelMatch, generateCourtMatches,
  }
})
