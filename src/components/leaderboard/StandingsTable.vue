<!--
  StandingsTable — the leaderboard's podium/table/card look, generalized so
  any ranked list of players (main ladder, round robin season, a finalized
  round robin's final standings) can reuse it instead of re-implementing
  the CSS. Callers pass already-sorted `rows` plus whatever extra stat
  columns they want (Season W-L, Pts for/against/diff, etc.) — the rating
  column, podium, crowns, and mobile/desktop split are all built in.

  v0.0.4.1 — extracted from LeaderboardView.vue so TournamentView.vue could
  match its look without duplicating the styles.
-->
<template>
  <div>
    <!-- Top 3 podium -->
    <div v-if="rows.length >= 3" class="podium">
      <RouterLink :to="`/player/${rows[1].profile_id}`" class="podium-spot second">
        <PlayerAvatar :name="rows[1].name" :size="48" override="🥈" />
        <div class="podium-rank">2</div>
        <div class="podium-name">{{ rows[1].name }}</div>
        <div class="podium-rating mono">{{ Math.round(rows[1].rating) }}</div>
      </RouterLink>
      <RouterLink :to="`/player/${rows[0].profile_id}`" class="podium-spot first">
        <PlayerAvatar :name="rows[0].name" :size="56" override="👑" />
        <div class="podium-rank gold">1</div>
        <div class="podium-name">{{ rows[0].name }}</div>
        <div class="podium-rating mono">{{ Math.round(rows[0].rating) }}</div>
      </RouterLink>
      <RouterLink :to="`/player/${rows[2].profile_id}`" class="podium-spot third">
        <PlayerAvatar :name="rows[2].name" :size="44" override="🥉" />
        <div class="podium-rank">3</div>
        <div class="podium-name">{{ rows[2].name }}</div>
        <div class="podium-rating mono">{{ Math.round(rows[2].rating) }}</div>
      </RouterLink>
    </div>

    <!-- Full table — desktop -->
    <div class="card leaderboard-table" style="overflow:hidden;margin-top:1.5rem">
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th v-if="showTier">Tier</th>
              <th>{{ ratingLabel }}</th>
              <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
              <th v-if="showStreak">Streak</th>
              <th v-if="$slots.action"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(p, i) in rows"
              :key="p.id"
              :class="{ 'my-row': p.profile_id === meId }"
            >
              <td class="mono muted">{{ i + 1 }}</td>
              <td>
                <RouterLink :to="`/player/${p.profile_id}`" style="text-decoration:none">
                  <div style="display:flex;align-items:center;gap:5px">
                    {{ p.name }}
                    <span v-if="rankCrown(i + 1)" class="crown crown-sm" :class="`crown-${rankCrown(i + 1)?.tier}`" aria-hidden="true">{{ rankCrown(i + 1)?.emoji }}</span>
                  </div>
                  <div v-if="p.unit" class="muted" style="font-size:0.72rem">Unit {{ p.unit }}</div>
                </RouterLink>
              </td>
              <td v-if="showTier"><TierBadge :rating="p.rating" /></td>
              <td class="mono">{{ Math.round(p.rating) }}</td>
              <td v-for="col in columns" :key="col.key" class="mono" :class="col.cellClass?.(p)">{{ col.value(p) }}</td>
              <td v-if="showStreak">
                <span v-if="(p.streak ?? 0) > 1" class="delta delta-pos">W{{ p.streak }}</span>
                <span v-else-if="(p.streak ?? 0) < -1" class="delta delta-neg">L{{ Math.abs(p.streak!) }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td v-if="$slots.action">
                <slot name="action" :row="p" />
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td :colspan="totalCols" class="muted" style="text-align:center">{{ emptyMessage }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Mobile card list — same data, no horizontal scroll needed -->
    <div class="leaderboard-cards">
      <div
        v-for="(p, i) in rows"
        :key="p.id"
        class="lb-card"
        :class="{ 'my-row': p.profile_id === meId }"
      >
        <div class="lb-rank mono muted">{{ i + 1 }}</div>
        <RouterLink :to="`/player/${p.profile_id}`" class="lb-player">
          <div class="lb-main">
            <div class="lb-name-row">
              <span class="lb-name">{{ p.name }}</span>
              <span v-if="rankCrown(i + 1)" class="crown crown-sm" :class="`crown-${rankCrown(i + 1)?.tier}`" aria-hidden="true">{{ rankCrown(i + 1)?.emoji }}</span>
              <TierBadge v-if="showTier" :rating="p.rating" />
            </div>
            <div class="lb-sub muted">
              <span v-if="p.unit">Unit {{ p.unit }} · </span>
              <template v-for="(col, ci) in mobileColumns" :key="col.key">
                <span v-if="ci">  ·  </span>{{ col.value(p) }}
              </template>
              <span v-if="showStreak && (p.streak ?? 0) > 1" class="delta delta-pos" style="margin-left:0.4rem">W{{ p.streak }}</span>
              <span v-else-if="showStreak && (p.streak ?? 0) < -1" class="delta delta-neg" style="margin-left:0.4rem">L{{ Math.abs(p.streak!) }}</span>
            </div>
          </div>
        </RouterLink>
        <div class="lb-right">
          <div class="lb-rating mono">{{ Math.round(p.rating) }}</div>
          <slot name="action" :row="p" />
        </div>
      </div>
      <div v-if="!rows.length" class="muted" style="text-align:center;padding:1rem 0">{{ emptyMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import TierBadge from '@/components/ui/TierBadge.vue'

export interface StandingRow {
  id:         string
  profile_id: string
  name:       string
  unit?:      string | null
  rating:     number
  streak?:    number
}

export interface StandingColumn {
  key:   string
  label: string
  value: (row: StandingRow) => string
  cellClass?: (row: StandingRow) => string | Record<string, boolean>
  // Shown in the mobile card's sub-line. Defaults to true — set false on
  // columns that are desktop-table-only (e.g. Pts for/against, which
  // would clutter the card view once Diff already summarizes them).
  mobile?: boolean
}

const props = withDefaults(defineProps<{
  rows: StandingRow[]
  columns?: StandingColumn[]
  ratingLabel?: string
  showTier?: boolean
  showStreak?: boolean
  meId?: string | null
  emptyMessage?: string
}>(), {
  columns: () => [],
  ratingLabel: 'Rating',
  showTier: false,
  showStreak: false,
  meId: null,
  emptyMessage: 'No standings yet.',
})

defineSlots<{
  action?(props: { row: StandingRow }): any
}>()

const mobileColumns = computed(() => props.columns.filter(c => c.mobile !== false))

// # + Player [+ Tier] + Rating + columns [+ Streak] [+ action] — kept in
// sync with the <thead> above so the empty-state row spans correctly.
const totalCols = computed(() =>
  2 + (props.showTier ? 1 : 0) + 1 + props.columns.length + (props.showStreak ? 1 : 0)
)

const CROWNS = {
  1: { emoji: '👑', tier: 'gold' },
  2: { emoji: '🥈', tier: 'silver' },
  3: { emoji: '🥉', tier: 'bronze' },
} as const

function rankCrown(rank: number) {
  return CROWNS[rank as keyof typeof CROWNS] ?? null
}
</script>

<style scoped>
.podium { display: flex; align-items: flex-end; justify-content: center; gap: 1rem; padding: 2rem 0 0; }
.podium-spot { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; text-decoration: none; transition: transform 0.15s; }
.podium-spot:hover { transform: translateY(-3px); }
.podium-rank { font-family: var(--font-display); font-size: 1.4rem; color: var(--txt-muted); }
.podium-rank.gold { color: var(--ball); }
.podium-name { font-size: 0.85rem; font-weight: 500; color: var(--txt-primary); }
.podium-rating { font-size: 0.78rem; color: var(--txt-muted); }
.first .podium-name { font-size: 0.95rem; }
.my-row td { background: rgba(232,200,74,0.04); }

.crown { line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)); }
.crown-sm { font-size: 0.85rem; }

/* Generic +/- coloring for numeric columns (e.g. a Diff column) — plain
   colored text, not a pill like .delta-pos/.delta-neg, since a stat column
   sits in a dense table row rather than standing alone like a streak badge. */
.diff-pos { color: var(--net); }
.diff-neg { color: var(--ace); }

/* Mobile card list — hidden on desktop, shown instead of the table below 600px */
.leaderboard-cards { display: none; }

.lb-card {
  display: flex; align-items: center; gap: 0.75rem;
  background: var(--table-mid); border: 1px solid var(--line);
  border-radius: var(--radius-md); padding: 0.75rem 0.9rem;
}
.lb-card.my-row { background: rgba(232,200,74,0.05); border-color: rgba(232,200,74,0.25); }
.lb-rank { width: 1.25rem; text-align: center; font-size: 0.85rem; flex-shrink: 0; }
.lb-player { display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0; text-decoration: none; }
.lb-main { min-width: 0; }
.lb-name-row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.lb-name {
  font-weight: 500; color: var(--txt-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 9rem;
}
.lb-sub { font-size: 0.75rem; margin-top: 0.15rem; }
.lb-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; flex-shrink: 0; }
.lb-rating { font-size: 1rem; font-weight: 500; color: var(--txt-primary); }

@media (max-width: 600px) {
  .leaderboard-table { display: none; }
  .leaderboard-cards { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.5rem; }
}
</style>
