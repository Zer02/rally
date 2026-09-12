// src/composables/useLeagueWatch.ts — v0.0.3.1
import { watch } from 'vue'
import { useLeagueStore } from '@/stores/leagues'

// Runs `callback` whenever the selected league changes after mount.
// (watch() without `immediate: true` never fires for the value that was
// already there when it was set up, so this can't double-fire alongside
// a view's own onMounted fetch.)
export function onLeagueChange(callback: () => void) {
  const leagueStore = useLeagueStore()
  watch(() => leagueStore.currentLeagueId, (id) => {
    if (id) callback()
  })
}
