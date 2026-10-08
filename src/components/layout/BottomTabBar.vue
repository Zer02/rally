<!--
  BottomTabBar — v0.0.6.7. The five pages people use most, one tap away at
  the bottom of the screen on a phone (the top bar and its menu stay; the
  menu still holds Challenge, Referee and Sign out). Signed-out visitors get
  the three public pages plus Sign in.

  Phones only (<= 700px): on a wider screen the top bar already shows every
  link, so this renders nothing there (display: none in CSS, not v-if, so the
  layout never jumps on rotate/resize).

  Two details that matter on a real phone:
    - Hidden while a text box or dropdown has focus. A fixed bar otherwise
      floats on top of the on-screen keyboard and eats the space needed to type
      a score.
    - Adds the `has-tabbar` class to <body> so pages get bottom padding and the
      last card is never hidden behind the bar.
-->
<template>
  <nav v-if="visible" class="tabbar" :class="{ typing }" aria-label="Main">
    <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" active-class="active">
      <svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="t.icon" />
      <span class="tab-label">{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

// Feather icons (MIT), inlined so there is nothing to download.
const ICONS = {
  leaderboard: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  matches:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  roundrobin:  '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  progress:    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  profile:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  signin:      '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
}

const { isAuthed, isPasswordRecovery } = useAuth()
const route = useRoute()

const tabs = computed(() => [
  { to: '/leaderboard', label: 'Leaderboard',  icon: ICONS.leaderboard },
  { to: '/matches',     label: 'Matches',      icon: ICONS.matches },
  { to: '/tournament',  label: 'Round Robin',  icon: ICONS.roundrobin },
  ...(isAuthed.value
    ? [
        { to: '/progress', label: 'Progress', icon: ICONS.progress },
        { to: '/profile',  label: 'Profile',  icon: ICONS.profile },
      ]
    : [{ to: '/login', label: 'Sign in', icon: ICONS.signin }]),
])

// Not on the sign-in / password screens, where it would only be in the way.
const visible = computed(() => route.name !== 'login' && !isPasswordRecovery.value)

watch(visible, (v) => document.body.classList.toggle('has-tabbar', v), { immediate: true })

const typing = ref(false)
let blurTimer: number | undefined
const FIELD = 'input, select, textarea, [contenteditable="true"]'
function onFocusIn(e: FocusEvent) {
  if ((e.target as Element | null)?.matches?.(FIELD)) { window.clearTimeout(blurTimer); typing.value = true }
}
function onFocusOut() {
  // A short delay so tabbing from one box to the next does not flash the bar.
  window.clearTimeout(blurTimer)
  blurTimer = window.setTimeout(() => { typing.value = !!document.activeElement?.matches?.(FIELD) }, 120)
}
onMounted(() => { document.addEventListener('focusin', onFocusIn); document.addEventListener('focusout', onFocusOut) })
onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut)
  window.clearTimeout(blurTimer); document.body.classList.remove('has-tabbar')
})
</script>

<style scoped>
.tabbar { display: none; }

@media (max-width: 700px) {
  .tabbar {
    display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
    background: rgba(14,17,23,0.94); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .tabbar.typing { display: none; }
  .tab {
    flex: 1 1 0; min-width: 0; min-height: 3.5rem;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.15rem;
    color: var(--txt-secondary); -webkit-tap-highlight-color: transparent;
    transition: color 0.15s;
  }
  .tab:active { color: var(--txt-primary); }
  .tab.active { color: var(--ball); }
  .tab-label { font-size: 0.64rem; font-weight: 500; letter-spacing: 0.02em; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 0.15rem; }
}
/* Very small phones (320px): five labels share 64px each, so "Leaderboard" and
   "Round Robin" need a touch less size and spacing to stay whole. */
@media (max-width: 360px) {
  .tab-label { font-size: 0.58rem; letter-spacing: 0; padding: 0; }
}
</style>
