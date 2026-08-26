<template>
  <main class="page">
    <div class="container">
      <div v-if="!me" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else>
        <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
          <div style="display:flex;align-items:center;gap:1rem">
            <PlayerAvatar :name="myName" :size="56" />
            <div>
              <p class="eyebrow">Your profile</p>
              <h1 style="font-size:clamp(1.4rem,3vw,2rem)">{{ myName }}</h1>
              <p v-if="me.profile?.unit" class="muted" style="font-size:0.85rem">Unit {{ me.profile.unit }}</p>
            </div>
          </div>
          <TierBadge :rating="me.rating" />
        </div>

        <div class="stat-grid" style="margin-bottom:2rem">
          <div class="stat-cell">
            <p class="stat-label">Rating</p>
            <p class="stat-value">{{ me.rating }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Rank</p>
            <p class="stat-value">#{{ myRank }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Season W–L</p>
            <p class="stat-value" style="font-size:1.1rem">{{ me.season_wins }}–{{ me.season_losses }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Win rate</p>
            <p class="stat-value" style="font-size:1.1rem">{{ winRate }}%</p>
          </div>
        </div>

        <div class="card" style="overflow:hidden">
          <div class="card-header"><h3>My matches</h3></div>
          <div v-if="myMatches.length === 0" style="padding:2rem;text-align:center;color:var(--txt-muted)">
            No matches yet.
          </div>
          <table v-else class="table">
            <thead>
              <tr><th>Result</th><th>Opponent</th><th>Score</th><th>Δ</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in myMatches" :key="m.id">
                <td>
                  <span v-if="m.winner_id === user?.id" class="win">W</span>
                  <span v-else class="loss">L</span>
                </td>
                <td>{{ opponentName(m) }}</td>
                <!-- Score always from MY perspective: my games first -->
                <td class="mono">{{ myScore(m) }}</td>
                <td>
                  <span class="delta" :class="m.winner_id === user?.id ? 'delta-pos' : 'delta-neg'">
                    {{ m.winner_id === user?.id ? '+' : '' }}{{ myDelta(m) }}
                  </span>
                </td>
                <td class="muted mono">{{ formatDate(m.completed_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useAuth } from '@/composables/useAuth'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Match } from '@/types'

const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const { user } = useAuth()

onMounted(async () => {
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100)])
})

const me     = computed(() => playersStore.byId(user.value?.id ?? ''))
const myName = computed(() => me.value?.profile?.display_name || me.value?.profile?.username || 'You')
const myRank = computed(() => playersStore.sorted.findIndex(p => p.profile_id === user.value?.id) + 1)

const winRate = computed(() => {
  if (!me.value) return 0
  const total = me.value.career_wins + me.value.career_losses
  return total ? Math.round((me.value.career_wins / total) * 100) : 0
})

const myMatches = computed(() =>
  matchesStore.completed.filter(m =>
    m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
  )
)

function opponentName(m: Match) {
  const opp = m.challenger_id === user.value?.id ? m.opponent : m.challenger
  return opp?.display_name || opp?.username || '?'
}

function myDelta(m: Match) {
  if (m.challenger_id === user.value?.id) return m.challenger_delta ?? '?'
  return m.opponent_delta ?? '?'
}

// Always show score from viewer's perspective: my points — opponent's points
function myScore(m: Match): string {
  if (!m.challenger_score || !m.opponent_score) return '—'
  const cs = m.challenger_score.split(',').map(Number)
  const os = m.opponent_score.split(',').map(Number)
  const iAmChallenger = m.challenger_id === user.value?.id
  return cs.map((c, i) => {
    const mine = iAmChallenger ? c : os[i]
    const theirs = iAmChallenger ? os[i] : c
    return `${mine}–${theirs}`
  }).join(', ')
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>
