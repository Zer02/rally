// src/stores/tournaments.ts — v0.0.3.2
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import type { Tournament, TournamentParticipant, TournamentMatch } from '@/types'

const PARTICIPANT_SELECT = '*, profile:profiles(id, username, display_name, unit, avatar_url)'
const MATCH_SELECT = `
  *,
  player_a:profiles!tournament_matches_player_a_id_fkey(id, username, display_name, avatar_url),
  player_b:profiles!tournament_matches_player_b_id_fkey(id, username, display_name, avatar_url)
`

export const useTournamentsStore = defineStore('tournaments', () => {
  const active       = ref<Tournament | null>(null)
  const participants  = ref<TournamentParticipant[]>([])
  const matches        = ref<TournamentMatch[]>([])
  const loading       = ref(false)
  const error         = ref<string | null>(null)

  // Live, unadjusted standings — sorted by wins, then point differential.
  // The strength-of-schedule adjusted_score only gets computed once the
  // whole round robin is finalized (next version), so this is a
  // provisional view while matches are still being played.
  const standings = computed(() =>
    [...participants.value].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      const diffA = a.points_for - a.points_against
      const diffB = b.points_for - b.points_against
      return diffB - diffA
    })
  )

  const pendingMatches   = computed(() => matches.value.filter(m => m.status === 'pending'))
  const completedMatches = computed(() => matches.value.filter(m => m.status === 'completed'))

  async function fetchActive() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { active.value = null; participants.value = []; matches.value = []; return }

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
      await Promise.all([fetchParticipants(), fetchMatches()])
    } else {
      participants.value = []
      matches.value = []
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

  async function reportMatch(matchId: string, scoreA: number, scoreB: number) {
    const { error: err } = await supabase.rpc('report_tournament_match', {
      p_match_id: matchId,
      p_score_a:  scoreA,
      p_score_b:  scoreB,
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchParticipants(), fetchMatches()])
  }

  return {
    active, participants, matches, loading, error,
    standings, pendingMatches, completedMatches,
    fetchActive, fetchParticipants, fetchMatches, createTournament, reportMatch,
  }
})
