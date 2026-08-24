<template>
  <nav class="nav">
    <div class="nav-inner container">
      <RouterLink to="/" class="nav-logo">RALLY 🏓</RouterLink>

      <div class="nav-links">
        <RouterLink to="/leaderboard" class="nav-link">Leaderboard</RouterLink>
        <RouterLink to="/matches"     class="nav-link">Matches</RouterLink>

        <template v-if="isAuthed">
          <RouterLink to="/challenge" class="nav-link">Challenge</RouterLink>
          <RouterLink to="/profile"   class="nav-link">Profile</RouterLink>
          <button class="btn btn-ghost btn-sm" @click="handleSignOut">Sign out</button>
        </template>
        <template v-else>
          <RouterLink to="/login" class="btn btn-primary btn-sm">Sign in</RouterLink>
        </template>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
import { useRouter } from 'vue-router'

const { isAuthed, signOut } = useAuth()
const router = useRouter()

async function handleSignOut() {
  await signOut()
  router.push('/')
}
</script>

<style scoped>
.nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(14,17,23,0.88);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.nav-inner {
  display: flex; align-items: center; justify-content: space-between;
  height: 58px;
}
.nav-logo {
  font-family: var(--font-display);
  font-size: 1.3rem;
  color: var(--ball);
  letter-spacing: -0.02em;
}
.nav-links { display: flex; align-items: center; gap: 1.25rem; }
.nav-link {
  font-size: 0.875rem; font-weight: 500;
  color: var(--txt-secondary);
  transition: color 0.15s;
  letter-spacing: 0.02em;
}
.nav-link:hover,
.nav-link.router-link-active { color: var(--txt-primary); }
</style>
