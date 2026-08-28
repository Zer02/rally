// src/stores/players.ts — v0.0.4
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
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
    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('*, profile:profiles(id, username, display_name, unit, avatar_url, is_admin)')
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

  return { players, loading, error, sorted, fetch, byId, subscribe, unsubscribe }
})
