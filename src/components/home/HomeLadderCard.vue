<!-- HomeLadderCard — v0.0.8.6. The top of the ladder: rank, name, rating and this week's change. -->
<template>
  <section class="card panel" data-test="ladder-card">
    <header class="panel-head">
      <h2 class="card-title">The ladder</h2>
      <RouterLink to="/leaderboard" class="panel-link">View all <AppIcon name="arrow" :size="14" /></RouterLink>
    </header>
    <p class="panel-sub">Live rankings for your league.</p>
    <p v-if="!rows.length" class="muted empty">No players on the ladder yet.</p>
    <table v-else class="ladder">
      <thead><tr><th>#</th><th>Player</th><th class="num">Rating</th><th class="num">Change</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.profile_id">
          <td class="rank mono">{{ r.rank }}</td>
          <td>
            <div class="who">
              <span class="av" :style="{ background: colour(r.rank) }" aria-hidden="true">{{ initials(r.name) }}</span>
              <span class="nm">{{ shortName(r.name) }}</span>
            </div>
          </td>
          <td class="num mono">{{ formatRating(r.rating) }}</td>
          <td class="num mono chg" :class="r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'flat'">
            <template v-if="r.change > 0">▲ +{{ r.change }}</template>
            <template v-else-if="r.change < 0">▼ {{ r.change }}</template>
            <template v-else>–</template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatRating, initials, shortName } from '@/lib/homeStats'
import type { LadderRow } from '@/composables/useHomeData'

defineProps<{ rows: LadderRow[] }>()
const COLOURS = ['#f2c94c', '#5b8def', '#7b61d9', '#2fa7a0', '#8b97ab']
const colour = (rank: number) => COLOURS[(rank - 1) % COLOURS.length]
</script>

<style scoped>
.panel { padding: 1.25rem 1.4rem; min-width: 0; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
.panel-link { white-space: nowrap; display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.82rem; color: var(--txt-primary); }
.panel-link:hover { color: var(--ball); }
.panel-sub { font-size: 0.85rem; color: var(--txt-secondary); margin: 0.2rem 0 0.9rem; }
.empty { font-size: 0.9rem; }
.ladder { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.ladder th { font-size: 0.66rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--txt-muted); text-align: left; padding: 0.4rem 0.4rem 0.6rem; border-bottom: 1px solid var(--line); }
.ladder td { padding: 0.65rem 0.4rem; border-bottom: 1px solid var(--line); }
.ladder tr:last-child td { border-bottom: 0; }
.ladder th.num, .ladder td.num { text-align: right; white-space: nowrap; }
.rank { width: 1.8rem; color: var(--txt-secondary); }
.who { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
.av { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 0.7rem; font-weight: 700; color: #070d17; }
.nm { min-width: 0; overflow-wrap: break-word; }
.chg { font-size: 0.82rem; }
@media (max-width: 480px) {
  .ladder { font-size: 0.85rem; }
  .ladder td { padding: 0.55rem 0.25rem; }
  .ladder th { padding-left: 0.25rem; padding-right: 0.25rem; }
  .who { gap: 0.5rem; }
  .av { width: 26px; height: 26px; font-size: 0.62rem; }
  .rank { width: 1.2rem; }
}
.up { color: var(--net); } .down { color: var(--ace); } .flat { color: var(--txt-muted); }
</style>
