<template>
  <div class="card" style="padding:1.25rem">
    <h3 style="font-size:0.95rem;margin-bottom:0.75rem">Add a match</h3>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Adds one match to the current week. Anyone picked is auto-enrolled if they
      aren't in the season yet — this doesn't check whether they've already played
      this week, so it's also how you add a rematch on purpose.
    </p>

    <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;margin-bottom:0.9rem;cursor:pointer">
      <input type="checkbox" v-model="isDoubles" />
      Doubles
    </label>

    <div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin-bottom:0.75rem">
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="min-width:160px">
          <label class="field-label">{{ isDoubles ? 'Team A — player 1' : 'Player A' }}</label>
          <select v-model="playerA" class="input">
            <option value="" disabled>Choose a player</option>
            <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
              {{ p.profile?.display_name || p.profile?.username }}
            </option>
          </select>
        </div>
        <div v-if="isDoubles" class="field" style="min-width:160px">
          <label class="field-label">Team A — player 2</label>
          <select v-model="playerA2" class="input">
            <option value="" disabled>Choose a player</option>
            <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
              {{ p.profile?.display_name || p.profile?.username }}
            </option>
          </select>
        </div>
      </div>

      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="min-width:160px">
          <label class="field-label">{{ isDoubles ? 'Team B — player 1' : 'Player B' }}</label>
          <select v-model="playerB" class="input">
            <option value="" disabled>Choose a player</option>
            <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
              {{ p.profile?.display_name || p.profile?.username }}
            </option>
          </select>
        </div>
        <div v-if="isDoubles" class="field" style="min-width:160px">
          <label class="field-label">Team B — player 2</label>
          <select v-model="playerB2" class="input">
            <option value="" disabled>Choose a player</option>
            <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
              {{ p.profile?.display_name || p.profile?.username }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-primary" :disabled="!canAdd || adding" @click="add">
        <span v-if="adding" class="spinner" style="width:14px;height:14px;border-width:2px" />
        <span v-else>Add match</span>
      </button>
      <button class="btn btn-ghost" type="button" @click="$emit('cancel')">Cancel</button>
    </div>
    <p v-if="duplicateSelection" class="flash flash-error" style="margin-top:0.75rem">
      Each player can only appear once in the match.
    </p>
    <p v-if="addError" class="flash flash-error" style="margin-top:0.75rem">{{ addError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Player } from '@/types'

const props = defineProps<{
  players: Player[]
  onAdd: (playerAId: string, playerBId: string, playerA2Id?: string, playerB2Id?: string) => Promise<void>
}>()

defineEmits<{ cancel: [] }>()

const isDoubles = ref(false)
const playerA   = ref('')
const playerB   = ref('')
const playerA2  = ref('')
const playerB2  = ref('')
const adding    = ref(false)
const addError  = ref('')

watch(isDoubles, (on) => {
  if (!on) { playerA2.value = ''; playerB2.value = '' }
})

const selectedIds = computed(() => {
  const ids = [playerA.value, playerB.value]
  if (isDoubles.value) ids.push(playerA2.value, playerB2.value)
  return ids.filter(Boolean)
})
const duplicateSelection = computed(() => new Set(selectedIds.value).size !== selectedIds.value.length)

const canAdd = computed(() => {
  const required = isDoubles.value
    ? [playerA.value, playerA2.value, playerB.value, playerB2.value]
    : [playerA.value, playerB.value]
  return required.every(Boolean) && !duplicateSelection.value
})

async function add() {
  if (!canAdd.value) return
  adding.value = true
  addError.value = ''
  try {
    await props.onAdd(
      playerA.value, playerB.value,
      isDoubles.value ? playerA2.value : undefined,
      isDoubles.value ? playerB2.value : undefined
    )
    playerA.value = ''
    playerB.value = ''
    playerA2.value = ''
    playerB2.value = ''
  } catch (e: any) {
    addError.value = e.message
  }
  adding.value = false
}
</script>
