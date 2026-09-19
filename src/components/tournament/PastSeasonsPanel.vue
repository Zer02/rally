<template>
  <div class="card" style="padding:1.25rem">
    <button class="btn btn-ghost btn-sm" @click="open = !open">
      {{ open ? 'Hide' : 'Show' }} past seasons ({{ seasons.length }})
    </button>

    <div v-if="open" style="margin-top:0.9rem">
      <p v-if="!seasons.length" class="muted" style="font-size:0.85rem">
        No finalized seasons yet — nothing's been deleted, there's just nothing here until one wraps up.
      </p>
      <div v-for="s in seasons" :key="s.id" style="margin-bottom:0.5rem">
        <button class="btn btn-ghost btn-sm past-season-row" @click="toggle(s.id)">
          <span>{{ s.name }}</span>
          <span class="muted" style="font-size:0.78rem">{{ formatDate(s.completed_at) }}</span>
        </button>

        <div v-if="expandedId === s.id" class="card" style="margin-top:0.4rem;overflow-x:auto">
          <div v-if="loadingId === s.id" style="text-align:center;padding:1rem">
            <span class="spinner" style="width:18px;height:18px;border-width:2px" />
          </div>
          <table v-else-if="standingsBySeason[s.id]?.length" class="table">
            <thead>
              <tr><th>Seed</th><th>Player</th><th>W–L</th><th>Adjusted</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in standingsBySeason[s.id]" :key="p.id">
                <td class="mono muted">{{ p.seed ?? '—' }}</td>
                <td>{{ p.profile?.display_name || p.profile?.username }}</td>
                <td class="mono">{{ p.wins }}–{{ p.losses }}</td>
                <td class="mono">{{ p.adjusted_score?.toFixed(1) ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted" style="padding:0.75rem;font-size:0.85rem">No standings recorded.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { Tournament, TournamentParticipant } from '@/types'

const props = defineProps<{
  seasons: Tournament[]
  getStandings: (tournamentId: string) => Promise<TournamentParticipant[]>
}>()

const open       = ref(false)
const expandedId = ref<string | null>(null)
const loadingId  = ref<string | null>(null)
const standingsBySeason = reactive<Record<string, TournamentParticipant[]>>({})

async function toggle(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null
    return
  }
  expandedId.value = id
  if (!standingsBySeason[id]) {
    loadingId.value = id
    standingsBySeason[id] = await props.getStandings(id)
    loadingId.value = null
  }
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<style scoped>
.past-season-row {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  text-align: left;
}
</style>
