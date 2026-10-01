<!--
  ChangePasswordForm — v0.0.5.8. Change your password while signed in (Profile).

  Asks for the current password first, unless the account doesn't have one yet:
  a player an admin invited by email is signed in by the emailed link but has
  never chosen a password, so there's nothing to check and the field is hidden.
  Saving clears the "invited player" flag either way (see updatePassword()).
-->
<template>
  <form class="card cpw" @submit.prevent="submit">
    <template v-if="!saved">
      <h3 class="cpw-title">{{ hasNoPassword ? 'Set a password' : 'Change password' }}</h3>
      <p v-if="hasNoPassword" class="muted cpw-note">
        You signed in from an email link, so this account doesn't have a password yet.
        Set one now so you can sign back in later.
      </p>

      <div v-if="!hasNoPassword" style="margin-bottom:1rem">
        <label class="field-label" for="cpw-current">Current password</label>
        <PasswordInput id="cpw-current" v-model="current" name="current-password" autocomplete="current-password" />
      </div>

      <NewPasswordFields v-model:password="next" v-model:confirm="confirm" />

      <p v-if="error" class="flash flash-error" style="margin-top:1rem">{{ error }}</p>

      <div class="cpw-actions">
        <button type="submit" class="btn btn-primary" :disabled="busy || !canSubmit">
          <span v-if="busy" class="spinner" style="width:14px;height:14px;border-width:2px" />
          <span v-else>{{ hasNoPassword ? 'Set password' : 'Update password' }}</span>
        </button>
        <button type="button" class="btn btn-ghost" @click="$emit('close')">Cancel</button>
      </div>
    </template>

    <div v-else class="cpw-done">
      <p class="cpw-done-title">Password updated</p>
      <p class="muted" style="font-size:0.85rem;margin-bottom:1rem">You're all set. Use the new password next time you sign in.</p>
      <button type="button" class="btn btn-ghost" @click="$emit('close')">Close</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuth } from '@/composables/useAuth'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import NewPasswordFields from '@/components/auth/NewPasswordFields.vue'
import { friendlyAuthError, passwordIsValid } from '@/lib/authMessages'

defineEmits<{ (e: 'close'): void }>()

const { profile, changePassword } = useAuth()

const current = ref('')
const next    = ref('')
const confirm = ref('')
const busy    = ref(false)
const error   = ref('')
const saved   = ref(false)

const hasNoPassword = computed(() => !!(profile.value as any)?.is_placeholder)
const canSubmit = computed(() =>
  passwordIsValid(next.value, confirm.value) && (hasNoPassword.value || current.value.length > 0)
)

async function submit() {
  if (!canSubmit.value) return
  busy.value = true; error.value = ''
  const err = await changePassword(hasNoPassword.value ? null : current.value, next.value)
  busy.value = false
  if (err) { error.value = friendlyAuthError(err.message); return }
  current.value = next.value = confirm.value = ''
  saved.value = true
}
</script>

<style scoped>
.cpw { padding: 1.25rem; margin-bottom: 1.5rem; max-width: 420px; }
.cpw-title { font-family: var(--font-display); font-size: 1.25rem; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--txt-primary); margin-bottom: 0.5rem; }
.cpw-note  { font-size: 0.82rem; margin-bottom: 1rem; }
.cpw-actions { display: flex; gap: 0.6rem; margin-top: 1.25rem; }
.cpw-done  { text-align: center; padding: 0.5rem 0; }
.cpw-done-title { font-family: var(--font-display); font-size: 1.2rem; color: var(--net); margin-bottom: 0.3rem; }
</style>
