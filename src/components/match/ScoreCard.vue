<!--
  ScoreCard — v0.0.5.4. A match drawn like a scoreboard: one row per side, the
  winner's row lit up (green edge, bold name, check badge) and the loser's
  dimmed, so who won reads at a glance instead of from a tiny score under a
  "completed" pill. Used for ladder matches (per-game scores) and round robin
  matches (games won, singles or doubles).

  Purely presentational — MatchCard and MatchesView work out the sides.
-->
<template>
  <div class="sc card" :class="[result ? `sc-${result}` : '', { 'sc-done': done }]">
    <div class="sc-head">
      <span v-if="result" class="sc-result" :class="`sc-result-${result}`">
        {{ result === 'win' ? 'You won' : 'You lost' }}
      </span>
      <span v-else-if="status" class="status" :class="`status-${status}`">{{ status }}</span>
      <span v-if="meta" class="sc-meta">{{ meta }}</span>
      <span class="sc-when">{{ when }}</span>
      <!-- Optional control at the far right of the header, e.g. the admin's remove "x" (v0.0.6.6) -->
      <slot name="head-action" />
    </div>

    <div
      v-for="(side, i) in sides"
      :key="i"
      class="sc-row"
      :class="{ 'sc-winner': done && side.isWinner, 'sc-loser': done && !side.isWinner }"
    >
      <div class="sc-avatars">
        <PlayerAvatar
          v-for="(n, k) in side.names.slice(0, 2)"
          :key="k"
          :name="n"
          :size="side.names.length > 1 ? 26 : 32"
          :class="{ 'sc-avatar-2': k === 1 }"
        />
      </div>

      <div class="sc-who">
        <div class="sc-name">
          <span class="sc-name-text">{{ side.names.join(' & ') }}</span>
          <span v-if="done && side.isWinner" class="sc-check" title="Winner" aria-label="Winner">✓</span>
          <span v-if="side.isMe" class="sc-you">you</span>
        </div>
        <div v-if="side.unit || side.points != null || side.delta != null" class="sc-sub">
          <span v-if="side.unit">{{ side.unit }}</span>
          <span v-if="side.points != null" class="sc-pts" :title="`${side.points} round robin points from this match`">+{{ side.points }} {{ side.points === 1 ? 'pt' : 'pts' }}</span>
          <span
            v-if="side.delta != null"
            class="sc-delta"
            :class="side.delta >= 0 ? 'sc-delta-pos' : 'sc-delta-neg'"
          >{{ side.delta >= 0 ? '+' : '−' }}{{ Math.abs(side.delta).toFixed(1) }} rating</span>
        </div>
      </div>

      <div v-if="done && side.games" class="sc-games">
        <span
          v-for="(g, k) in side.games"
          :key="k"
          class="sc-game"
          :class="{ 'sc-game-won': g > (sides[1 - i].games?.[k] ?? -1) }"
        >{{ g }}</span>
      </div>
      <div v-if="done && side.total != null" class="sc-total">{{ side.total }}</div>
    </div>

    <slot name="footer" />
  </div>
</template>

<script setup lang="ts">
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'

export interface ScoreSide {
  names:    string[]            // one name (singles) or two (doubles)
  unit?:    string | null
  delta?:   number | null       // rating change from this match, if known
  points?:  number | null       // round robin points earned (v0.0.6.3); null = none, e.g. challenges
  isWinner: boolean
  isMe:     boolean
  games?:   number[] | null     // per-game scores (ladder), if recorded
  total?:   number | null       // games won — the big number on the right
}

defineProps<{
  sides:   [ScoreSide, ScoreSide]
  done:    boolean              // completed → show scores and the winner styling
  when:    string
  meta?:   string | null        // e.g. "Season 3" or "Ladder"
  status?: string | null        // shown as a pill when not completed
  result?: 'win' | 'loss' | null // relative to the signed-in player
}>()
</script>

<style scoped>
.sc { padding: 0.6rem 0.75rem 0.7rem; border-left: 3px solid var(--line); }
.sc-win  { border-left-color: var(--net); }
.sc-loss { border-left-color: var(--ace); }

.sc-head { display: flex; align-items: center; gap: 0.5rem; padding: 0 0.25rem 0.45rem; min-height: 1.6rem; }
.sc-result { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.sc-result-win  { color: var(--net); }
.sc-result-loss { color: var(--ace); }
.sc-meta { font-size: 0.72rem; color: var(--txt-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sc-when { margin-left: auto; font-size: 0.72rem; color: var(--txt-muted); white-space: nowrap; }

.sc-row {
  display: flex; align-items: center; gap: 0.7rem;
  padding: 0.5rem 0.5rem;
  border-radius: var(--radius-sm);
}
.sc-row + .sc-row { margin-top: 2px; }
.sc-winner { background: rgba(76,175,138,0.10); }
.sc-loser  { opacity: 0.62; }

.sc-avatars { display: flex; flex-shrink: 0; }
.sc-avatar-2 { margin-left: -9px; box-shadow: 0 0 0 2px var(--table-mid); }

.sc-who { flex: 1; min-width: 0; }
.sc-name { display: flex; align-items: center; gap: 0.4rem; min-width: 0; font-size: 0.925rem; font-weight: 500; color: var(--txt-secondary); }
.sc-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-winner .sc-name { color: var(--txt-primary); font-weight: 600; }
.sc-check {
  flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%;
  background: var(--net); color: #0e1117; font-size: 0.65rem; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.sc-you { flex-shrink: 0; font-size: 0.62rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ball); border: 1px solid rgba(232,200,74,0.4); border-radius: 999px; padding: 0 0.35rem; }

.sc-sub { display: flex; gap: 0.6rem; font-size: 0.72rem; color: var(--txt-muted); }
.sc-pts { font-family: var(--font-mono); color: var(--txt-secondary); }
.sc-winner .sc-pts { color: var(--txt-primary); }
.sc-delta { font-family: var(--font-mono); }
.sc-delta-pos { color: var(--net); }
.sc-delta-neg { color: var(--ace); }

.sc-games { display: flex; gap: 0.25rem; flex-shrink: 0; }
.sc-game { min-width: 1.6rem; text-align: center; font-family: var(--font-mono); font-size: 0.8rem; color: var(--txt-muted); }
.sc-game-won { color: var(--txt-primary); font-weight: 600; }

.sc-total {
  flex-shrink: 0; min-width: 1.75rem; text-align: right;
  font-family: var(--font-mono); font-size: 1.35rem; font-weight: 500; color: var(--txt-secondary);
}
.sc-winner .sc-total { color: var(--txt-primary); }

@media (max-width: 600px) {
  /* v0.0.6.5: long player names wrap instead of ending in "…" */
  .sc-name-text { white-space: normal; overflow-wrap: break-word; }
}

@media (max-width: 420px) {
  .sc-game { min-width: 1.3rem; font-size: 0.75rem; }
  .sc-row { gap: 0.55rem; padding: 0.5rem 0.35rem; }
}
</style>
