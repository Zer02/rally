<template>
  <main class="page">
    <div class="container">
      <div v-if="!me" style="text-align:center;padding:3rem 0">
        <span v-if="playersStore.loading" class="spinner" style="width:28px;height:28px;border-width:3px" />
        <p v-else class="muted">
          You haven't joined this league yet — use the league icon in the nav to join it first.
        </p>
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
          <div style="display:flex;align-items:center;gap:0.75rem">
            <button v-if="!editingProfile" class="btn btn-ghost" style="font-size:0.85rem" @click="startEditProfile">
              Edit profile
            </button>
            <TierBadge :rating="me.rating" />
          </div>
        </div>

        <form v-if="editingProfile" class="card" style="padding:1.25rem;margin-bottom:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end" @submit.prevent="saveProfile">
          <div class="field" style="flex:1;min-width:160px">
            <label class="field-label">Display name</label>
            <input v-model="editName" class="input" required />
          </div>
          <div class="field" style="flex:1;min-width:120px">
            <label class="field-label">Unit</label>
            <input v-model="editUnit" class="input" placeholder="e.g. 4B" />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="editSaving || !editName.trim()">
            <span v-if="editSaving" class="spinner" style="width:14px;height:14px;border-width:2px" />
            <span v-else>Save</span>
          </button>
          <button type="button" class="btn btn-ghost" @click="editingProfile = false">Cancel</button>
          <p v-if="editError" class="flash flash-error" style="width:100%;margin-top:0.5rem">{{ editError }}</p>
        </form>

        <div class="field" style="max-width:200px;margin-bottom:1.25rem">
          <label class="field-label">Season</label>
          <select v-model="selectedSeasonId" class="input">
            <option value="current">Current season</option>
            <option v-for="s in seasonsStore.pastSeasons" :key="s.id" :value="s.id">
              Season {{ s.season_number }}
            </option>
          </select>
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
            <p class="stat-label">{{ selectedSeasonId === 'current' ? 'Season W–L' : 'Season W–L (past)' }}</p>
            <p class="stat-value" style="font-size:1.1rem">{{ mySeasonRecord }}</p>
          </div>
          <div class="stat-cell">
            <p class="stat-label">Win rate</p>
            <p class="stat-value" style="font-size:1.1rem">{{ winRate }}%</p>
          </div>
        </div>

        <div class="card" style="margin-bottom:1.5rem;padding:1.25rem 1.25rem 0.75rem">
          <div class="card-header" style="margin-bottom:0.25rem"><h3>Rating history</h3></div>
          <RatingChart :history="ratingHistory" />
        </div>

        <div class="card" style="overflow:hidden">
          <div class="card-header"><h3>My matches</h3></div>
          <div v-if="myMatches.length === 0" style="padding:2rem;text-align:center;color:var(--txt-muted)">
            No matches yet.
          </div>
          <div v-else class="table-scroll">
            <table class="table">
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
        </div>

        <div v-if="me && (me.rr_seasons_played > 0)" class="card" style="margin-top:1.5rem;padding:1.25rem">
          <div class="card-header" style="margin-bottom:0.75rem"><h3>Round Robin</h3></div>
          <div class="stat-grid" style="margin-bottom:1.25rem">
            <div class="stat-cell">
              <p class="stat-label">Titles</p>
              <p class="stat-value">{{ me.rr_titles }}</p>
            </div>
            <div class="stat-cell">
              <p class="stat-label">Best finish</p>
              <p class="stat-value">{{ me.rr_best_finish ? `#${me.rr_best_finish}` : '—' }}</p>
            </div>
            <div class="stat-cell">
              <p class="stat-label">Seasons played</p>
              <p class="stat-value">{{ me.rr_seasons_played }}</p>
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
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useSeasonsStore } from '@/stores/seasons'
import { useTournamentsStore } from '@/stores/tournaments'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import { supabase } from '@/lib/supabase'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import RatingChart from '@/components/ui/RatingChart.vue'
import type { Match, Tournament } from '@/types'

