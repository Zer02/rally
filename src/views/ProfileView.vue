<!-- src/views/ProfileView.vue — v0.0.9.1: the header is a picture banner, with the buttons under the name -->
<template>
  <main class="page">
    <div class="container">
      <ChangePasswordForm v-if="changingPassword" style="margin-top:1.5rem" @close="changingPassword = false" />

      <div v-if="!me" style="text-align:center;padding:3rem 0">
        <span v-if="playersStore.loading" class="spinner" style="width:28px;height:28px;border-width:3px" />
        <div v-else-if="leagueStore.membershipKnown && !leagueStore.isMember" style="text-align:left;max-width:30rem;margin:0 auto">
          <JoinLeagueCard />
        </div>
        <p v-else class="muted">Loading your profile…</p>
        <button v-if="!playersStore.loading && !changingPassword" class="btn btn-ghost" style="font-size:0.85rem;margin-top:1rem" @click="changingPassword = true">
          {{ profile?.is_placeholder ? 'Set password' : 'Change password' }}
        </button>
      </div>

      <template v-else>
        <div class="page-header scene-header profile-banner" data-test="profile-scene">
          <SceneBackdrop :art="art" />
          <div class="profile-id">
            <PlayerAvatar :name="myName" :size="56" />
            <div class="profile-name">
              <p class="eyebrow">Your profile</p>
              <h1>{{ myName }}</h1>
            </div>
          </div>
          <div class="profile-actions" data-test="profile-actions">
            <button v-if="!editingProfile" class="btn btn-ghost" style="font-size:0.85rem" @click="startEditProfile">
              Edit profile
            </button>
            <button v-if="!changingPassword" class="btn btn-ghost" style="font-size:0.85rem" @click="changingPassword = true">
              {{ profile?.is_placeholder ? 'Set password' : 'Change password' }}
            </button>
            <RouterLink to="/progress" style="text-decoration:none"><LevelBadge :xp="me.pass_xp ?? 0" /></RouterLink>
            <TierBadge :rating="me.rating" />
            <span class="muted mono" style="font-size:0.78rem" data-test="lifetime-xp">{{ me.xp ?? 0 }} XP lifetime</span>
          </div>
        </div>

        <form v-if="editingProfile" class="card" style="padding:1.25rem;margin-bottom:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end" @submit.prevent="saveProfile">
          <div class="field" style="flex:1;min-width:160px">
            <label class="field-label">Display name</label>
            <input v-model="editName" class="input" required />
          </div>
          <button type="submit" class="btn btn-primary" :disabled="editSaving || !editName.trim()">
            <span v-if="editSaving" class="spinner" style="width:14px;height:14px;border-width:2px" />
            <span v-else>Save</span>
          </button>
          <button type="button" class="btn btn-ghost" @click="editingProfile = false">Cancel</button>
          <p v-if="editError" class="flash flash-error" style="width:100%;margin-top:0.5rem">{{ editError }}</p>
        </form>

        <div class="field" style="max-width:200px;margin-bottom:1.25rem">
          <label class="field-label">Board</label>
          <select v-model="board" class="input">
            <option value="rr">Round robin</option>
            <option value="ladder">Ladder</option>
          </select>
        </div>

        <RoundRobinProfile v-if="board === 'rr'" :profile-id="me.profile_id" />

        <template v-else>
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
            <table class="table table-stack-match">
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

        </template>
      </template>
    </div>

    <InstallAppCard />
  </main>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useSeasonsStore } from '@/stores/seasons'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import { supabase } from '@/lib/supabase'
import TierBadge from '@/components/ui/TierBadge.vue'
import LevelBadge from '@/components/ui/LevelBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import RatingChart from '@/components/ui/RatingChart.vue'
import RoundRobinProfile from '@/components/profile/RoundRobinProfile.vue'
import SceneBackdrop from '@/components/ui/SceneBackdrop.vue'
import { useSport } from '@/composables/useSport'
import { heroCopy } from '@/lib/homeStats'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm.vue'
import InstallAppCard from '@/components/ui/InstallAppCard.vue'
import JoinLeagueCard from '@/components/league/JoinLeagueCard.vue'
import type { Match } from '@/types'

const playersStore    = usePlayersStore()
const matchesStore    = useMatchesStore()
const seasonsStore    = useSeasonsStore()
const leagueStore     = useLeagueStore()
const { user, profile, updateProfile } = useAuth()
const route = useRoute()
// the picture behind the header follows the league's sport
const { sport } = useSport()
const art = computed(() => heroCopy(sport.value).art)
// Opened straight from the "set a password" bar (?password=1) or the button.
const changingPassword = ref(route.query.password === '1')

const ratingHistory = ref<{ rating: number; recorded_at: string }[]>([])
const selectedSeasonId = ref('current')
// v0.0.5.2: round robin is the default board; the ladder profile is unchanged.
const board = ref<'rr' | 'ladder'>('rr')

const editingProfile = ref(false)
const editName        = ref('')
const editSaving       = ref(false)
const editError        = ref('')

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

onMounted(async () => {
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100), seasonsStore.fetchSeasons()])
  playersStore.subscribe()
  matchesStore.subscribe()
  await loadRatingHistory()
})

watch(selectedSeasonId, (id) => {
  if (id !== 'current') seasonsStore.fetchRecords(id)
})

// A different league means a different players row, a different match
// history, and different rating history entirely for the same person.
onLeagueChange(async () => {
  selectedSeasonId.value = 'current'
  await Promise.all([playersStore.fetch(), matchesStore.fetch(100), seasonsStore.fetchSeasons()])
  await loadRatingHistory()
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
  editError.value = ''
  editingProfile.value = true
}

async function saveProfile() {
  editSaving.value = true
  editError.value = ''
  const err = await updateProfile({ display_name: editName.value.trim() })
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

<style scoped>
.profile-id { display: flex; align-items: center; gap: 1rem; min-width: 0; }
.profile-name { min-width: 0; }
.profile-name h1 { font-size: clamp(1.4rem, 3vw, 2rem); }
/* under the name, and kept to the left where the picture is darkest, so nothing sits on the brightest part */
.profile-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 0.75rem; margin-top: 0.9rem; max-width: 34rem; }
</style>
