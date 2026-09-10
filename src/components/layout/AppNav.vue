<template>
  <nav class="nav">
    <div class="nav-inner container">
      <div class="nav-brand">
        <div class="league-switcher" ref="switcherRef">
          <button
            class="league-icon-btn"
            :aria-expanded="leagueMenuOpen"
            aria-label="Switch league"
            @click="leagueMenuOpen = !leagueMenuOpen"
          >{{ leagueStore.currentLeague?.icon ?? '🏆' }}</button>

          <Transition name="nav-drop">
            <div v-if="leagueMenuOpen" class="league-menu">
              <div v-if="leagueStore.myLeagues.length" class="league-menu-section">
                <p class="league-menu-label">Your leagues</p>
                <button
                  v-for="l in leagueStore.myLeagues" :key="l.id"
                  class="league-menu-item"
                  :class="{ active: l.id === leagueStore.currentLeagueId }"
                  @click="selectLeague(l.id)"
                >
                  <span class="league-menu-icon">{{ l.icon }}</span>{{ l.name }}
                </button>
              </div>

              <div v-if="leagueStore.joinableLeagues.length" class="league-menu-section">
                <p class="league-menu-label">Join a league</p>
                <button
                  v-for="l in leagueStore.joinableLeagues" :key="l.id"
                  class="league-menu-item"
                  :disabled="joining === l.id"
                  @click="handleJoin(l.id)"
                >
                  <span class="league-menu-icon">{{ l.icon }}</span>{{ l.name }}
                  <span v-if="joining === l.id" class="spinner" style="width:12px;height:12px;border-width:2px;margin-left:auto" />
                </button>
              </div>

              <div v-if="isAuthed" class="league-menu-section">
                <p class="league-menu-label">New league</p>
                <button v-if="!creating" class="league-menu-item" @click="creating = true">
                  <span class="league-menu-icon">+</span>Create a league
                </button>
                <form v-else class="league-create-form" @submit.prevent="handleCreate">
                  <div style="display:flex;gap:0.4rem">
                    <input v-model="newIcon" class="input league-create-icon" maxlength="4" placeholder="🏆" />
                    <input v-model="newName" class="input" placeholder="League name" required />
                  </div>
                  <input v-model="newSport" class="input" placeholder="sport slug, e.g. tennis" required />
                  <div style="display:flex;gap:0.4rem;margin-top:0.15rem">
                    <button class="btn btn-primary btn-sm" type="submit" :disabled="creatingSubmit" style="flex:1;justify-content:center">
                      <span v-if="creatingSubmit" class="spinner" style="width:12px;height:12px;border-width:2px" />
                      <span v-else>Create</span>
                    </button>
                    <button class="btn btn-ghost btn-sm" type="button" @click="creating = false">Cancel</button>
                  </div>
                </form>
              </div>

              <p v-if="menuError" class="league-menu-error">{{ menuError }}</p>
            </div>
          </Transition>
        </div>

        <RouterLink to="/" class="nav-logo" @click="menuOpen = false">RALLY</RouterLink>
      </div>

      <div class="nav-links">
        <RouterLink to="/leaderboard" class="nav-link">Leaderboard</RouterLink>
        <RouterLink to="/matches"     class="nav-link">Matches</RouterLink>

        <template v-if="isAuthed">
          <RouterLink to="/challenge" class="nav-link">Challenge</RouterLink>
          <RouterLink to="/profile"   class="nav-link">Profile</RouterLink>
          <RouterLink v-if="isAdmin" to="/referee" class="nav-link">Referee</RouterLink>
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
          <RouterLink v-if="isAdmin" to="/referee" class="nav-drop-link" @click="menuOpen = false">Referee</RouterLink>
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
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { useRouter } from 'vue-router'

const { isAuthed, isAdmin, signOut } = useAuth()
const leagueStore = useLeagueStore()
const router = useRouter()

const menuOpen = ref(false)
const leagueMenuOpen = ref(false)
const switcherRef = ref<HTMLElement | null>(null)

