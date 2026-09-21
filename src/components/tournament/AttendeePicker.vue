<template>
  <div class="card attendee-picker" style="padding:1.25rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.75rem">
      <h3 style="font-size:0.95rem">Start week {{ nextWeekNumber }}</h3>
      <span class="muted" style="font-size:0.78rem">{{ selected.length }} selected</span>
    </div>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Pick who's here today. Anyone not already in the season gets enrolled at 0–0 —
      no catch-up matches for weeks they missed. Starting this week also clears any
      match still pending from the last one — if it wasn't played, it's not coming back.
    </p>

    <div class="field" style="margin-bottom:0.9rem;max-width:220px">
      <label class="field-label">Target matches per player</label>
      <input v-model.number="targetMatches" type="number" min="1" max="15" class="input" />
      <p class="muted" style="font-size:0.76rem;margin-top:0.3rem">
        Paired by closest current form — some players may get fewer if the group is small.
      </p>
    </div>

    <div v-if="!players.length" class="muted" style="font-size:0.85rem">
      No players in this league yet.
    </div>
    <div v-else class="attendee-grid">
      <label v-for="p in players" :key="p.profile_id" class="attendee-row">
        <input type="checkbox" :value="p.profile_id" v-model="selected" />
        <span>{{ p.profile?.display_name || p.profile?.username }}</span>
      </label>
    </div>

    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button
        class="btn btn-primary"
        :disabled="selected.length < 2 || !targetMatches || starting"
        @click="start"
      >
        <span v-if="starting" class="spinner" style="width:14px;height:14px;border-width:2px" />
        <span v-else>Start week with {{ selected.length }} {{ selected.length === 1 ? 'player' : 'players' }}</span>
      </button>
      <button class="btn btn-ghost" type="button" @click="$emit('cancel')">Cancel</button>
    </div>
    <p v-if="startError" class="flash flash-error" style="margin-top:0.75rem">{{ startError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Player } from '@/types'

const props = defineProps<{
  players: Player[]
  nextWeekNumber: number
  onStart: (attendeeIds: string[], targetMatches: number) => Promise<void>
}>()

defineEmits<{ cancel: [] }>()

const selected      = ref<string[]>([])
const targetMatches = ref(5)
const starting      = ref(false)
const startError    = ref('')

async function start() {
  if (selected.value.length < 2 || !targetMatches.value) return
  starting.value = true
  startError.value = ''
  try {
    await props.onStart(selected.value, targetMatches.value)
    selected.value = []
  } catch (e: any) {
    startError.value = e.message
  }
  starting.value = false
}
</script>

<style scoped>
.attendee-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.4rem; max-height: 260px; overflow-y: auto; }
.attendee-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.6rem; border-radius: var(--radius-sm);
  border: 1px solid var(--line); font-size: 0.85rem; cursor: pointer;
}
.attendee-row:has(input:checked) { border-color: var(--ball); background: rgba(232,200,74,0.08); }
.attendee-row input { accent-color: var(--ball); }
</style>
