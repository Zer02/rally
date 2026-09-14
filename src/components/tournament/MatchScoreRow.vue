<template>
  <div class="match-score-row">
    <div class="match-score-names">
      <span :class="{ 'me-highlight': match.player_a_id === myId }">
        {{ match.player_a?.display_name || match.player_a?.username }}
      </span>
      <span class="muted" style="margin:0 0.4rem">vs</span>
      <span :class="{ 'me-highlight': match.player_b_id === myId }">
        {{ match.player_b?.display_name || match.player_b?.username }}
      </span>
    </div>

    <div class="match-score-inputs">
      <input v-model.number="scoreA" type="number" min="0" max="99" class="input score-input" placeholder="0" />
      <span class="muted">–</span>
      <input v-model.number="scoreB" type="number" min="0" max="99" class="input score-input" placeholder="0" />
      <button
        class="btn btn-primary btn-sm"
        :disabled="!canSubmit || submitting"
        @click="submit"
      >
        <span v-if="submitting" class="spinner" style="width:12px;height:12px;border-width:2px" />
        <span v-else>{{ adminMode ? 'Override' : 'Report' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TournamentMatch } from '@/types'

const props = defineProps<{
  match: TournamentMatch
  myId?: string
  adminMode?: boolean
  onReport: (matchId: string, scoreA: number, scoreB: number) => Promise<void>
}>()

const scoreA = ref<number | null>(null)
const scoreB = ref<number | null>(null)
const submitting = ref(false)

const canSubmit = computed(() =>
  scoreA.value !== null && scoreB.value !== null &&
  scoreA.value >= 0 && scoreB.value >= 0 &&
  scoreA.value !== scoreB.value
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  await props.onReport(props.match.id, scoreA.value as number, scoreB.value as number)
  submitting.value = false
}
</script>

<style scoped>
.match-score-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; }
.match-score-names { font-size: 0.9rem; }
.me-highlight { color: var(--txt-primary); font-weight: 600; }
.match-score-inputs { display: flex; align-items: center; gap: 0.4rem; }
.score-input { width: 52px; text-align: center; flex-shrink: 0; padding: 0.45rem 0.5rem; }
</style>
