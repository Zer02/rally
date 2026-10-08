<template>
  <AppNav />
  <PasswordNudge />
  <RouterView />
  <BottomTabBar />
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import AppNav from '@/components/layout/AppNav.vue'
import PasswordNudge from '@/components/layout/PasswordNudge.vue'
import BottomTabBar from '@/components/layout/BottomTabBar.vue'
import { useAuth } from '@/composables/useAuth'
import { useSport } from '@/composables/useSport'

// v0.0.4.6: Supabase's recovery-link URL detection is async, so on the
// very first page load the router's beforeEach guard can run and finish
// BEFORE isPasswordRecovery flips true — missing that one navigation
// entirely, since nothing re-triggers the guard just because a ref
// changed. This watcher catches that case directly: the instant the
// flag flips, force the redirect, independent of whatever navigation
// already happened.
const router = useRouter()
const { isPasswordRecovery } = useAuth()
watch(isPasswordRecovery, (recovering) => {
  if (recovering && router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login' })
  }
})

// v0.0.5.6: the browser-tab title's emoji follows the current league's sport.
const { sport } = useSport()
watch(sport, (s) => { document.title = `RALLY ${s.emoji}` }, { immediate: true })
</script>
