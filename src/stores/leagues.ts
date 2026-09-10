// src/stores/leagues.ts — v0.0.3.0
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'

export interface League {
  id:         string
  name:       string
  sport:      string
  icon:       string
  created_at: string
}

const STORAGE_KEY = 'rally.currentLeagueId'

export const useLeagueStore = defineStore('leagues', () => {
  const myLeagues  = ref<League[]>([])  // leagues the current user has joined
  const allLeagues = ref<League[]>([])  // every league that exists, for the "join" list
  const loading    = ref(false)
  const error      = ref<string | null>(null)

  const currentLeagueId = ref<string | null>(localStorage.getItem(STORAGE_KEY))

  const currentLeague = computed(() =>
    myLeagues.value.find(l => l.id === currentLeagueId.value) ?? myLeagues.value[0] ?? null
  )

  // Every league minus the ones already joined — the "join a league" list.
  const joinableLeagues = computed(() =>
    allLeagues.value.filter(l => !myLeagues.value.some(m => m.id === l.id))
  )

  function setCurrentLeague(id: string) {
    currentLeagueId.value = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  async function fetchMyLeagues() {
    const { user } = useAuth()
    if (!user.value?.id) { myLeagues.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('league:leagues(id, name, sport, icon, created_at)')
      .eq('profile_id', user.value.id)

    if (err) {
      error.value = err.message
    } else {
      myLeagues.value = (data ?? [])
        .map((row: any) => row.league)
        .filter(Boolean) as League[]

      // If nothing's selected yet, or the saved selection isn't one of
      // this user's leagues anymore (e.g. different browser, first load),
      // fall back to whichever league comes first.
      if (!currentLeagueId.value || !myLeagues.value.some(l => l.id === currentLeagueId.value)) {
        if (myLeagues.value[0]) setCurrentLeague(myLeagues.value[0].id)
      }
    }
    loading.value = false
  }

  async function fetchAllLeagues() {
    const { data, error: err } = await supabase
      .from('leagues')
      .select('*')
      .order('name')
    if (!err) allLeagues.value = (data ?? []) as League[]
  }

  async function joinLeague(leagueId: string) {
    const { user } = useAuth()
    if (!user.value?.id) throw new Error('Must be logged in to join a league')

    const { error: err } = await supabase
      .from('players')
      .insert({ profile_id: user.value.id, league_id: leagueId })
    if (err) throw new Error(err.message)

    await fetchMyLeagues()
    setCurrentLeague(leagueId)
  }

  async function createLeague(name: string, sport: string, icon: string) {
    const { data, error: err } = await supabase.rpc('create_league', {
      p_name:  name,
      p_sport: sport,
      p_icon:  icon || '🏆',
    })
    if (err) throw new Error(err.message)

    await Promise.all([fetchMyLeagues(), fetchAllLeagues()])
    setCurrentLeague(data as string)
    return data as string
  }

  return {
    myLeagues, allLeagues, joinableLeagues, currentLeagueId, currentLeague,
    loading, error,
    setCurrentLeague, fetchMyLeagues, fetchAllLeagues, joinLeague, createLeague,
  }
})
