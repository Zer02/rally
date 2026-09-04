<template>
  <nav class="nav">
    <div class="nav-inner container">
      <RouterLink to="/" class="nav-logo" @click="menuOpen = false">RALLY 🏓</RouterLink>

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

      <button
        class="nav-burger"
        :class="{ open: menuOpen }"
        aria-label="Toggle menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span /><span /><span />
      </button>
    </div>

    <Transition name="nav-drop">
      <div v-if="menuOpen" class="nav-drop">
        <RouterLink to="/leaderboard" class="nav-drop-link" @click="menuOpen = false">Leaderboard</RouterLink>
        <RouterLink to="/matches"     class="nav-drop-link" @click="menuOpen = false">Matches</RouterLink>

        <template v-if="isAuthed">
          <RouterLink to="/challenge" class="nav-drop-link" @click="menuOpen = false">Challenge</RouterLink>
          <RouterLink to="/profile"   class="nav-drop-link" @click="menuOpen = false">Profile</RouterLink>
          <button class="btn btn-ghost btn-sm nav-drop-signout" @click="handleSignOut">Sign out</button>
        </template>
        <template v-else>
          <RouterLink to="/login" class="btn btn-primary btn-sm nav-drop-signout" @click="menuOpen = false">Sign in</RouterLink>
        </template>
      </div>
    </Transition>
  </nav>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useRouter } from 'vue-router'

const { isAuthed, signOut } = useAuth()
const router = useRouter()
const menuOpen = ref(false)

// close the mobile menu on any route change
watch(() => router.currentRoute.value.fullPath, () => { menuOpen.value = false })

async function handleSignOut() {
  await signOut()
  menuOpen.value = false
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
  white-space: nowrap;
  flex-shrink: 0;
}
.nav-links { display: flex; align-items: center; gap: 1.25rem; }
.nav-link {
  font-size: 0.875rem; font-weight: 500;
  color: var(--txt-secondary);
  transition: color 0.15s;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.nav-link:hover,
.nav-link.router-link-active { color: var(--txt-primary); }

.nav-burger {
  display: none;
  flex-direction: column; justify-content: center; gap: 4px;
  width: 34px; height: 34px; padding: 0; margin-left: 0.5rem;
  background: transparent; border: none; cursor: pointer; flex-shrink: 0;
}
.nav-burger span {
  display: block; width: 100%; height: 2px; border-radius: 2px;
  background: var(--txt-primary); transition: transform 0.2s, opacity 0.2s;
}
.nav-burger.open span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.nav-burger.open span:nth-child(2) { opacity: 0; }
.nav-burger.open span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

.nav-drop {
  display: none;
  flex-direction: column;
  border-top: 1px solid var(--line);
  background: var(--table-mid);
  padding: 0.5rem 1rem 0.85rem;
}
.nav-drop-link {
  padding: 0.7rem 0.25rem;
  font-size: 0.9rem; font-weight: 500;
  color: var(--txt-secondary);
  border-bottom: 1px solid var(--line);
}
.nav-drop-link:last-of-type { border-bottom: none; }
.nav-drop-link.router-link-active { color: var(--txt-primary); }
.nav-drop-signout { margin-top: 0.6rem; align-self: flex-start; }

.nav-drop-enter-active, .nav-drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.nav-drop-enter-from, .nav-drop-leave-to { opacity: 0; transform: translateY(-6px); }

@media (max-width: 600px) {
  .nav-inner { height: auto; padding: 0.6rem 1rem; }
  .nav-logo { font-size: 1.05rem; margin-right: auto; }
  .nav-links { display: none; }
  .nav-burger { display: flex; }
  .nav-drop { display: flex; }
}
</style>