const joining = ref<string | null>(null)
const creating = ref(false)
const creatingSubmit = ref(false)
const menuError = ref('')
const newName = ref('')
const newSport = ref('')
const newIcon = ref('')

onMounted(() => {
  leagueStore.fetchAllLeagues()
  if (isAuthed.value) leagueStore.fetchMyLeagues()
  document.addEventListener('click', handleOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})

// Leagues aren't known until auth resolves (fetchMyLeagues needs the
// user id), so re-fetch once sign-in completes rather than only on mount.
watch(isAuthed, (authed) => {
  if (authed) leagueStore.fetchMyLeagues()
})

// close the mobile menu (and league menu) on any route change
watch(() => router.currentRoute.value.fullPath, () => {
  menuOpen.value = false
  leagueMenuOpen.value = false
})

function handleOutsideClick(e: MouseEvent) {
  if (switcherRef.value && !switcherRef.value.contains(e.target as Node)) {
    leagueMenuOpen.value = false
  }
}

function selectLeague(id: string) {
  leagueStore.setCurrentLeague(id)
  leagueMenuOpen.value = false
}

async function handleJoin(id: string) {
  joining.value = id
  menuError.value = ''
  try {
    await leagueStore.joinLeague(id)
    leagueMenuOpen.value = false
  } catch (e: any) {
    menuError.value = e.message
  }
  joining.value = null
}

async function handleCreate() {
  creatingSubmit.value = true
  menuError.value = ''
  try {
    await leagueStore.createLeague(newName.value.trim(), newSport.value.trim(), newIcon.value.trim())
    newName.value = ''
    newSport.value = ''
    newIcon.value = ''
    creating.value = false
    leagueMenuOpen.value = false
  } catch (e: any) {
    menuError.value = e.message
  }
  creatingSubmit.value = false
}

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
.nav-brand { display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
.nav-logo {
  font-family: var(--font-display);
  font-size: 1.3rem;
  color: var(--ball);
  letter-spacing: -0.02em;
  white-space: nowrap;
}

/* ── League switcher ─────────────────────────────────────────── */
.league-switcher { position: relative; }
.league-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  font-size: 1.2rem; line-height: 1;
  background: var(--table-mid); border: 1px solid var(--line);
  border-radius: 50%; cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.league-icon-btn:hover { border-color: var(--ball); transform: translateY(-1px); }

.league-menu {
  position: absolute; top: calc(100% + 8px); left: 0;
  width: 240px; max-width: calc(100vw - 2rem);
  background: var(--table-mid); border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 28px rgba(0,0,0,0.45);
  padding: 0.5rem;
  z-index: 200;
}
.league-menu-section { padding: 0.35rem 0.25rem; }
.league-menu-section + .league-menu-section { border-top: 1px solid var(--line); }
.league-menu-label {
  font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--txt-muted); padding: 0.15rem 0.4rem 0.4rem;
}
.league-menu-item {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  padding: 0.5rem 0.4rem; border-radius: var(--radius-sm);
  background: transparent; border: none; cursor: pointer;
  font-size: 0.85rem; color: var(--txt-secondary); text-align: left;
}
.league-menu-item:hover { background: var(--table-light); color: var(--txt-primary); }
.league-menu-item.active { color: var(--txt-primary); background: rgba(232,200,74,0.08); }
.league-menu-icon { font-size: 1rem; line-height: 1; width: 1.1rem; text-align: center; flex-shrink: 0; }
.league-create-form { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.3rem 0.4rem 0.15rem; }
.league-create-icon { width: 3.5rem; flex-shrink: 0; text-align: center; padding-left: 0.4rem; padding-right: 0.4rem; }
.league-menu-error { font-size: 0.75rem; color: var(--loss, #e0716a); padding: 0.4rem; }

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
  .nav-logo { font-size: 1.05rem; }
  .nav-links { display: none; }
  .nav-burger { display: flex; }
  .nav-drop { display: flex; }
}
</style>
