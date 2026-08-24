<template>
  <main class="page">
    <div class="container">
      <RouterLink to="/leaderboard" class="btn btn-ghost btn-sm" style="margin-bottom:1.5rem">← Standings</RouterLink>

      <div v-if="loading" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else-if="player">
        <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
          <div style="display:flex;align-items:center;gap:1rem">
            <PlayerAvatar :name="pname" :size="56" />
            <div>
              <p class="eyebrow">Player profile</p>
              <h1 style="font-size:clamp(1.4rem,3vw,2rem)">{{ pname }}</h1>
              <p v-if="player.profile?.unit" class="muted" style="font-size:0.85rem">Unit {{ player.profile.unit }}</p>
            </div>
          </div>
          <TierBadge :rating="player.rating" />
        </div>

        <div class="stat-grid" style="margin-bottom:2rem">
          <div class="stat-cell">
            <p class="stat-label">Rating</p>
            <p class="stat-value">{{ player.rating }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Rank</p>
            <p class="stat-value">#{{ rank }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Season W–L</p>
            <p class="stat-value" style="font-size:1.1rem">{{ player.season_wins }}–{{ player.season_losses }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Win rate</p>
            <p class="stat-value" style="font-size:1.1rem">{{ winRate }}%</p>
          </div>
        </div>

        <div class="card" style="overflow:hidden">
          <div class="card-header"><h3>Match history</h3></div>
          <div v-if="!playerMatches.length" style="padding:2rem;text-align:center;color:var(--txt-muted)">No matches yet.</div>
          <table v-else class="table">
            <thead>
              <tr><th>Result</th><th>Opponent</th><th>Score</th><th>Δ Rating</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in playerMatches" :key="m.id">
                <td><span v-if="m.winner_id === playerId" class="win">W</span><span v-else class="loss">L</span></td>
                <td>{{ oppName(m) }}</td>
                <td class="mono">{{ formatScore(m) }}</td>
                <td>
                  <span class="delta" :class="m.winner_id === playerId ? 'delta-pos' : 'delta-neg'">
                    {{ m.winner_id === playerId ? '+' : '' }}{{ myDelta(m) }}
                  </span>
                </td>
                <td class="muted mono">{{ formatDate(m.completed_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="isAuthed && playerId !== user?.id" style="margin-top:1rem;text-align:right">
          <RouterLink :to="{ name: 'challenge', query: { opponent: playerId } }" class="btn btn-primary">
            Challenge {{ pname }} →
          </RouterLink>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useAuth } from '@/composables/useAuth'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Match } from '@/types'

const route        = useRoute()
const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const { user, isAuthed } = useAuth()

const loading  = ref(true)
const playerId = route.params.id as string

onMounted(async () => {
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100)])
  loading.value = false
})

const player  = computed(() => playersStore.byId(playerId))
const pname   = computed(() => player.value?.profile?.display_name || player.value?.profile?.username || 'Player')
const rank    = computed(() => playersStore.sorted.findIndex(p => p.profile_id === playerId) + 1)
const winRate = computed(() => {
  if (!player.value) return 0
  const total = player.value.career_wins + player.value.career_losses
  return total ? Math.round((player.value.career_wins / total) * 100) : 0
})

const playerMatches = computed(() =>
  matchesStore.completed.filter(m => m.challenger_id === playerId || m.opponent_id === playerId)
)

function oppName(m: Match) {
  const opp = m.challenger_id === playerId ? m.opponent : m.challenger
  return opp?.display_name || opp?.username || '?'
}
function myDelta(m: Match) {
  if (m.challenger_id === playerId) return m.challenger_delta ?? '?'
  return m.opponent_delta ?? '?'
}
function formatScore(m: Match) {
  if (!m.challenger_score || !m.opponent_score) return '—'
  const cs = m.challenger_score.split(',')
  const os = m.opponent_score.split(',')
  return cs.map((s, i) => `${s}–${os[i]}`).join(', ')
}
function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>
