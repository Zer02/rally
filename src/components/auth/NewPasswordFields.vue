<!--
  NewPasswordFields — v0.0.5.8. "New password" + "Confirm new password" with a
  live checklist under them, shared by the set-password screen (LoginView) and
  the Change password card (Profile). The parent owns both values; it decides
  whether the form can be submitted with passwordIsValid() from authMessages.
-->
<template>
  <div>
    <label class="field-label" :for="`${uid}-new`">New password</label>
    <PasswordInput
      :id="`${uid}-new`"
      name="new-password"
      :model-value="password"
      autocomplete="new-password"
      :placeholder="`At least ${PASSWORD_MIN} characters`"
      :minlength="PASSWORD_MIN"
      @update:model-value="$emit('update:password', $event)"
    />

    <label class="field-label" style="margin-top:1rem" :for="`${uid}-confirm`">Confirm new password</label>
    <PasswordInput
      :id="`${uid}-confirm`"
      name="confirm-password"
      :model-value="confirm"
      autocomplete="new-password"
      placeholder="Type it again"
      @update:model-value="$emit('update:confirm', $event)"
    />

    <ul class="pw-checks" aria-live="polite">
      <li v-for="c in checks" :key="c.label" :class="c.ok ? 'pw-ok' : 'pw-pending'">
        <span class="pw-mark" aria-hidden="true">{{ c.ok ? '✓' : '•' }}</span>{{ c.label }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import { PASSWORD_MIN, passwordChecks } from '@/lib/authMessages'

const props = defineProps<{ password: string; confirm: string }>()
defineEmits<{ (e: 'update:password', v: string): void; (e: 'update:confirm', v: string): void }>()

// Two of these can be on screen at once in principle; keep ids from colliding.
const uid = `pw${Math.random().toString(36).slice(2, 8)}`
const checks = computed(() => passwordChecks(props.password, props.confirm))
</script>

<style scoped>
.pw-checks { list-style: none; margin: 0.6rem 0 0; padding: 0; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.2rem; }
.pw-ok      { color: var(--net); }
.pw-pending { color: var(--txt-muted); }
.pw-mark    { display: inline-block; width: 1.1rem; }
</style>
