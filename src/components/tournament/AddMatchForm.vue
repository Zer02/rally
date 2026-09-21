<template>
  <div class="card" style="padding:1.25rem">
    <h3 style="font-size:0.95rem;margin-bottom:0.75rem">Add a match</h3>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Adds one match to the current week. Either player is auto-enrolled if they
      aren't in the season yet — this doesn't check whether they've already played
      this week, so it's also how you add a rematch on purpose.
    </p>

    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="min-width:160px">
        <label class="field-label">Player A</label>
        <select v-model="playerA" class="input">
          <option value="" disabled>Choose a player</option>
          <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
            {{ p.profile?.display_name || p.profile?.username }}
          </option>
        </select>
      </div>
      <div class="field" style="min-width:160px">
        <label class="field-label">Player B</label>
        <select v-model="playerB" class="input">
          <option value="" disabled>Choose a player</option>
          <option v-for="p in players" :key="p.profile_id" :value="p.profile_id">
            {{ p.profile?.display_name || p.profile?.username }}
          </option>
        </select>
      </div>
      <button class="btn btn-primary" :disabled="!canAdd || adding" @click="add">
        <span v-if="adding" class="spinner" style="width:14px;height:14px;border-width:2px" />
        <span v-else>Add match</span>
      </button>
      <button class="btn btn-ghost" type="button" @click="$emit('cancel')">Cancel</button>
    </div>
    <p v-if="sameSelection" class="flash flash-error" style="margin-top:0.75rem">
      Choose two different players.
    </p>
    <p v-if="addError" class="flash flash-error" style="margin-top:0.75rem">{{ addError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Player } from '@/types'

const props = defineProps<{
  players: Player[]
  onAdd: (playerAId: string, playerBId: string) => Promise<void>
}>()

defineEmits<{ cancel: [] }>()

const playerA  = ref('')
const playerB  = ref('')
const adding   = ref(false)
const addError = ref('')

const sameSelection = computed(() => !!playerA.value && !!playerB.value && playerA.value === playerB.value)
const canAdd = computed(() => !!playerA.value && !!playerB.value && !sameSelection.value)

async function add() {
  if (!canAdd.value) return
  adding.value = true
  addError.value = ''
  try {
    await props.onAdd(playerA.value, playerB.value)
    playerA.value = ''
    playerB.value = ''
  } catch (e: any) {
    addError.value = e.message
  }
  adding.value = false
}
</script>
