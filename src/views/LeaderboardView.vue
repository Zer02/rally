<template>
  <main class="page">
    <div class="container">
      <div class="page-header" style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <p class="eyebrow">Building League</p>
          <h1>Standings</h1>
        </div>
        <div class="field" style="min-width:170px">
          <label class="field-label">Season</label>
          <select v-model="selectedSeasonId" class="input">
            <option value="current">Current season</option>
            <option v-for="s in seasonsStore.pastSeasons" :key="s.id" :value="s.id">
              Season {{ s.season_number }}
            </option>
          </select>
        </div>
      </div>

      <div v-if="store.loading" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else>
        <StandingsTable
          :rows="rows"
          :columns="columns"
          show-tier
          show-streak
          :me-id="user?.id"
          empty-message="Nobody's on the board yet."
        >
          <template v-if="isAuthed" #action="{ row }">
            <RouterLink
              v-if="row.profile_id !== user?.id"
              :to="{ name: 'challenge', query: { opponent: row.profile_id } }"
              class="btn btn-ghost btn-sm"
            >Challenge</RouterLink>
          </template>
        </StandingsTable>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useSeasonsStore } from '@/stores/seasons'
import { useAuth } from '@/composables/useAuth'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import StandingsTable, { type StandingRow, type StandingColumn } from '@/components/leaderboard/StandingsTable.vue'
import type { Player } from '@/types'

const store = usePlayersStore()
const seasonsStore = useSeasonsStore()
const { user, isAuthed } = useAuth()

const selectedSeasonId = ref('current')

onMounted(() => {
  store.fetch()
  store.subscribe()  // live updates
  seasonsStore.fetchSeasons()
})

onUnmounted(() => {
  store.unsubscribe()
})

// Switching leagues in the nav means everything here needs re-fetching —
// it's a different set of players, matches, and season history entirely.
// The past-season dropdown selection doesn't carry over either, since a
// season id from one league means nothing in another.
onLeagueChange(() => {
  selectedSeasonId.value = 'current'
  store.fetch()
  seasonsStore.fetchSeasons()
})

// Past seasons' records are only fetched on demand, once the dropdown
// actually lands on them — "current" needs nothing extra since its W-L
// already lives on the player rows from store.fetch().
watch(selectedSeasonId, (id) => {
  if (id !== 'current') seasonsStore.fetchRecords(id)
})

function seasonRecordDisplay(p: Player): string {
  if (selectedSeasonId.value === 'current') return `${p.season_wins}–${p.season_losses}`
  const record = seasonsStore.recordFor(selectedSeasonId.value, p.profile_id)
  return record ? `${record.wins}–${record.losses}` : '—'
}

function name(p: Player) {
  return p.profile?.display_name || p.profile?.username || 'Unknown'
}

// seasonRecordDisplay() is resolved here, inside the computed, rather than
// lazily inside the column's value() — StandingsTable only re-renders when
// its `rows`/`columns` prop *references* change, and a closure reading
// selectedSeasonId from inside a static column def wouldn't register as a
// dependency anywhere, so the past-season dropdown would silently stop
// updating the table. Baking the resolved string onto each row means the
// season switch is what changes `rows`' reference, which is what Vue
// actually watches.
const rows = computed<(StandingRow & { seasonRecord: string })[]>(() =>
  store.sorted.map(p => ({
    id: p.id,
    profile_id: p.profile_id,
    name: name(p),
    unit: p.profile?.unit,
    rating: p.rating,
    streak: p.streak,
    seasonRecord: seasonRecordDisplay(p),
  }))
)

const columns: StandingColumn[] = [
  {
    key: 'season',
    label: 'Season',
    value: (row) => (row as StandingRow & { seasonRecord: string }).seasonRecord,
  },
]
</script>


