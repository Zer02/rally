<!--
  PointsKey — v0.0.6.8. A small collapsible "How points work" key, shown
  under the round robin tables (Round Robin page and the leaderboard's
  season views — not the all-time view, which has no match points).
  The numbers come from rrMatchPoints()/rrMatchXp() in src/lib/score.ts, which
  mirror rr_match_points() in supabase-migration-v0.0.6.4.sql; if the rule
  changes, change both.
-->
<template>
  <details class="points-key card">
    <summary>How points work</summary>
    <div class="points-key-body">
      <table class="table points-key-table">
        <thead><tr><th>Result</th><th>Points</th><th>XP</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.label">
            <td>{{ r.label }}</td>
            <td class="mono">{{ r.points }}</td>
            <td class="mono">{{ r.xp }}</td>
          </tr>
        </tbody>
      </table>
      <ul class="points-key-notes muted">
        <li>A match is first to {{ GAMES_TO_WIN }} games. A loss earns the games you won, up to {{ LOSS_MAX_POINTS }}. A 0–{{ GAMES_TO_WIN }} loss earns nothing.</li>
        <li>Doubles: both partners earn their side's points.</li>
        <li>Ranking: total points, then wins, then games won.</li>
        <li>Challenge matches earn no points.</li>
        <li>XP is the battle pass reward for the match. After 5 matches in a week, each one earns a little less.</li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import { GAMES_TO_WIN, LOSS_MAX_POINTS, rrMatchPoints, rrMatchXp } from '@/lib/score'

// One row for a win, then one row per distinct loss value, walking down from the
// closest loss. Losses that earn the same are merged ("Lose 3–6 to 5–6").
const N = GAMES_TO_WIN
const rows: { label: string; points: number; xp: number }[] = [
  { label: 'Win', points: rrMatchPoints(N, 0), xp: rrMatchXp(N, 0) },
]
const grouped: { hi: number; lo: number }[] = []
for (let g = N - 1; g >= 0; g--) {
  const last = grouped[grouped.length - 1]
  if (last && rrMatchPoints(last.lo, N) === rrMatchPoints(g, N)) last.lo = g
  else grouped.push({ hi: g, lo: g })
}
for (const { hi, lo } of grouped) {
  rows.push({
    label: lo === hi ? `Lose ${lo}–${N}` : `Lose ${lo}–${N} to ${hi}–${N}`,
    points: rrMatchPoints(hi, N),
    xp: rrMatchXp(hi, N),
  })
}
</script>

<style scoped>
.points-key { margin-top: 1rem; padding: 0.75rem 1rem; }
.points-key summary {
  cursor: pointer; font-size: 0.85rem; font-weight: 500; color: var(--txt-primary);
  list-style: none;
}
.points-key summary::-webkit-details-marker { display: none; }
.points-key summary::before { content: '▸'; display: inline-block; width: 1rem; color: var(--txt-muted); }
.points-key[open] summary::before { content: '▾'; }
.points-key-body { margin-top: 0.75rem; }
.points-key-table { max-width: 20rem; }
.points-key-notes { margin: 0.75rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; line-height: 1.5; }
</style>
