<template>
  <AppNav />
  <RouterView />
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import AppNav from '@/components/layout/AppNav.vue'
import { useAuth } from '@/composables/useAuth'

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
</script>
