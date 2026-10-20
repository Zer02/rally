<!-- HomeSeasonCard — v0.0.8.6. What the round robin is doing right now: the season, the week, and how
     many matches are played. Only what the app really knows; there are no scheduled sessions. -->
<template>
  <section class="card panel" data-test="season-summary">
    <header class="panel-head">
      <h2 class="card-title">{{ season ? 'This week’s round robin' : 'Round robin' }}</h2>
      <RouterLink to="/tournament" class="panel-link">View details <AppIcon name="arrow" :size="14" /></RouterLink>
    </header>
    <ul v-if="season" class="facts">
      <li><AppIcon name="calendar" :size="20" /><span data-test="season-name">{{ season.name }}<template v-if="season.weekNumber"> · Week {{ season.weekNumber }}</template></span></li>
      <li><AppIcon name="users" :size="20" /><span data-test="season-players">{{ season.players }} {{ season.players === 1 ? 'player' : 'players' }} this week</span></li>
      <li><AppIcon name="list" :size="20" /><span data-test="season-played">{{ season.played }} of {{ season.total }} matches played</span></li>
    </ul>
    <p v-else class="muted empty">No season is running yet. When your league starts one, its week shows up here.</p>
    <RouterLink to="/tournament" class="btn btn-primary cta">{{ season ? 'Open round robin' : 'See round robin' }}</RouterLink>
  </section>
</template>

<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SeasonSummary } from '@/composables/useHomeData'
defineProps<{ season: SeasonSummary | null }>()
</script>

<style scoped>
.panel { padding: 1.25rem 1.4rem; min-width: 0; display: flex; flex-direction: column; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 1rem; }
.panel-link { white-space: nowrap; display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.82rem; color: var(--txt-primary); }
.panel-link:hover { color: var(--ball); }
.facts { list-style: none; display: flex; flex-direction: column; gap: 0.85rem; margin: 0 0 1.25rem; }
.facts li { display: flex; align-items: center; gap: 0.8rem; color: var(--txt-primary); font-size: 0.95rem; min-width: 0; }
.facts li :deep(svg) { color: var(--ball); flex: 0 0 auto; }
.facts span { min-width: 0; overflow-wrap: anywhere; }
.empty { font-size: 0.9rem; margin: 0 0 1.25rem; line-height: 1.55; }
.cta { margin-top: auto; justify-content: center; padding: 0.8rem 1rem; font-size: 0.95rem; }
</style>
