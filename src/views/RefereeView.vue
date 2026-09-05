<template>
  <main class="page">
    <div class="container" style="max-width:600px">
      <div class="page-header">
        <p class="eyebrow">Admin</p>
        <h1>Referee a match</h1>
      </div>

      <div class="flash flash-info" style="margin-bottom:1.25rem;font-size:0.8rem">
        Enter a result directly — this skips the normal challenge/accept flow
        and posts the match as completed immediately.
      </div>

      <div v-if="flash" class="flash" :class="`flash-${flashType}`" style="margin-bottom:1.25rem">{{ flash }}</div>

      <div class="card" style="padding:1.25rem;margin-bottom:1.25rem">
        <div class="field" style="margin-bottom:1rem">
          <label class="field-label">Player A</label>
          <select v-model="playerAId" class="input">
            <option value="" disabled>Select a player</option>
            <option v-for="p in store.sorted" :key="p.profile_id" :value="p.profile_id" :disabled="p.profile_id === playerBId">
              {{ pname(p) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Player B</label>
          <select v-model="playerBId" class="input">
            <option value="" disabled>Select a player</option>
            <option v-for="p in store.sorted" :key="p.profile_id" :value="p.profile_id" :disabled="p.profile_id === playerAId">
              {{ pname(p) }}
            </option>
          </select>
        </div>
      </div>

      <div v-if="playerAId && playerBId" class="card" style="padding:1.25rem">
        <div class="field-label" style="margin-bottom:0.75rem">Game scores</div>
        <div v-for="(_, i) in games" :key="i" class="game-row">
          <span class="game-label muted">Game {{ i + 1 }}</span>
          <input
            v-model.number="games[i].a"
            type="number" min="0" max="25"
            class="input score-input"
            placeholder="0"
            @input="detectWinner"
          />
          <span class="game-sep muted">—</span>
          <input
            v-model.number="games[i].b"
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

        <div v-if="detectedWinnerId" class="winner-preview">
          <span class="muted" style="font-size:0.8rem">Winner</span>
          <strong>{{ winnerName }}</strong>
        </div>

        <button
          class="btn btn-primary"
          style="width:100%;margin-top:1.25rem;justify-content:center;padding:0.75rem"
          :disabled="!detectedWinnerId || submitting"
          @click="submit"
        >
          <span v-if="submitting" class="spinner" />
          <span v-else>Record match →</span>
        </button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import type { Player } from '@/types'

const store   = usePlayersStore()
const matches = useMatchesStore()

const playerAId = ref('')
const playerBId = ref('')
const games      = ref([{ a: null as number | null, b: null as number | null }])
const submitting = ref(false)
const flash       = ref('')
const flashType    = ref<'error' | 'success'>('error')

const detectedWinnerId = ref<string | null>(null)

const winnerName = computed(() => {
  if (!detectedWinnerId.value) return ''
  const p = store.byId(detectedWinnerId.value)
  return p ? pname(p) : ''
})

function pname(p: Player) {
  return p.profile?.display_name || p.profile?.username || '?'
}

function detectWinner() {
  let aWins = 0, bWins = 0
  for (const g of games.value) {
    if (g.a != null && g.b != null) {
      if (g.a > g.b) aWins++
      else if (g.b > g.a) bWins++
    }
  }
  if (aWins > bWins)      detectedWinnerId.value = playerAId.value
  else if (bWins > aWins) detectedWinnerId.value = playerBId.value
  else                    detectedWinnerId.value = null
}

function addGame()    { games.value.push({ a: null, b: null }) }
function removeGame() { games.value.pop(); detectWinner() }

async function submit() {
  if (!detectedWinnerId.value || !playerAId.value || !playerBId.value) return
  submitting.value = true
  flash.value = ''
  try {
    await matches.recordAsAdmin(
      playerAId.value,
      playerBId.value,
      detectedWinnerId.value,
      games.value.map(g => g.a ?? 0),
      games.value.map(g => g.b ?? 0),
    )
    flash.value = 'Match recorded.'
    flashType.value = 'success'
    playerAId.value = ''
    playerBId.value = ''
    games.value = [{ a: null, b: null }]
    detectedWinnerId.value = null
  } catch (e: any) {
    flash.value = e.message
    flashType.value = 'error'
  }
  submitting.value = false
}
</script>

<style scoped>
.field-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--txt-muted); display: block; margin-bottom: 0.4rem; }
.game-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.game-label { font-size: 0.75rem; width: 48px; flex-shrink: 0; }
.score-input { width: 60px; text-align: center; flex-shrink: 0; padding: 0.45rem 0.5rem; }
.game-sep { flex-shrink: 0; }
.winner-preview { display: flex; align-items: center; justify-content: space-between; background: var(--table-light); border-radius: var(--radius-sm); padding: 0.6rem 0.875rem; margin-top: 0.75rem; font-size: 0.875rem; }
</style>
