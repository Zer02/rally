<template>
  <main class="page">
    <div class="container">
      <div class="page-header" style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <p class="eyebrow">Building League</p>
          <h1>Standings</h1>
        </div>
        <div class="field" style="min-width:170px">
          <label class="field-label">Season</label>
          <select v-model="selectedSeasonId" class="input">
            <option value="current">Current season</option>
            <option v-for="s in seasonsStore.pastSeasons" :key="s.id" :value="s.id">
              Season {{ s.season_number }}
            </option>
          </select>
        </div>
      </div>

      <div v-if="store.loading" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else>
        <!-- Top 3 podium -->
        <div v-if="store.sorted.length >= 3" class="podium">
          <RouterLink :to="`/player/${store.sorted[1].profile_id}`" class="podium-spot second">
            <PlayerAvatar :name="name(store.sorted[1])" :size="48" override="🥈" />
            <div class="podium-rank">2</div>
            <div class="podium-name">{{ name(store.sorted[1]) }}</div>
            <div class="podium-rating mono">{{ store.sorted[1].rating }}</div>
          </RouterLink>
          <RouterLink :to="`/player/${store.sorted[0].profile_id}`" class="podium-spot first">
            <PlayerAvatar :name="name(store.sorted[0])" :size="56" override="👑" />
            <div class="podium-rank gold">1</div>
            <div class="podium-name">{{ name(store.sorted[0]) }}</div>
            <div class="podium-rating mono">{{ store.sorted[0].rating }}</div>
          </RouterLink>
          <RouterLink :to="`/player/${store.sorted[2].profile_id}`" class="podium-spot third">
            <PlayerAvatar :name="name(store.sorted[2])" :size="44" override="🥉" />
            <div class="podium-rank">3</div>
            <div class="podium-name">{{ name(store.sorted[2]) }}</div>
            <div class="podium-rating mono">{{ store.sorted[2].rating }}</div>
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
                  <th>Tier</th>
                  <th>Rating</th>
                  <th>Season</th>
                  <th>Streak</th>
                  <th v-if="isAuthed"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(p, i) in store.sorted"
                  :key="p.id"
                  :class="{ 'my-row': p.profile_id === user?.id }"
                >
                  <td class="mono muted">{{ i + 1 }}</td>
                  <td>
                    <RouterLink :to="`/player/${p.profile_id}`" style="display:flex;align-items:center;gap:8px">
                      <PlayerAvatar :name="name(p)" :size="28" />
                      <div>
                        <div style="display:flex;align-items:center;gap:5px">
                          {{ name(p) }}
                          <span v-if="rankCrown(i + 1)" class="crown crown-sm" :class="`crown-${rankCrown(i + 1)?.tier}`" aria-hidden="true">{{ rankCrown(i + 1)?.emoji }}</span>
                        </div>
                        <div v-if="p.profile?.unit" class="muted" style="font-size:0.72rem">Unit {{ p.profile.unit }}</div>
                      </div>
                    </RouterLink>
                  </td>
                  <td><TierBadge :rating="p.rating" /></td>
                  <td class="mono">{{ p.rating }}</td>
                  <td class="mono">{{ seasonRecordDisplay(p) }}</td>
                  <td>
                    <span v-if="p.streak > 1"  class="delta delta-pos">W{{ p.streak }}</span>
                    <span v-else-if="p.streak < -1" class="delta delta-neg">L{{ Math.abs(p.streak) }}</span>
                    <span v-else class="muted">—</span>
                  </td>
                  <td v-if="isAuthed && p.profile_id !== user?.id">
                    <RouterLink
                      :to="{ name: 'challenge', query: { opponent: p.profile_id } }"
                      class="btn btn-ghost btn-sm"
                    >Challenge</RouterLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Standings — mobile card list, same data, no horizontal scroll needed -->
        <div class="leaderboard-cards">
          <div
            v-for="(p, i) in store.sorted"
            :key="p.id"
            class="lb-card"
            :class="{ 'my-row': p.profile_id === user?.id }"
          >
            <div class="lb-rank mono muted">{{ i + 1 }}</div>
            <RouterLink :to="`/player/${p.profile_id}`" class="lb-player">
              <PlayerAvatar :name="name(p)" :size="36" />
              <div class="lb-main">
                <div class="lb-name-row">
                  <span class="lb-name">{{ name(p) }}</span>
                  <span v-if="rankCrown(i + 1)" class="crown crown-sm" :class="`crown-${rankCrown(i + 1)?.tier}`" aria-hidden="true">{{ rankCrown(i + 1)?.emoji }}</span>
                  <TierBadge :rating="p.rating" />
                </div>
                <div class="lb-sub muted">
                  <span v-if="p.profile?.unit">Unit {{ p.profile.unit }} · </span>{{ seasonRecordDisplay(p) }}
                  <span v-if="p.streak > 1"  class="delta delta-pos" style="margin-left:0.4rem">W{{ p.streak }}</span>
                  <span v-else-if="p.streak < -1" class="delta delta-neg" style="margin-left:0.4rem">L{{ Math.abs(p.streak) }}</span>
                </div>
              </div>
            </RouterLink>
            <div class="lb-right">
              <div class="lb-rating mono">{{ p.rating }}</div>
              <RouterLink
                v-if="isAuthed && p.profile_id !== user?.id"
                :to="{ name: 'challenge', query: { opponent: p.profile_id } }"
                class="btn btn-ghost btn-sm"
              >Challenge</RouterLink>
            </div>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useSeasonsStore } from '@/stores/seasons'
import { useAuth } from '@/composables/useAuth'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Player } from '@/types'

const store = usePlayersStore()
const seasonsStore = useSeasonsStore()
const { user, isAuthed } = useAuth()

const selectedSeasonId = ref('current')

onMounted(() => {
  store.fetch()
  store.subscribe()  // live updates
  seasonsStore.fetchSeasons()
})

onUnmounted(() => {
  store.unsubscribe()
})

// Past seasons' records are only fetched on demand, once the dropdown
// actually lands on them — "current" needs nothing extra since its W-L
// already lives on the player rows from store.fetch().
watch(selectedSeasonId, (id) => {
  if (id !== 'current') seasonsStore.fetchRecords(id)
})

function seasonRecordDisplay(p: Player): string {
  if (selectedSeasonId.value === 'current') return `${p.season_wins}–${p.season_losses}`
  const record = seasonsStore.recordFor(selectedSeasonId.value, p.profile_id)
  return record ? `${record.wins}–${record.losses}` : '—'
}

function name(p: Player) {
  return p.profile?.display_name || p.profile?.username || 'Unknown'
}

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
