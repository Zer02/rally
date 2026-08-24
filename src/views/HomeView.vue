<template>
  <main class="page">
    <div class="container">
      <section class="hero">
        <p class="eyebrow">Building Ping Pong</p>
        <h1>Track every rally.<br /><em>Own the table.</em></h1>
        <p class="hero-sub">
          Live ratings for everyone in the building. Challenge neighbors, log scores,
          climb the leaderboard.
        </p>
        <div class="hero-cta">
          <RouterLink to="/leaderboard" class="btn btn-primary" style="font-size:1rem;padding:0.7rem 1.75rem">
            View standings →
          </RouterLink>
          <RouterLink v-if="!isAuthed" to="/login" class="btn btn-ghost" style="font-size:1rem;padding:0.7rem 1.75rem">
            Join the league
          </RouterLink>
          <RouterLink v-else to="/challenge" class="btn btn-ghost" style="font-size:1rem;padding:0.7rem 1.75rem">
            Challenge someone
          </RouterLink>
        </div>
      </section>

      <div class="divider" style="margin:3.5rem 0" />

      <section class="features">
        <div class="feature-grid">
          <div class="feature card">
            <span class="feature-icon">🏓</span>
            <h4>Challenge flow</h4>
            <p>Send a challenge, your neighbor accepts, play the match, log the score. Both players see the rating update instantly.</p>
          </div>
          <div class="feature card">
            <span class="feature-icon">📈</span>
            <h4>Live ratings</h4>
            <p>Ratings move faster early on as the system learns your level, then stabilise. Streak bonuses reward hot runs.</p>
          </div>
          <div class="feature card">
            <span class="feature-icon">📊</span>
            <h4>Full history</h4>
            <p>Head-to-head records, match history, and a rating graph for every player in the building.</p>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
const { isAuthed } = useAuth()
</script>

<style scoped>
.hero { padding: 5rem 0 3rem; max-width: 620px; }
.hero h1 { margin: 0.75rem 0 1.25rem; }
.hero h1 em { font-style: italic; color: var(--ball); }
.hero-sub { font-size: 1.05rem; color: var(--txt-secondary); line-height: 1.7; margin-bottom: 1.75rem; max-width: 480px; }
.hero-cta { display: flex; gap: 0.875rem; flex-wrap: wrap; }
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 1rem; padding-bottom: 3rem; }
.feature { padding: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
.feature-icon { font-size: 1.5rem; }
.feature h4 { font-size: 0.95rem; font-weight: 600; color: var(--txt-primary); }
.feature p  { font-size: 0.85rem; color: var(--txt-secondary); line-height: 1.6; }
</style>
