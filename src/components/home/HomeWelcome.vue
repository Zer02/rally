<!--
  HomeWelcome — v0.0.7.6. What a visitor (not signed in) sees: a short pitch, two buttons and
  three one-line steps. (No standings preview on purpose: a brand-new visitor has no league
  picked yet, so there is nothing to show.)
-->
<template>
  <section class="welcome">
    <p class="eyebrow">{{ leagueName }}</p>
    <h1>Track every rally.<br /><em>Own the {{ sport.surface }}.</em></h1>
    <p class="welcome-sub">
      Live ratings for everyone in the building. Challenge neighbors, log scores, climb the leaderboard.
    </p>
    <div class="welcome-cta">
      <RouterLink to="/login" class="btn btn-primary">Join the league</RouterLink>
      <RouterLink to="/leaderboard" class="btn btn-ghost">View standings</RouterLink>
    </div>
  </section>

  <section class="steps">
    <h3 class="steps-title">How it works</h3>
    <ol>
      <li>
        <span class="step-icon">{{ sport.emoji }}</span>
        <div><h4>Play</h4><p>Challenge a neighbor or join the weekly round robin, then log the score.</p></div>
      </li>
      <li>
        <span class="step-icon">📈</span>
        <div><h4>Live ratings</h4><p>Ratings move fast while the system learns your level, then settle. Hot streaks earn a bonus.</p></div>
      </li>
      <li>
        <span class="step-icon">📊</span>
        <div><h4>Full history</h4><p>Head-to-head records, match history and a rating graph for every player.</p></div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { useSport } from '@/composables/useSport'

const { sport, leagueName } = useSport()
</script>

<style scoped>
.welcome { padding: 0.5rem 0 1.5rem; max-width: 620px; }
.welcome h1 { margin: 0.75rem 0 1rem; }
.welcome h1 em { font-style: italic; color: var(--ball); }
.welcome-sub { font-size: 1.05rem; color: var(--txt-secondary); line-height: 1.65; margin-bottom: 1.5rem; max-width: 480px; }
.welcome-cta { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.welcome-cta .btn { font-size: 1rem; padding: 0.7rem 1.5rem; display: inline-flex; align-items: center; justify-content: center; }

.steps { max-width: 620px; padding-bottom: 1rem; }
.steps-title { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--txt-muted); margin-bottom: 0.75rem; }
.steps ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.9rem; }
.steps li { display: flex; gap: 0.9rem; align-items: flex-start; }
.step-icon { flex: 0 0 2.25rem; height: 2.25rem; display: grid; place-items: center; font-size: 1.15rem; background: var(--table-mid); border: 1px solid var(--line); border-radius: var(--radius-md); }
.steps h4 { font-size: 0.95rem; font-weight: 600; color: var(--txt-primary); margin-bottom: 0.15rem; }
.steps p { font-size: 0.85rem; color: var(--txt-secondary); line-height: 1.55; }

@media (max-width: 600px) {
  .welcome { padding-bottom: 1.25rem; }
  .welcome-cta { display: grid; grid-template-columns: 1fr 1fr; }
  .welcome-cta .btn { padding: 0.75rem 0.5rem; text-align: center; }
}
</style>
