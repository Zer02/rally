<template>
  <div v-if="placeholders.length" class="card placeholder-panel" style="padding:1.25rem">
    <div class="field-label" style="margin-bottom:0.4rem">Placeholder players</div>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Added by name only. Send an invite once you have their real email — they'll get a
      link to set a password and log in as themselves.
    </p>

    <div v-for="p in placeholders" :key="p.profile_id" class="placeholder-row">
      <div class="placeholder-name-col">
        <span class="placeholder-name">{{ p.display_name }}</span>
        <span v-if="p.invited_email" class="muted placeholder-invited-note">
          Invited to {{ p.invited_email }} · {{ timeAgo(p.invited_at) }}
        </span>
      </div>

      <template v-if="claimingId === p.profile_id">
        <input
          v-model="claimEmail"
          type="email"
          class="input"
          placeholder="their@email.com"
          style="font-size:0.85rem"
        />
        <button
          class="btn btn-primary"
          style="font-size:0.8rem"
          :disabled="!claimEmail.trim() || claimSubmitting"
          @click="submitClaim(p.profile_id)"
        >
          <span v-if="claimSubmitting" class="spinner" style="width:12px;height:12px;border-width:2px" />
          <span v-else>{{ p.invited_email ? 'Resend invite' : 'Send invite' }}</span>
        </button>
        <button class="btn btn-ghost" style="font-size:0.8rem" @click="claimingId = null; claimEmail = ''">Cancel</button>
      </template>
      <template v-else-if="removingId === p.profile_id">
        <span class="muted" style="font-size:0.8rem">Remove {{ p.display_name }} for good?</span>
        <button
          class="btn btn-danger"
          style="font-size:0.8rem"
          :disabled="removeSubmitting"
          @click="submitRemove(p.profile_id)"
        >
          <span v-if="removeSubmitting" class="spinner" style="width:12px;height:12px;border-width:2px" />
          <span v-else>Yes, remove</span>
        </button>
        <button class="btn btn-ghost" style="font-size:0.8rem" @click="removingId = null">Cancel</button>
      </template>
      <template v-else>
        <button
          class="btn btn-ghost"
          style="font-size:0.8rem"
          @click="claimingId = p.profile_id; claimEmail = p.invited_email || ''; claimError = ''"
        >
          {{ p.invited_email ? 'Resend / fix email' : 'Send invite' }}
        </button>
        <button class="btn btn-ghost" style="font-size:0.8rem" @click="removingId = p.profile_id; removeError = ''">
          Remove
        </button>
      </template>
    </div>

    <p v-if="claimError" class="flash flash-error" style="margin-top:0.75rem">{{ claimError }}</p>
    <p v-if="claimSuccess" class="flash flash-success" style="margin-top:0.75rem">{{ claimSuccess }}</p>
    <p v-if="removeError" class="flash flash-error" style="margin-top:0.75rem">{{ removeError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayersStore } from '@/stores/players'

const playersStore = usePlayersStore()

const claimingId     = ref<string | null>(null)
const claimEmail     = ref('')
const claimSubmitting = ref(false)
const claimError     = ref('')
const claimSuccess   = ref('')

const removingId       = ref<string | null>(null)
const removeSubmitting = ref(false)
const removeError      = ref('')

const placeholders = computed(() =>
  playersStore.players
    .filter(p => p.profile?.is_placeholder)
    .map(p => ({
      profile_id: p.profile_id,
      display_name: p.profile?.display_name || p.profile?.username || 'Unknown',
      invited_email: p.profile?.invited_email || null,
      invited_at: p.profile?.invited_at || null,
    }))
)

function timeAgo(isoDate: string | null): string {
  if (!isoDate) return ''
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

async function submitClaim(profileId: string) {
  const email = claimEmail.value.trim()
  if (!email) return
  claimSubmitting.value = true
  claimError.value = ''
  claimSuccess.value = ''
  try {
    await playersStore.claimPlaceholderPlayer(profileId, email)
    claimSuccess.value = `Invite sent to ${email} — they'll get a link to set a password.`
    claimingId.value = null
    claimEmail.value = ''
  } catch (e: any) {
    claimError.value = e.message
  }
  claimSubmitting.value = false
}

async function submitRemove(profileId: string) {
  removeSubmitting.value = true
  removeError.value = ''
  try {
    await playersStore.deletePlaceholderPlayer(profileId)
    removingId.value = null
  } catch (e: any) {
    removeError.value = e.message
  }
  removeSubmitting.value = false
}
</script>

<style scoped>
.placeholder-row {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0; border-top: 1px solid var(--line);
}
.placeholder-row:first-of-type { border-top: none; }
.placeholder-name-col { display: flex; flex-direction: column; gap: 0.15rem; min-width: 100px; flex: 1; }
.placeholder-name { font-size: 0.85rem; font-weight: 500; }
.placeholder-invited-note { font-size: 0.72rem; }
.placeholder-row .input { flex: 1; min-width: 160px; padding: 0.4rem 0.6rem; }
</style>
