<!-- HomeFeatures — v0.0.8.6. "Play more. Climb together." and the four things Rally does. -->
<template>
  <section class="features">
    <h2 class="features-title">Play more. <em>Climb together.</em></h2>
    <ul class="grid">
      <li v-for="f in FEATURES" :key="f.title">
        <AppIcon :name="f.icon" :size="30" class="ico" />
        <div><h3>{{ f.title }}</h3><p>{{ f.text }}</p></div>
      </li>
    </ul>
    <p class="tagline"><span /><em>More play. Less work.</em><span /></p>
  </section>
</template>

<script setup lang="ts">
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'racket', title: 'Challenge neighbors', text: 'Pick anyone in your league and set up a match.' },
  { icon: 'chart', title: 'Track your progress', text: 'See ratings, match history and climb the leaderboard.' },
  { icon: 'calendar', title: 'Join round robins', text: 'Weekly and seasonal events for all skill levels.' },
  { icon: 'users', title: 'Build your community', text: 'More courts. More matches. More people.' },
]
</script>

<style scoped>
.features { padding: 2rem 0 1rem; border-top: 1px solid var(--line); margin-top: 1.5rem; }
.features-title { font-size: clamp(1.5rem, 3.4vw, 2rem); margin-bottom: 1.25rem; }
.grid { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5rem; }
.grid li { display: flex; gap: 0.85rem; align-items: flex-start; min-width: 0; }
.ico { color: var(--ball); flex: 0 0 auto; margin-top: 0.15rem; }
.grid h3 { font-size: 0.95rem; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--txt-primary); margin-bottom: 0.25rem; }
.grid p { font-size: 0.85rem; color: var(--txt-secondary); line-height: 1.5; }
.tagline { display: flex; align-items: center; gap: 1rem; justify-content: center; margin: 2.25rem 0 0.5rem; }
.tagline span { flex: 1 1 0; max-width: 9rem; height: 1px; background: var(--ball); opacity: 0.7; }
.tagline em { font-family: var(--font-display); font-size: clamp(1.4rem, 3vw, 1.9rem); color: var(--ball); text-align: center; }
@media (max-width: 800px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
