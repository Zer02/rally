// src/stores/matches.ts
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
  const pending   = computed(() => matches.value.filter(m => m.status === 'pending' || m.status === 'accepted'))

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

  async function submitResult(
    matchId:   string,
    winnerId:  string,
    loserId:   string,
    challengerScores: number[],
    opponentScores:   number[],
  ) {
    const playersStore = usePlayersStore()
    const winner = playersStore.byId(winnerId)
    const loser  = playersStore.byId(loserId)

    if (!winner || !loser) throw new Error('Players not found')

    const result = calculateResult(
      { rating: winner.rating, uncertainty: winner.uncertainty, streak: winner.streak },
      { rating: loser.rating,  uncertainty: loser.uncertainty,  streak: loser.streak  },
    )

    const isChallenger = winner.profile_id === matches.value.find(m => m.id === matchId)?.challenger_id
    const challengerDelta = isChallenger ? result.winnerDelta : result.loserDelta
    const opponentDelta   = isChallenger ? result.loserDelta  : result.winnerDelta

    // Update match record
    await supabase.from('matches').update({
      winner_id:        winnerId,
      challenger_score: challengerScores.join(','),
      opponent_score:   opponentScores.join(','),
      status:           'completed',
      quality:          result.quality,
      challenger_delta: challengerDelta,
      opponent_delta:   opponentDelta,
      completed_at:     new Date().toISOString(),
    }).eq('id', matchId)

    // Update winner player row
    await supabase.from('players').update({
      rating:       result.winnerNewRating,
      uncertainty:  result.winnerUncertainty,
      streak:       Math.max(0, winner.streak) + 1,
      season_wins:  winner.season_wins  + 1,
      career_wins:  winner.career_wins  + 1,
      last_played:  new Date().toISOString(),
    }).eq('profile_id', winnerId)

    // Update loser player row
    await supabase.from('players').update({
      rating:       result.loserNewRating,
      uncertainty:  result.loserUncertainty,
      streak:       Math.min(0, loser.streak) - 1,
      season_losses: loser.season_losses + 1,
      career_losses: loser.career_losses + 1,
      last_played:  new Date().toISOString(),
    }).eq('profile_id', loserId)

    // Elo history snapshots
    await supabase.from('elo_history').insert([
      { profile_id: winnerId, rating: result.winnerNewRating, match_id: matchId },
      { profile_id: loserId,  rating: result.loserNewRating,  match_id: matchId },
    ])

    await Promise.all([fetch(), playersStore.fetch()])
  }

  return { matches, loading, error, completed, pending, fetch, challenge, respond, submitResult }
})
