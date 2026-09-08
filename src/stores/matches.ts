// src/stores/matches.ts — v0.0.2.7
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

    const { error: reportErr } = await supabase.from('matches').update(
      isChallenger
        ? { challenger_reported_winner: winnerId, challenger_reported_score: scoreStr }
        : { opponent_reported_winner:   winnerId, opponent_reported_score:   scoreStr }
    ).eq('id', matchId)
    if (reportErr) throw new Error(reportErr.message)

    // Re-fetch fresh state to check if both have reported
    const { data: fresh, error: fetchErr } = await supabase
      .from('matches').select('*').eq('id', matchId).single()
    if (fetchErr || !fresh) throw new Error(fetchErr?.message ?? 'Could not re-fetch match')

    const challengerReport = fresh.challenger_reported_winner
    const opponentReport   = fresh.opponent_reported_winner

    if (challengerReport && opponentReport) {
      const winnerMatches = challengerReport === opponentReport
      const scoresMatch   = fresh.challenger_reported_score === fresh.opponent_reported_score

      if (winnerMatches && scoresMatch) {
        await finalise(fresh, challengerReport)
      } else {
        // Winner and/or score disagree — flag for admin review rather than
        // silently trusting whichever side reported second.
        const { error: disputeErr } = await supabase
          .from('matches').update({ status: 'disputed' }).eq('id', matchId)
        if (disputeErr) throw new Error(disputeErr.message)
      }
    }

    // Realtime subscriptions will handle store refresh,
    // but also do it manually to ensure immediate UI update
    const playersStore = usePlayersStore()
    await Promise.all([fetch(), playersStore.fetch()])
  }

  async function finalise(match: any, winnerId: string, rawScoreOverride?: string) {
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

    // IMPORTANT: rawScore must come from the SAME report as winnerId, never
    // derived independently from winnerId's challenger/opponent role. If a
    // caller (e.g. admin dispute resolution) picks a winner that doesn't
    // match challenger_reported_winner/opponent_reported_winner, guessing
    // the score by role produces a self-contradictory match (winner and
    // score from two different, disagreeing submissions).
    const rawScore = rawScoreOverride ?? (winnerId === match.challenger_id
      ? match.challenger_reported_score
      : match.opponent_reported_score)

    const parts   = (rawScore ?? '').split(',')
    const cScores = parts.map((s: string) => parseInt(s.split('-')[0]))
    const oScores = parts.map((s: string) => parseInt(s.split('-')[1]))

    // Single RPC call, run as SECURITY DEFINER server-side — this is what
    // actually fixes the "players table never updates" bug. Doing these as
    // separate client-side updates meant whichever player DIDN'T trigger
    // finalise() had their row silently rejected by RLS (no error thrown,
    // just 0 rows affected), so rating/streak/W-L only ever moved once.
    const { error: rpcErr } = await supabase.rpc('finalize_match', {
      p_match_id:           match.id,
      p_winner_id:          winnerId,
      p_loser_id:           loserId,
      p_winner_rating:      result.winnerNewRating,
      p_winner_uncertainty: result.winnerUncertainty,
      p_winner_streak:      Math.max(0, winner.streak) + 1,
      p_loser_rating:       result.loserNewRating,
      p_loser_uncertainty:  result.loserUncertainty,
      p_loser_streak:       Math.min(0, loser.streak) - 1,
      p_quality:            result.quality,
      p_challenger_delta:   challengerDelta,
      p_opponent_delta:     opponentDelta,
      p_challenger_score:   cScores.join(','),
      p_opponent_score:     oScores.join(','),
    })
    if (rpcErr) throw new Error(rpcErr.message)

    await playersStore.fetch()
  }

  // Admin picks an ENTIRE report to trust — winner and score together —
  // rather than picking a winner independently. This is what prevents an
  // admin resolving a dispute from ending up with a winner from one
  // player's report and a score from the other's, which produces a
  // match where the "winner" actually has fewer points on record.
  async function resolveDispute(matchId: string, useChallengerReport: boolean) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) throw new Error('Match not found')

    const winnerId = useChallengerReport
      ? match.challenger_reported_winner
      : match.opponent_reported_winner
    const rawScore = useChallengerReport
      ? match.challenger_reported_score
      : match.opponent_reported_score

    if (!winnerId) throw new Error('Selected report has no recorded winner')

    await finalise(match, winnerId, rawScore)
    await fetch()
  }

  // Admin-only: record a completed match directly for two other players,
  // skipping the normal challenge/accept/report flow entirely. Player A
  // is treated as the "challenger" and Player B as the "opponent" purely
  // for score-perspective bookkeeping — it has no bearing on who won.
  // Relies on the "Admins create matches for anyone" insert policy to
  // pass RLS, and reuses finalise() so rating math and the finalize_match
  // RPC call are identical to every other path.
  async function recordAsAdmin(
    playerAId: string,
    playerBId: string,
    winnerId:  string,
    aScores:   number[],
    bScores:   number[],
  ) {
    const scoreStr = aScores.map((s, i) => `${s}-${bScores[i]}`).join(',')

    const { data: inserted, error: insertErr } = await supabase
      .from('matches')
      .insert({
        challenger_id: playerAId,
        opponent_id:   playerBId,
        status:        'accepted',
      })
      .select()
      .single()
    if (insertErr) throw new Error(insertErr.message)

    // rawScoreOverride is always from Player A's (challenger's) perspective,
    // which is exactly how scoreStr was built above.
    await finalise(inserted, winnerId, scoreStr)
    await fetch()
  }

  return {
    matches, loading, error, completed, disputed, pending,
    fetch, subscribe, unsubscribe,
    challenge, respond, submitResult, resolveDispute, recordAsAdmin,
  }
})
