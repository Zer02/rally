// src/stores/players.ts — v0.0.3.1
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import type { Player } from '@/types'

export const usePlayersStore = defineStore('players', () => {
  const players     = ref<Player[]>([])
  const loading     = ref(false)
  const error       = ref<string | null>(null)
  let   subscription: ReturnType<typeof supabase.channel> | null = null

  const sorted = computed(() =>
    [...players.value].sort((a, b) => b.rating - a.rating)
  )

  async function fetch() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { players.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('*, profile:profiles(id, username, display_name, unit, avatar_url, is_admin)')
      .eq('league_id', leagueId)
      .order('rating', { ascending: false })

    if (err) { error.value = err.message }
    else { players.value = (data ?? []) as Player[] }
    loading.value = false
  }

  // Subscribe to realtime player row changes
  // so leaderboard and profile update automatically
  function subscribe() {
    if (subscription) return

    subscription = supabase
      .channel('players-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players' },
        async () => {
          // Re-fetch all players when any player row updates
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

  function byId(id: string) {
    return players.value.find(p => p.profile_id === id)
  }

  // Admin-only: zero out season_wins/season_losses for every player in
  // the currently selected league, archiving their standing first (see
  // reset_season() — it's not just a wipe). Authorization is enforced
  // server-side by is_league_admin(), not by anything client-side here.
  async function resetSeason() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) throw new Error('No league selected')

    const { error: err } = await supabase.rpc('reset_season', { p_league_id: leagueId })
    if (err) throw new Error(err.message)
    await fetch()
  }

  return { players, loading, error, sorted, fetch, byId, subscribe, unsubscribe, resetSeason }
})
