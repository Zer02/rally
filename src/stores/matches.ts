// src/stores/matches.ts — v0.0.4
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { calculateResult } from '@/lib/rating'
import type { Match } from '@/types'
import { usePlayersStore } from './players'

const MATCH_SELECT = `
  *,
  challenger:profiles!matches_challenger_id_fkey(id, username, display_name, unit),
  opponent:profiles!matches_opponent_id_fkey(id, username, display_name, unit),
  winner:profiles!matches_winner_id_fkey(id, username, display_name)
`

export const useMatchesStore = defineStore('matches', () => {
  const matches     = ref<Match[]>([])
  const loading     = ref(false)
  const error       = ref<string | null>(null)
  let   subscription: ReturnType<typeof supabase.channel> | null = null

  const completed = computed(() => matches.value.filter(m => m.status === 'completed'))
  const disputed  = computed(() => matches.value.filter(m => m.status === 'disputed'))
  const pending   = computed(() =>
    matches.value.filter(m => m.status === 'pending' || m.status === 'accepted')
  )

  async function fetch(limit = 40) {
    loading.value = true
    const { data, error: err } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (err) { error.value = err.message }
    else { matches.value = (data ?? []) as Match[] }
    loading.value = false
  }

  // Subscribe to realtime match changes
  function subscribe() {
    if (subscription) return

    subscription = supabase
      .channel('matches-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        async () => {
          await fetch()
        }
      )
      .subscribe()
  }

  function unsubscribe() {
    if (subscription) {
      supabase.removeChannel(subscription)
      subscription = null
    }
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
    matchId:          string,
    reporterId:       string,
    winnerId:         string,
    loserId:          string,
    challengerScores: number[],
    opponentScores:   number[],
  ) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) throw new Error('Match not found')

    const isChallenger = reporterId === match.challenger_id
    const scoreStr     = challengerScores.map((s, i) => `${s}-${opponentScores[i]}`).join(',')

    await supabase.from('matches').update(
      isChallenger
        ? { challenger_reported_winner: winnerId, challenger_reported_score: scoreStr }
        : { opponent_reported_winner:   winnerId, opponent_reported_score:   scoreStr }
    ).eq('id', matchId)

    // Re-fetch fresh state to check if both have reported
    const { data: fresh } = await supabase
      .from('matches').select('*').eq('id', matchId).single()

    if (!fresh) throw new Error('Could not re-fetch match')

    const challengerReport = fresh.challenger_reported_winner
    const opponentReport   = fresh.opponent_reported_winner

    if (challengerReport && opponentReport) {
      if (challengerReport === opponentReport) {
        await finalise(fresh, challengerReport)
      } else {
        await supabase.from('matches').update({ status: 'disputed' }).eq('id', matchId)
      }
    }

    // Realtime subscriptions will handle store refresh,
    // but also do it manually to ensure immediate UI update
    const playersStore = usePlayersStore()
    await Promise.all([fetch(), playersStore.fetch()])
  }

  async function finalise(match: any, winnerId: string) {
    const playersStore = usePlayersStore()
    const loserId = winnerId === match.challenger_id ? match.opponent_id : match.challenger_id

    await playersStore.fetch()
    const winner = playersStore.byId(winnerId)
    const loser  = playersStore.byId(loserId)
    if (!winner || !loser) throw new Error('Players not found')

    const result = calculateResult(
      { rating: winner.rating, uncertainty: winner.uncertainty, streak: winner.streak },
      { rating: loser.rating,  uncertainty: loser.uncertainty,  streak: loser.streak  },
    )

    const isChallWinner   = winnerId === match.challenger_id
    const challengerDelta = isChallWinner ? result.winnerDelta : result.loserDelta
    const opponentDelta   = isChallWinner ? result.loserDelta  : result.winnerDelta

    const rawScore = winnerId === match.challenger_id
      ? match.challenger_reported_score
      : match.opponent_reported_score

    const parts   = (rawScore ?? '').split(',')
    const cScores = parts.map((s: string) => parseInt(s.split('-')[0]))
    const oScores = parts.map((s: string) => parseInt(s.split('-')[1]))

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

    await Promise.all([
      supabase.from('players').update({
        rating:       result.winnerNewRating,
        uncertainty:  result.winnerUncertainty,
        streak:       Math.max(0, winner.streak) + 1,
        season_wins:  winner.season_wins  + 1,
        career_wins:  winner.career_wins  + 1,
        last_played:  new Date().toISOString(),
      }).eq('profile_id', winnerId),

      supabase.from('players').update({
        rating:        result.loserNewRating,
        uncertainty:   result.loserUncertainty,
        streak:        Math.min(0, loser.streak) - 1,
        season_losses: loser.season_losses + 1,
        career_losses: loser.career_losses + 1,
        last_played:   new Date().toISOString(),
      }).eq('profile_id', loserId),

      supabase.from('elo_history').insert([
        { profile_id: winnerId, rating: result.winnerNewRating, match_id: match.id },
        { profile_id: loserId,  rating: result.loserNewRating,  match_id: match.id },
      ]),
    ])

    await playersStore.fetch()
  }

  async function resolveDispute(matchId: string, winnerId: string) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) throw new Error('Match not found')
    await finalise(match, winnerId)
    await fetch()
  }

  return {
    matches, loading, error, completed, disputed, pending,
    fetch, subscribe, unsubscribe,
    challenge, respond, submitResult, resolveDispute,
  }
})
