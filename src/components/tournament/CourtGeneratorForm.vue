<template>
  <div class="card" style="padding:1.25rem">
    <h3 style="font-size:0.95rem;margin-bottom:0.4rem">Generate court matches</h3>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Pick who's here and how many courts are free. Works out the best mix of singles
      and doubles to fill them, grouped by current form — re-run it as many times as
      you want for the next round, results shift as scores come in.
    </p>

    <div class="field" style="margin-bottom:0.9rem;max-width:160px">
      <label class="field-label">Courts free</label>
      <input v-model.number="courtCount" type="number" min="1" max="30" class="input" />
    </div>

    <div v-if="!players.length" class="muted" style="font-size:0.85rem">No players in this league yet.</div>
    <div v-else class="attendee-grid">
      <label v-for="p in players" :key="p.profile_id" class="attendee-row">
        <input type="checkbox" :value="p.profile_id" v-model="selected" />
        <span>{{ p.profile?.display_name || p.profile?.username }}</span>
      </label>
    </div>

    <div style="display:flex;gap:0.5rem;margin-top:1rem">
      <button
        class="btn btn-primary"
        :disabled="selected.length < 2 || !courtCount || generating"
        @click="generate"
      >
        <span v-if="generating" class="spinner" style="width:14px;height:14px;border-width:2px" />
        <span v-else>Generate ({{ selected.length }} players, {{ courtCount || 0 }} courts)</span>
      </button>
      <button class="btn btn-ghost" type="button" @click="$emit('cancel')">Close</button>
    </div>

    <div v-if="lastResult" class="card" style="margin-top:0.9rem;padding:0.9rem 1rem">
      <p style="font-size:0.85rem">
        Generated <strong>{{ lastResult.doubles_count }}</strong> doubles and
        <strong>{{ lastResult.singles_count }}</strong> singles match{{ lastResult.singles_count === 1 ? '' : 'es' }}.
      </p>
      <p class="muted" style="font-size:0.8rem;margin-top:0.3rem">
        <template v-if="lastResult.benched_profile_ids.length">
          Sitting out this round: {{ benchedNames.join(', ') }}
        </template>
        <template v-else>Everyone's playing.</template>
      </p>
    </div>

    <p v-if="genError" class="flash flash-error" style="margin-top:0.75rem">{{ genError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Player } from '@/types'

interface GenerateResult {
  week_id: string
  doubles_count: number
  singles_count: number
  match_ids: string[]
  benched_profile_ids: string[]
}

const props = defineProps<{
  players: Player[]
  onGenerate: (attendeeIds: string[], courtCount: number) => Promise<GenerateResult>
}>()

defineEmits<{ cancel: [] }>()

const selected    = ref<string[]>([])
const courtCount  = ref(4)
const generating  = ref(false)
const genError    = ref('')
const lastResult  = ref<GenerateResult | null>(null)

const benchedNames = computed(() => {
  if (!lastResult.value) return []
  return lastResult.value.benched_profile_ids.map(id => {
    const p = props.players.find(pl => pl.profile_id === id)
    return p?.profile?.display_name || p?.profile?.username || 'Unknown'
  })
})

async function generate() {
  if (selected.value.length < 2 || !courtCount.value) return
  generating.value = true
  genError.value = ''
  try {
    lastResult.value = await props.onGenerate(selected.value, courtCount.value)
  } catch (e: any) {
    genError.value = e.message
  }
  generating.value = false
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
