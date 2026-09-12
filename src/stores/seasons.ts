// src/stores/seasons.ts — v0.0.3.1
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useLeagueStore } from './leagues'
import type { Season, SeasonRecord } from '@/types'

export const useSeasonsStore = defineStore('seasons', () => {
  const seasons  = ref<Season[]>([])
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  // Cache of archived records, keyed by season_id, so switching the
  // dropdown back and forth doesn't re-fetch every time.
  const recordsBySeasonId = ref<Record<string, SeasonRecord[]>>({})

  // The season with no ended_at is the one currently in progress. Its
  // W-L lives on `players.season_wins/season_losses`, NOT in
  // season_records — that table only gets a row for a season once
  // reset_season() closes it out.
  const currentSeason = computed(() =>
    seasons.value.find(s => s.ended_at === null) ?? null
  )

  // Seasons that have actually been closed out and archived — these are
  // the only ones with rows in season_records to look up.
  const pastSeasons = computed(() =>
    seasons.value.filter(s => s.ended_at !== null)
  )

  async function fetchSeasons() {
    const leagueId = useLeagueStore().currentLeagueId
    if (!leagueId) { seasons.value = []; return }

    loading.value = true
    const { data, error: err } = await supabase
      .from('seasons')
      .select('*')
      .eq('league_id', leagueId)
      .order('season_number', { ascending: false })

    if (err) { error.value = err.message }
    else { seasons.value = (data ?? []) as Season[] }
    loading.value = false
  }

  async function fetchRecords(seasonId: string) {
    if (recordsBySeasonId.value[seasonId]) return recordsBySeasonId.value[seasonId]

    const { data, error: err } = await supabase
      .from('season_records')
      .select('*')
      .eq('season_id', seasonId)

    const records = (err ? [] : (data ?? [])) as SeasonRecord[]
    recordsBySeasonId.value = { ...recordsBySeasonId.value, [seasonId]: records }
    return records
  }

  // Returns null if the player has no archived record for that season
  // (e.g. they joined after it was already closed out).
  function recordFor(seasonId: string, profileId: string): SeasonRecord | null {
    return recordsBySeasonId.value[seasonId]?.find(r => r.profile_id === profileId) ?? null
  }

  return {
    seasons, loading, error, currentSeason, pastSeasons,
    fetchSeasons, fetchRecords, recordFor,
  }
})