const playersStore    = usePlayersStore()
const matchesStore    = useMatchesStore()
const seasonsStore    = useSeasonsStore()
const tournamentsStore = useTournamentsStore()
const leagueStore     = useLeagueStore()
const { user, updateProfile } = useAuth()

const ratingHistory = ref<{ rating: number; recorded_at: string }[]>([])
const selectedSeasonId = ref('current')

const editingProfile = ref(false)
const editName        = ref('')
const editUnit         = ref('')
const editSaving       = ref(false)
const editError        = ref('')

interface RRHistoryRow { wins: number; losses: number; seed: number | null; adjusted_score: number | null; tournament: Tournament }
const rrHistory        = ref<RRHistoryRow[]>([])
const rrHistoryLoading = ref(false)

async function loadRatingHistory() {
  if (!user.value?.id || !leagueStore.currentLeagueId) { ratingHistory.value = []; return }

  const { data } = await supabase
    .from('elo_history')
    .select('rating, recorded_at')
    .eq('profile_id', user.value.id)
    .eq('league_id', leagueStore.currentLeagueId)
    .order('recorded_at', { ascending: true })
  ratingHistory.value = data ?? []
}

async function loadRoundRobinHistory() {
  if (!user.value?.id) { rrHistory.value = []; return }
  rrHistoryLoading.value = true
  rrHistory.value = (await tournamentsStore.fetchProfileRoundRobinHistory(user.value.id)) as RRHistoryRow[]
  rrHistoryLoading.value = false
}

onMounted(async () => {
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100), seasonsStore.fetchSeasons()])
  playersStore.subscribe()
  matchesStore.subscribe()
  await Promise.all([loadRatingHistory(), loadRoundRobinHistory()])
})

watch(selectedSeasonId, (id) => {
  if (id !== 'current') seasonsStore.fetchRecords(id)
})

// A different league means a different players row, a different match
// history, and different rating history entirely for the same person.
onLeagueChange(async () => {
  selectedSeasonId.value = 'current'
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100), seasonsStore.fetchSeasons()])
  await Promise.all([loadRatingHistory(), loadRoundRobinHistory()])
})

onUnmounted(() => {
  playersStore.unsubscribe()
  matchesStore.unsubscribe()
})

const me     = computed(() => playersStore.byId(user.value?.id ?? ''))
const myName = computed(() => me.value?.profile?.display_name || me.value?.profile?.username || 'You')
const myRank = computed(() => playersStore.sorted.findIndex(p => p.profile_id === user.value?.id) + 1)

function startEditProfile() {
  editName.value = me.value?.profile?.display_name || ''
  editUnit.value = me.value?.profile?.unit || ''
  editError.value = ''
  editingProfile.value = true
}

async function saveProfile() {
  editSaving.value = true
  editError.value = ''
  const err = await updateProfile({ display_name: editName.value.trim(), unit: editUnit.value.trim() || null })
  editSaving.value = false
  if (err) { editError.value = err.message; return }
  editingProfile.value = false
  await playersStore.fetch() // refreshes the profile embedded in playersStore.players (a separate cache from useAuth's)
}

const mySeasonRecord = computed(() => {
  if (!me.value) return '0–0'
  if (selectedSeasonId.value === 'current') return `${me.value.season_wins}–${me.value.season_losses}`
  const record = seasonsStore.recordFor(selectedSeasonId.value, me.value.profile_id)
  return record ? `${record.wins}–${record.losses}` : '—'
})

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

function myScore(m: Match): string {
  if (!m.challenger_score || !m.opponent_score) return '—'
  const cs = m.challenger_score.split(',').map(Number)
  const os = m.opponent_score.split(',').map(Number)
  const iAmChallenger = m.challenger_id === user.value?.id
  return cs.map((c, i) => {
    const mine   = iAmChallenger ? c     : os[i]
    const theirs = iAmChallenger ? os[i] : c
    return `${mine}–${theirs}`
  }).join(', ')
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>
