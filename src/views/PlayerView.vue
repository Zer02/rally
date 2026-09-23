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

        <!-- Head-to-head — only when logged in and viewing someone else -->
        <div v-if="headToHead" class="card" style="margin-bottom:1.5rem">
          <p class="stat-label" style="margin-bottom:0.4rem">Ladder head-to-head</p>
          <p style="font-size:1.05rem;font-weight:500;color:var(--txt-primary)">
            {{ headToHead.summary }}
          </p>
          <p class="muted" style="font-size:0.8rem;margin-top:0.2rem">
            {{ headToHead.wins }}–{{ headToHead.losses }} all-time vs. {{ pname }}
          </p>
        </div>

        <div v-if="rrHeadToHead" class="card" style="margin-bottom:1.5rem">
          <p class="stat-label" style="margin-bottom:0.4rem">Round Robin head-to-head</p>
          <p style="font-size:1.05rem;font-weight:500;color:var(--txt-primary)">
            {{ rrHeadToHead.summary }}
          </p>
          <p class="muted" style="font-size:0.8rem;margin-top:0.2rem">
            {{ rrHeadToHead.wins }}–{{ rrHeadToHead.losses }} in singles vs. {{ pname }}
          </p>
        </div>

        <div class="card" style="margin-bottom:1.5rem;padding:1.25rem 1.25rem 0.75rem">
          <div class="card-header" style="margin-bottom:0.25rem"><h3>Rating history</h3></div>
          <RatingChart :history="ratingHistory" />
        </div>

        <div class="card" style="overflow:hidden">
          <div class="card-header"><h3>Match history</h3></div>
          <div v-if="!playerMatches.length" style="padding:2rem;text-align:center;color:var(--txt-muted)">No matches yet.</div>
          <div v-else class="table-scroll">
            <table class="table">
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
        </div>

        <div v-if="player.rr_seasons_played > 0" class="card" style="margin-top:1.5rem;padding:1.25rem">
          <div class="card-header" style="margin-bottom:0.75rem"><h3>Round Robin</h3></div>
          <div class="stat-grid" style="margin-bottom:1.25rem">
            <div class="stat-cell">
              <p class="stat-label">Titles</p>
              <p class="stat-value">{{ player.rr_titles }}</p>
            </div>
            <div class="stat-cell">
              <p class="stat-label">Best finish</p>
              <p class="stat-value">{{ player.rr_best_finish ? `#${player.rr_best_finish}` : '—' }}</p>
            </div>
            <div class="stat-cell">
              <p class="stat-label">Seasons played</p>
              <p class="stat-value">{{ player.rr_seasons_played }}</p>
            </div>
          </div>

          <div v-if="rrHistoryLoading" style="text-align:center;padding:1rem">
            <span class="spinner" style="width:18px;height:18px;border-width:2px" />
          </div>
          <table v-else-if="rrHistory.length" class="table">
            <thead>
              <tr><th>Season</th><th>Finish</th><th>W–L</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr v-for="h in rrHistory" :key="h.tournament.id">
                <td>{{ h.tournament.name }}</td>
                <td class="mono">{{ h.seed ? `#${h.seed}` : '—' }}</td>
                <td class="mono">{{ h.wins }}–{{ h.losses }}</td>
                <td class="muted mono">{{ formatDate(h.tournament.completed_at) }}</td>
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
import { useTournamentsStore } from '@/stores/tournaments'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import { supabase } from '@/lib/supabase'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import RatingChart from '@/components/ui/RatingChart.vue'
import type { Match, Tournament } from '@/types'

const route          = useRoute()
const playersStore   = usePlayersStore()
const matchesStore   = useMatchesStore()
const tournamentsStore = useTournamentsStore()
const leagueStore    = useLeagueStore()
const { user, isAuthed } = useAuth()

const loading  = ref(true)
const playerId = route.params.id as string
const ratingHistory = ref<{ rating: number; recorded_at: string }[]>([])

interface RRHistoryRow { wins: number; losses: number; seed: number | null; adjusted_score: number | null; tournament: Tournament }
const rrHistory        = ref<RRHistoryRow[]>([])
const rrHistoryLoading = ref(false)

interface RRMatch {
  id: string; score_a: number | null; score_b: number | null; winner_id: string | null
  completed_at: string | null; player_a_id: string; player_b_id: string
}
const rrH2HMatches = ref<RRMatch[]>([])

async function loadAll() {
  const [, , historyRes] = await Promise.all([
    playersStore.fetch(),
    matchesStore.fetch(100),
    leagueStore.currentLeagueId
      ? supabase
          .from('elo_history')
          .select('rating, recorded_at')
          .eq('profile_id', playerId)
          .eq('league_id', leagueStore.currentLeagueId)
          .order('recorded_at', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
  ])
  ratingHistory.value = historyRes.data ?? []
  loading.value = false

  rrHistoryLoading.value = true
  const [rrHist, rrH2H] = await Promise.all([
    tournamentsStore.fetchProfileRoundRobinHistory(playerId),
    (isAuthed.value && user.value && user.value.id !== playerId)
      ? tournamentsStore.fetchHeadToHead(user.value.id, playerId)
      : Promise.resolve([]),
  ])
  rrHistory.value     = rrHist as RRHistoryRow[]
  rrH2HMatches.value  = rrH2H as RRMatch[]
  rrHistoryLoading.value = false
}

onMounted(loadAll)

// Viewing a specific player while switching leagues is an edge case, but
// the player row, their matches, and their rating history are all
// league-scoped now, so it's worth re-fetching rather than showing the
// wrong league's numbers under this player's name.
onLeagueChange(loadAll)

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

const headToHead = computed(() => {
  if (!isAuthed.value || !user.value || user.value.id === playerId) return null
  const meId = user.value.id

  const between = matchesStore.completed.filter(m =>
    (m.challenger_id === meId && m.opponent_id === playerId) ||
    (m.challenger_id === playerId && m.opponent_id === meId)
  )
  if (!between.length) return null

  const wins   = between.filter(m => m.winner_id === meId).length
  const losses = between.length - wins

  let summary: string
  if (wins > losses)      summary = `You lead ${wins}–${losses}`
  else if (losses > wins) summary = `You're behind ${wins}–${losses}`
  else                    summary = `Tied ${wins}–${losses}`

  return { wins, losses, summary }
})

const rrHeadToHead = computed(() => {
  if (!isAuthed.value || !user.value || user.value.id === playerId) return null
  if (!rrH2HMatches.value.length) return null
  const meId = user.value.id

  const wins   = rrH2HMatches.value.filter(m => m.winner_id === meId).length
  const losses = rrH2HMatches.value.length - wins

  let summary: string
  if (wins > losses)      summary = `You lead ${wins}–${losses}`
  else if (losses > wins) summary = `You're behind ${wins}–${losses}`
  else                    summary = `Tied ${wins}–${losses}`

  return { wins, losses, summary }
})

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
