<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="$emit('close')">
      <div class="modal card">
        <div class="modal-header card-header">
          <h3>Submit your result</h3>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div class="flash flash-info" style="margin-bottom:1rem;font-size:0.8rem">
            Both players submit independently. Ratings only update once you both agree on the winner.
          </div>

          <p class="match-label">
            <strong>{{ match.challenger?.display_name || match.challenger?.username }}</strong>
            vs
            <strong>{{ match.opponent?.display_name || match.opponent?.username }}</strong>
          </p>

          <div class="games-section">
            <div class="field-label" style="margin-bottom:0.75rem">Game scores</div>
            <div v-for="(_, i) in games" :key="i" class="game-row">
              <span class="game-label muted">Game {{ i + 1 }}</span>
              <input
                v-model.number="games[i].c"
                type="number" min="0" max="25"
                class="input score-input"
                placeholder="0"
                @input="detectWinner"
              />
              <span class="game-sep muted">—</span>
              <input
                v-model.number="games[i].o"
                type="number" min="0" max="25"
                class="input score-input"
                placeholder="0"
                @input="detectWinner"
              />
              <button v-if="games.length > 1 && i === games.length - 1" class="btn btn-ghost btn-sm" @click="removeGame">–</button>
            </div>
            <button v-if="games.length < 7" class="btn btn-ghost btn-sm" style="margin-top:0.5rem" @click="addGame">
              + Add game
            </button>
          </div>

          <div v-if="detectedWinner" class="winner-preview">
            <span class="muted" style="font-size:0.8rem">Detected winner</span>
            <strong>{{ detectedWinner }}</strong>
          </div>

          <div v-if="submitError" class="flash flash-error" style="margin-top:0.75rem">{{ submitError }}</div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="$emit('close')">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="!detectedWinnerId || submitting"
            @click="submit"
          >
            <span v-if="submitting" class="spinner" />
            <span v-else>Submit my result</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Match } from '@/types'

const props = defineProps<{ match: Match; reporterId: string }>()
const emit  = defineEmits(['close', 'submit'])

const games       = ref([{ c: null as number | null, o: null as number | null }])
const submitting  = ref(false)
const submitError = ref('')

const detectedWinnerId = ref<string | null>(null)
const detectedWinner   = computed(() => {
  if (!detectedWinnerId.value) return null
  if (detectedWinnerId.value === props.match.challenger_id)
    return props.match.challenger?.display_name || props.match.challenger?.username
  return props.match.opponent?.display_name || props.match.opponent?.username
})

function detectWinner() {
  let cWins = 0, oWins = 0
  for (const g of games.value) {
    if (g.c != null && g.o != null) {
      if (g.c > g.o) cWins++
      else if (g.o > g.c) oWins++
    }
  }
  if (cWins > oWins)      detectedWinnerId.value = props.match.challenger_id
  else if (oWins > cWins) detectedWinnerId.value = props.match.opponent_id
  else                    detectedWinnerId.value = null
}

function addGame()    { games.value.push({ c: null, o: null }) }
function removeGame() { games.value.pop(); detectWinner() }

async function submit() {
  if (!detectedWinnerId.value) { submitError.value = 'No winner detected — check scores'; return }
  submitting.value = true
  submitError.value = ''

  const loserId = detectedWinnerId.value === props.match.challenger_id
    ? props.match.opponent_id
    : props.match.challenger_id

  emit('submit', {
    matchId:          props.match.id,
    reporterId:       props.reporterId,
    winnerId:         detectedWinnerId.value,
    loserId,
    challengerScores: games.value.map(g => g.c ?? 0),
    opponentScores:   games.value.map(g => g.o ?? 0),
  })
}
</script>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem; }
.modal { width: 100%; max-width: 440px; }
.modal-header { display: flex; align-items: center; justify-content: space-between; }
.close-btn { background: none; border: none; color: var(--txt-muted); font-size: 1rem; cursor: pointer; padding: 0.25rem; }
.close-btn:hover { color: var(--txt-primary); }
.modal-body { padding: 1.25rem; }
.match-label { font-size: 0.875rem; color: var(--txt-secondary); margin-bottom: 1.25rem; }
.games-section { margin-bottom: 1rem; }
.game-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.game-label { font-size: 0.75rem; width: 48px; flex-shrink: 0; }
.score-input { width: 60px; text-align: center; flex-shrink: 0; padding: 0.45rem 0.5rem; }
.game-sep { flex-shrink: 0; }
.winner-preview { display: flex; align-items: center; justify-content: space-between; background: var(--table-light); border-radius: var(--radius-sm); padding: 0.6rem 0.875rem; margin-top: 0.75rem; font-size: 0.875rem; }
.modal-footer { padding: 1rem 1.25rem; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
