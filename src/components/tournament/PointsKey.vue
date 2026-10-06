<!--
  PointsKey — v0.0.6.4. A small collapsible "How points work" key, shown
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
        <li>A loss earns the games you won, up to 3. A 0–4 loss earns nothing.</li>
        <li>Doubles: both partners earn their side's points.</li>
        <li>Ranking: total points, then wins, then games won.</li>
        <li>Challenge matches earn no points.</li>
        <li>XP is the battle pass reward for the match. After 5 matches in a week, each one earns a little less.</li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import { rrMatchPoints, rrMatchXp } from '@/lib/score'

const row = (label: string, won: number, lost: number) =>
  ({ label, points: rrMatchPoints(won, lost), xp: rrMatchXp(won, lost) })

const rows = [
  row('Win', 4, 0),
  row('Lose 3–4', 3, 4),
  row('Lose 2–4', 2, 4),
  row('Lose 1–4', 1, 4),
  row('Lose 0–4', 0, 4),
]
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
/* The global mobile .table rule forces min-width: 460px for wide data tables;
   this key is only three short columns, so opt out and let it fit the card. */
.points-key-table { max-width: 20rem; min-width: 0; }
.points-key-notes { margin: 0.75rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; line-height: 1.5; }
</style>
