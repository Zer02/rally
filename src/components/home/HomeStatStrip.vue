<!-- HomeStatStrip — v0.0.8.6. Players, matches and the league's day streak, side by side. -->
<template>
  <div class="strip" data-test="stat-strip">
    <div class="cell">
      <AppIcon name="users" :size="30" class="ico" />
      <div class="cell-body">
        <span class="num mono" data-test="stat-players">{{ players }}</span>
        <span class="lbl">Players</span>
      </div>
    </div>
    <div class="cell">
      <AppIcon name="trophy" :size="30" class="ico" />
      <div class="cell-body">
        <span class="num mono" data-test="stat-matches">{{ matches }}</span>
        <span class="lbl">Matches</span>
        <span v-if="matchesWeek > 0" class="delta-line" data-test="stat-week">↑ {{ matchesWeek }} this week</span>
      </div>
    </div>
    <div class="cell">
      <AppIcon name="flame" :size="30" class="ico" />
      <div class="cell-body">
        <span class="num mono" data-test="stat-streak">{{ streak }}</span>
        <span class="lbl">Day streak</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
defineProps<{ players: number; matches: number; matchesWeek: number; streak: number }>()
</script>

<style scoped>
.strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: var(--table-mid); border: 1px solid var(--line); border-radius: var(--radius-md); }
.cell { display: flex; align-items: center; gap: 0.9rem; padding: 1.1rem 1.25rem; min-width: 0; }
.cell + .cell { border-left: 1px solid var(--line); }
.ico { color: var(--ball); flex: 0 0 auto; }
.cell-body { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
.num { font-family: var(--font-mono); font-size: 1.9rem; font-weight: 500; color: var(--txt-primary); }
.lbl { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--txt-secondary); margin-top: 0.15rem; }
.delta-line { font-size: 0.72rem; color: var(--net); margin-top: 0.25rem; }
@media (max-width: 600px) {
  .cell { flex-direction: column; align-items: flex-start; gap: 0.5rem; padding: 0.85rem 0.8rem; }
  .ico { width: 22px; height: 22px; }
  .num { font-size: 1.4rem; }
  .lbl { font-size: 0.6rem; letter-spacing: 0.1em; }
}
</style>
