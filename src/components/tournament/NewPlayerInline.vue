<!-- src/components/tournament/NewPlayerInline.vue — v0.0.4.7
     Extracted out of AttendeePicker.vue so a genuinely new player (never
     in the league roster before, not just not-yet-in-this-season) can be
     added from anywhere admins pick players — starting a week, generating
     courts, or adding a single match mid-week. Backed by the same
     create-placeholder-player Edge Function either way; this component
     just handles the "+ Someone new showed up" toggle and hands the new
     profile_id back to whichever parent embeds it. -->
<template>
  <div v-if="!open" style="margin-top:0.6rem">
    <button type="button" class="btn btn-ghost" style="font-size:0.8rem" @click="open = true">
      + Someone new showed up
    </button>
  </div>
  <form v-else class="new-player-form" @submit.prevent="submit">
    <input v-model="name" class="input" placeholder="Their name" style="font-size:0.85rem" required />
    <button type="submit" class="btn btn-primary" style="font-size:0.8rem" :disabled="submitting || !name.trim()">
      <span v-if="submitting" class="spinner" style="width:12px;height:12px;border-width:2px" />
      <span v-else>Add</span>
    </button>
    <button type="button" class="btn btn-ghost" style="font-size:0.8rem" @click="cancel">Cancel</button>
    <p v-if="error" class="flash flash-error" style="margin-top:0.5rem;width:100%">{{ error }}</p>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { usePlayersStore } from '@/stores/players'

const emit = defineEmits<{ created: [profileId: string] }>()

const playersStore = usePlayersStore()

const open       = ref(false)
const name       = ref('')
const submitting = ref(false)
const error      = ref('')

async function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  submitting.value = true
  error.value = ''
  try {
    const created = await playersStore.createPlaceholderPlayer(trimmed)
    emit('created', created.profile_id)
    name.value = ''
    open.value = false
  } catch (e: any) {
    error.value = e.message
  }
  submitting.value = false
}

function cancel() {
  open.value = false
  name.value = ''
  error.value = ''
}
</script>

<style scoped>
.new-player-form { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-top: 0.6rem; }
.new-player-form .input { flex: 1; min-width: 140px; padding: 0.5rem 0.7rem; }
</style>
