<!-- src/views/HomeView.vue — v0.0.7.6
     Two homes in one route: players see their own day (HomeDashboard: rank, this week's
     matches, level), visitors see a short welcome (HomeWelcome). Nothing is shown while
     the session is still being worked out, so a signed-in player never sees the visitor page flash by. -->
<template>
  <main class="page home">
    <div class="container">
      <HomeDashboard v-if="isAuthed" />
      <HomeWelcome v-else-if="!loading" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
import HomeDashboard from '@/components/home/HomeDashboard.vue'
import HomeWelcome from '@/components/home/HomeWelcome.vue'

const { isAuthed, loading } = useAuth()
</script>
