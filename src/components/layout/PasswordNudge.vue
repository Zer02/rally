<!--
  PasswordNudge — v0.0.5.8. A slim bar under the nav for the one situation
  that otherwise fails silently: an invited player who followed the emailed
  link, got signed in, and closed the tab before choosing a password. They can
  use the app until their session ends, then can't get back in. Disappears the
  moment a password is set (updatePassword() clears profiles.is_placeholder).
-->
<template>
  <div v-if="show" class="nudge" role="status">
    <span>You haven't set a password yet. Set one so you can sign back in.</span>
    <RouterLink :to="{ name: 'profile', query: { password: '1' } }" class="nudge-link">Set password</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '@/composables/useAuth'

const { isAuthed, profile, isPasswordRecovery } = useAuth()
const show = computed(() =>
  isAuthed.value && !isPasswordRecovery.value && !!(profile.value as any)?.is_placeholder
)
</script>

<style scoped>
.nudge {
  display: flex; align-items: center; justify-content: center; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.55rem 1rem; font-size: 0.82rem; text-align: center;
  background: rgba(232,200,74,0.10); border-bottom: 1px solid rgba(232,200,74,0.3); color: var(--txt-secondary);
}
.nudge-link { color: var(--ball); font-weight: 600; text-decoration: none; white-space: nowrap; }
.nudge-link:hover { text-decoration: underline; }
</style>
