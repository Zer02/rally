<!--
  PointsKey — v0.0.6.2. A small collapsible "How points work" key, shown
  under the round robin tables (Round Robin page and the leaderboard's
  season views — not the all-time view, which has no match points).
  The numbers mirror rr_match_points() in supabase-migration-v0.0.6.2.sql;
  if the rule changes, change both.
-->
<template>
  <details class="points-key card">
    <summary>How points work</summary>
    <div class="points-key-body">
      <table class="table points-key-table">
        <thead><tr><th>Result</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>Win</td><td class="mono">4</td></tr>
          <tr><td>Lose 3–4</td><td class="mono">3</td></tr>
          <tr><td>Lose 2–4</td><td class="mono">2</td></tr>
          <tr><td>Lose 0–4 or 1–4</td><td class="mono">1</td></tr>
        </tbody>
      </table>
      <ul class="points-key-notes muted">
        <li>A loss earns the games you won, never less than 1 and never more than 3.</li>
        <li>Doubles: both partners earn their side's points.</li>
        <li>Ranking: total points, then wins, then games won.</li>
        <li>Challenge matches earn no points.</li>
        <li>Every match played earns something, so playing more adds up.</li>
      </ul>
    </div>
  </details>
</template>

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
