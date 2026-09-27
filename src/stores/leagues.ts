// src/stores/leagues.ts — v0.0.3.0
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'

export interface League {
  id:          string
  name:        string
  sport:       string
  icon:        string
  court_count: number | null
  created_at:  string
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

  // Whether the signed-in user administers the CURRENT league specifically
  // — not the same as useAuth's isAdmin, which only reflects the global
  // super-admin flag. Refreshed via the is_league_admin() RPC (the same
  // check the v0.0.4.9 leagues UPDATE policy itself uses) whenever the
  // current league changes, rather than reimplementing its OR-of-two-
  // conditions logic here and risking it drifting out of sync.
  const isCurrentLeagueAdmin = ref(false)

  async function refreshCurrentLeagueAdmin() {
    if (!currentLeagueId.value) { isCurrentLeagueAdmin.value = false; return }
    const { data } = await supabase.rpc('is_league_admin', { p_league_id: currentLeagueId.value })
    isCurrentLeagueAdmin.value = !!data
  }

  // Every league minus the ones already joined — the "join a league" list.
  const joinableLeagues = computed(() =>
    allLeagues.value.filter(l => !myLeagues.value.some(m => m.id === l.id))
  )

  function setCurrentLeague(id: string) {
    currentLeagueId.value = id
    localStorage.setItem(STORAGE_KEY, id)
    refreshCurrentLeagueAdmin()
  }

  async function fetchMyLeagues() {
    const { user } = useAuth()
    if (!user.value?.id) { myLeagues.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('players')
      .select('league:leagues(id, name, sport, icon, court_count, created_at)')
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
      } else {
        // Saved selection is still valid, so setCurrentLeague (which
        // would otherwise refresh this) never runs on this path — do it
        // directly instead, or a returning session's admin status would
        // never get populated until they manually switched leagues.
        refreshCurrentLeagueAdmin()
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

  // League-admin-only via the v0.0.4.9 RLS policy. A failed RLS check on
  // UPDATE doesn't error by default — it just silently matches 0 rows —
  // so this chains .select() specifically to detect that case and turn
  // it into an actual error instead of a save that looked like it worked.
  async function updateLeague(id: string, fields: { name?: string; icon?: string }) {
    const { data, error: err } = await supabase.from('leagues').update(fields).eq('id', id).select()
    if (err) throw new Error(err.message)
    if (!data || data.length === 0) throw new Error("You don't have permission to edit this league")
    await Promise.all([fetchMyLeagues(), fetchAllLeagues()])
  }

  return {
    myLeagues, allLeagues, joinableLeagues, currentLeagueId, currentLeague, isCurrentLeagueAdmin,
    loading, error,
    setCurrentLeague, fetchMyLeagues, fetchAllLeagues, joinLeague, createLeague, updateLeague,
  }
})
