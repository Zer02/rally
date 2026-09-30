// src/composables/useSport.ts — v0.0.5.6
// The sport of whichever league is currently selected, as a reactive
// SportInfo. Follows the league switcher: change league, and everything
// reading `sport` (home page copy, page title, level titles) updates.
//
// A signed-out visitor has no "my leagues" list, so fall back to the league
// list that's readable without signing in (the same one the switcher's join
// list uses), using the league id remembered in localStorage.
import { computed } from 'vue'
import { useLeagueStore } from '@/stores/leagues'
import { getSport } from '@/lib/sports'

let requestedAllLeagues = false

export function useSport() {
  const leagues = useLeagueStore()

  if (!requestedAllLeagues && leagues.allLeagues.length === 0) {
    requestedAllLeagues = true
    leagues.fetchAllLeagues()
  }

  const sport = computed(() => {
    const l = leagues.currentLeague
      ?? leagues.allLeagues.find(x => x.id === leagues.currentLeagueId)
      ?? null
    return getSport(l?.sport)
  })

  return { sport }
}
