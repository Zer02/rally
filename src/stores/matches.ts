// src/stores/matches.ts — v0.0.2
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { calculateResult } from '@/lib/rating'
import type { Match } from '@/types'
import { usePlayersStore } from './players'

export const useMatchesStore = defineStore('matches', () => {
  const matches = ref<Match[]>([])
  const loading = ref(false)
  const error   = ref<string | null>(null)

  const completed = computed(() => matches.value.filter(m => m.status === 'completed'))
  const disputed  = computed(() => matches.value.filter(m => m.status === 'disputed'))
  const pending   = computed(() =>
    matches.value.filter(m => m.status === 'pending' || m.status === 'accepted')
  )

  async function fetch(limit = 40) {
    loading.value = true
    const { data, error: err } = await supabase
      .from('matches')
      .select(`
        *,
        challenger:profiles!matches_challenger_id_fkey(id, username, display_name, unit),
        opponent:profiles!matches_opponent_id_fkey(id, username, display_name, unit),
        winner:profiles!matches_winner_id_fkey(id, username, display_name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (err) { error.value = err.message }
    else { matches.value = (data ?? []) as Match[] }
    loading.value = false
  }

  async function challenge(challengerId: string, opponentId: string) {
    const { error: err } = await supabase.from('matches').insert({
      challenger_id: challengerId,
      opponent_id:   opponentId,
      status:        'pending',
    })
    if (err) throw new Error(err.message)
    await fetch()
  }

  async function respond(matchId: string, accept: boolean) {
    const { error: err } = await supabase
      .from('matches')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', matchId)
    if (err) throw new Error(err.message)
    await fetch()
  }

  // ── Two-confirmation result submission ─────────────
  // Each player submits their version independently.
  // If both match → auto-complete.
  // If they conflict → flag as 'disputed' for admin review.
  async function submitResult(
    matchId:          string,
    reporterId:       string,   // who is submitting right now
    winnerId:         string,
    loserId:          string,
    challengerScores: number[],
    opponentScores:   number[],
  ) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) throw new Error('Match not found')

    const isChallenger = reporterId === match.challenger_id
    const scoreField   = isChallenger ? 'challenger_reported_score' : 'opponent_reported_score'
    const winnerField  = isChallenger ? 'challenger_reported_winner' : 'opponent_reported_winner'

    const scoreStr = challengerScores.map((s, i) => `${s}-${opponentScores[i]}`).join(',')

    // Write this player's report
    await supabase.from('matches').update({
      [scoreField]:  scoreStr,
      [winnerField]: winnerId,
    }).eq('id', matchId)

    // Re-fetch to get the other player's report (if already submitted)
    const { data: fresh } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single()

    if (!fresh) throw new Error('Could not re-fetch match')

    const challengerReport = fresh.challenger_reported_winner
    const opponentReport   = fresh.opponent_reported_winner

    // Both players have reported
    if (challengerReport && opponentReport) {
      if (challengerReport === opponentReport) {
        // ✅ Agreement — finalise
        await finalise(fresh, challengerReport)
      } else {
        // ⚠️ Conflict — flag for admin
        await supabase.from('matches').update({ status: 'disputed' }).eq('id', matchId)
      }
    }
    // If only one player has reported, leave as 'accepted' — waiting for the other

    await fetch()
  }

  // Called internally once both players agree on a winner
  async function finalise(match: any, winnerId: string) {
    const playersStore = usePlayersStore()
    const loserId = winnerId === match.challenger_id ? match.opponent_id : match.challenger_id

    const winner = playersStore.byId(winnerId)
    const loser  = playersStore.byId(loserId)
    if (!winner || !loser) throw new Error('Players not found')

    const result = calculateResult(
      { rating: winner.rating, uncertainty: winner.uncertainty, streak: winner.streak },
      { rating: loser.rating,  uncertainty: loser.uncertainty,  streak: loser.streak },
    )

    const isChallenger    = winnerId === match.challenger_id
    const challengerDelta = isChallenger ? result.winnerDelta : result.loserDelta
    const opponentDelta   = isChallenger ? result.loserDelta  : result.winnerDelta

    // Use the winner's reported score as canonical
    const canonicalScore = winnerId === match.challenger_id
      ? match.challenger_reported_score
      : match.opponent_reported_score

    const parts      = (canonicalScore ?? '').split(',')
    const cScores    = parts.map((s: string) => parseInt(s.split('-')[0]))
    const oScores    = parts.map((s: string) => parseInt(s.split('-')[1]))

    await supabase.from('matches').update({
      winner_id:        winnerId,
      challenger_score: cScores.join(','),
      opponent_score:   oScores.join(','),
      status:           'completed',
      quality:          result.quality,
      challenger_delta: challengerDelta,
      opponent_delta:   opponentDelta,
      completed_at:     new Date().toISOString(),
    }).eq('id', match.id)

    await supabase.from('players').update({
      rating:       result.winnerNewRating,
      uncertainty:  result.winnerUncertainty,
      streak:       Math.max(0, winner.streak) + 1,
      season_wins:  winner.season_wins  + 1,
      career_wins:  winner.career_wins  + 1,
      last_played:  new Date().toISOString(),
    }).eq('profile_id', winnerId)

    await supabase.from('players').update({
      rating:        result.loserNewRating,
      uncertainty:   result.loserUncertainty,
      streak:        Math.min(0, loser.streak) - 1,
      season_losses: loser.season_losses + 1,
      career_losses: loser.career_losses + 1,
      last_played:   new Date().toISOString(),
    }).eq('profile_id', loserId)

    await supabase.from('elo_history').insert([
      { profile_id: winnerId, rating: result.winnerNewRating, match_id: match.id },
      { profile_id: loserId,  rating: result.loserNewRating,  match_id: match.id },
    ])

    await playersStore.fetch()
  }

  // Admin: resolve a disputed match manually
  async function resolveDispute(matchId: string, winnerId: string) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) throw new Error('Match not found')
    await finalise(match, winnerId)
    await fetch()
  }

  return {
    matches, loading, error, completed, disputed, pending,
    fetch, challenge, respond, submitResult, resolveDispute,
  }
})
