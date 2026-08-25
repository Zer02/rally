<template>
  <main class="page">
    <div class="container">
      <div class="page-header">
        <p class="eyebrow">Activity</p>
        <h1>Matches</h1>
      </div>

      <div v-if="matchesStore.loading" style="text-align:center;padding:3rem 0">
        <span class="spinner" style="width:28px;height:28px;border-width:3px" />
      </div>

      <template v-else>
        <!-- Disputed matches -->
        <section v-if="matchesStore.disputed.length" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">⚠️ Disputed results</h3>
          <div class="flash flash-error" style="margin-bottom:0.875rem">
            Both players reported different results for these matches. An admin needs to resolve them.
          </div>
          <div class="match-list">
            <div v-for="m in matchesStore.disputed" :key="m.id" class="card" style="padding:1.25rem">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
                <div>
                  <div style="font-size:0.9rem;font-weight:500;color:var(--txt-primary);margin-bottom:0.5rem">
                    {{ m.challenger?.display_name || m.challenger?.username }}
                    vs
                    {{ m.opponent?.display_name || m.opponent?.username }}
                  </div>
                  <div style="font-size:0.8rem;color:var(--txt-muted)">
                    <span style="color:var(--txt-secondary)">{{ m.challenger?.display_name }} reported:</span>
                    {{ reportedWinnerName(m, 'challenger') }} won
                  </div>
                  <div style="font-size:0.8rem;color:var(--txt-muted)">
                    <span style="color:var(--txt-secondary)">{{ m.opponent?.display_name }} reported:</span>
                    {{ reportedWinnerName(m, 'opponent') }} won
                  </div>
                </div>
                <!-- Admin resolve buttons — shown to all for now, restrict later -->
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                  <button class="btn btn-ghost btn-sm" @click="resolve(m.id, m.challenger_id)">
                    {{ m.challenger?.display_name || 'Challenger' }} wins
                  </button>
                  <button class="btn btn-ghost btn-sm" @click="resolve(m.id, m.opponent_id)">
                    {{ m.opponent?.display_name || 'Opponent' }} wins
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Pending actions -->
        <section v-if="myPending.length && isAuthed" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">Needs your attention</h3>
          <div class="match-list">
            <MatchCard
              v-for="m in myPending"
              :key="m.id"
              :match="m"
              :current-user-id="user?.id"
              @accept="accept(m.id)"
              @decline="decline(m.id)"
              @submit="openResult"
            />
          </div>
        </section>

        <!-- Waiting for opponent to report -->
        <section v-if="waitingFor.length && isAuthed" style="margin-bottom:2rem">
          <h3 style="margin-bottom:0.875rem">Waiting for opponent</h3>
          <div class="match-list">
            <div v-for="m in waitingFor" :key="m.id" class="card" style="padding:1rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem">
              <div style="font-size:0.875rem;color:var(--txt-secondary)">
                vs {{ opponentName(m) }} — you've submitted, waiting for their confirmation
              </div>
              <span class="status status-pending">Pending</span>
            </div>
          </div>
        </section>

        <!-- Recent completed -->
        <section>
          <h3 style="margin-bottom:0.875rem">Recent matches</h3>
          <div v-if="!matchesStore.completed.length" class="muted" style="padding:2rem 0">
            No matches yet — go challenge someone!
          </div>
          <div class="match-list">
            <MatchCard
              v-for="m in matchesStore.completed"
              :key="m.id"
              :match="m"
              :current-user-id="user?.id"
            />
          </div>
        </section>
      </template>

      <ResultModal
        v-if="activeMatch"
        :match="activeMatch"
        :reporter-id="user?.id ?? ''"
        @close="activeMatch = null"
        @submit="submitResult"
      />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMatchesStore } from '@/stores/matches'
import { useAuth } from '@/composables/useAuth'
import MatchCard from '@/components/match/MatchCard.vue'
import ResultModal from '@/components/match/ResultModal.vue'
import type { Match } from '@/types'

const matchesStore = useMatchesStore()
const { user, isAuthed } = useAuth()
const activeMatch = ref<Match | null>(null)

onMounted(() => matchesStore.fetch())

const myPending = computed(() =>
  matchesStore.pending.filter(m => {
    const isParticipant = m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
    if (!isParticipant) return false
    if (m.status === 'pending') return m.opponent_id === user.value?.id  // only opponent sees pending
    // accepted — show only if I haven't reported yet
    const iHaveReported = m.challenger_id === user.value?.id
      ? !!m.challenger_reported_winner
      : !!m.opponent_reported_winner
    return !iHaveReported
  })
)

const waitingFor = computed(() =>
  matchesStore.pending.filter(m => {
    const isParticipant = m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
    if (!isParticipant || m.status !== 'accepted') return false
    const iHaveReported = m.challenger_id === user.value?.id
      ? !!m.challenger_reported_winner
      : !!m.opponent_reported_winner
    return iHaveReported
  })
)

function opponentName(m: Match) {
  if (m.challenger_id === user.value?.id)
    return m.opponent?.display_name || m.opponent?.username
  return m.challenger?.display_name || m.challenger?.username
}

function reportedWinnerName(m: Match, side: 'challenger' | 'opponent') {
  const winnerId = side === 'challenger' ? m.challenger_reported_winner : m.opponent_reported_winner
  if (!winnerId) return 'not yet reported'
  if (winnerId === m.challenger_id) return m.challenger?.display_name || m.challenger?.username
  return m.opponent?.display_name || m.opponent?.username
}

async function accept(id: string)  { await matchesStore.respond(id, true) }
async function decline(id: string) { await matchesStore.respond(id, false) }
function openResult(match: Match)  { activeMatch.value = match }

async function submitResult(payload: any) {
  await matchesStore.submitResult(
    payload.matchId,
    payload.reporterId,
    payload.winnerId,
    payload.loserId,
    payload.challengerScores,
    payload.opponentScores,
  )
  activeMatch.value = null
}

async function resolve(matchId: string, winnerId: string) {
  await matchesStore.resolveDispute(matchId, winnerId)
}
</script>

<style scoped>
.match-list { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
