<template>
  <main class="page">
    <div class="container">
      <div class="page-header">
        <p class="eyebrow">Building League</p>
        <h1>Standings</h1>
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

        <!-- Full table -->
        <div class="card" style="overflow:hidden;margin-top:1.5rem">
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
                  <td class="mono">{{ p.season_wins }}–{{ p.season_losses }}</td>
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
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useAuth } from '@/composables/useAuth'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Player } from '@/types'

const store = usePlayersStore()
const { user, isAuthed } = useAuth()

onMounted(() => {
  store.fetch()
  store.subscribe()  // live updates
})

onUnmounted(() => {
  store.unsubscribe()
})

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
</style>
