<!--
  PointsKey — v0.0.7.2. A small collapsible "How points work" key, shown
  under the round robin tables (Round Robin page and the leaderboard's
  season views — not the all-time view, which has no match points).
  The numbers come from rrMatchPoints()/rrMatchXp() in src/lib/score.ts, which
  mirror rr_match_points() in supabase/migrations/supabase-migration-v0.0.7.2.sql; if the rule
  changes, change both.
-->
<template>
  <details class="points-key card">
    <summary>How points work</summary>
    <div class="points-key-body">
      <table class="table points-key-table">
        <thead><tr><th>Result</th><th>Points</th><th>XP</th></tr></thead>
        <tbody>
          <tr>
            <td>Win</td>
            <td class="mono">{{ win.points }}</td>
            <td class="mono">{{ win.xp }}</td>
          </tr>
          <template v-for="sec in sections" :key="sec.title">
            <tr class="points-key-section"><th colspan="3">{{ sec.title }}</th></tr>
            <tr v-for="r in sec.rows" :key="sec.title + r.label">
              <td>{{ r.label }}</td>
              <td class="mono">{{ r.points }}</td>
              <td class="mono">{{ r.xp }}</td>
            </tr>
          </template>
        </tbody>
      </table>
      <ul class="points-key-notes muted">
        <li>A match is first to 4 games, or a full set to 6 if you play it out (at 5–5 the next game wins). The score says which it was.</li>
        <li>A win earns {{ win.points }}. A loss earns up to {{ LOSS_MAX_POINTS }}, the closer it was the more: one game short is always {{ LOSS_MAX_POINTS }}, and a 0–4 or 0–6 loss earns nothing.</li>
        <li>Doubles: both partners earn their side's points.</li>
        <li>Ranking: total points, then wins, then games won.</li>
        <li>Challenge matches earn no points.</li>
        <li>XP is the battle pass reward for the match. After 5 matches in a week, each one earns a little less.</li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import { GAME_TARGETS, LOSS_MAX_POINTS, WIN_POINTS, rrMatchPoints, rrMatchXp } from '@/lib/score'

const win = { points: rrMatchPoints(WIN_POINTS, 0), xp: rrMatchXp(WIN_POINTS, 0) }

// For each format, one row per distinct loss value, walking down from the
// closest loss. Losses that earn the same are merged ("Lose 3–6 to 4–6").
type Row = { label: string; points: number; xp: number }
const sections: { title: string; rows: Row[] }[] = GAME_TARGETS.map(N => {
  const grouped: { hi: number; lo: number }[] = []
  for (let g = N - 1; g >= 0; g--) {
    const last = grouped[grouped.length - 1]
    if (last && rrMatchPoints(last.lo, N) === rrMatchPoints(g, N)) last.lo = g
    else grouped.push({ hi: g, lo: g })
  }
  return {
    title: N === 4 ? 'First to 4' : 'Full set to 6',
    rows: grouped.map(({ hi, lo }) => ({
      label: lo === hi ? `Lose ${lo}–${N}` : `Lose ${lo}–${N} to ${hi}–${N}`,
      points: rrMatchPoints(hi, N),
      xp: rrMatchXp(hi, N),
    })),
  }
})
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
.points-key-section th { padding-top: 0.75rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--txt-muted); text-align: left; }
.points-key-notes { margin: 0.75rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; line-height: 1.5; }
</style>
