// src/stores/players.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types'

export const usePlayersStore = defineStore('players', () => {
  const players  = ref<Player[]>([])
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  const sorted = computed(() =>
    [...players.value].sort((a, b) => b.rating - a.rating)
  )

  async function fetch() {
    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('*, profile:profiles(id, username, display_name, unit, avatar_url)')
      .order('rating', { ascending: false })

    if (err) { error.value = err.message }
    else { players.value = (data ?? []) as Player[] }
    loading.value = false
  }

  function byId(id: string) {
    return players.value.find(p => p.profile_id === id)
  }

  return { players, loading, error, sorted, fetch, byId }
})
