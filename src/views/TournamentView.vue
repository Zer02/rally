<template>
  <main class="page container">
    <div class="page-header">
      <p class="eyebrow">{{ store.active?.name ? 'Season' : 'League' }}</p>
      <h1>Round Robin</h1>
    </div>

    <div style="margin-bottom:1.25rem">
      <PastSeasonsPanel :seasons="store.pastSeasons" :get-standings="store.fetchSeasonStandings" />
    </div>

    <div v-if="store.loading && !store.active" style="text-align:center;padding:3rem 0">
      <span class="spinner" style="width:28px;height:28px;border-width:3px" />
    </div>

    <!-- No active season -->
    <div v-else-if="!store.active" class="card" style="padding:1.5rem">
      <p class="muted" style="margin-bottom:1rem">
        No round robin season is running for this league right now.
      </p>

      <div v-if="isAdmin">
        <div v-if="!creating">
          <button class="btn btn-primary" @click="creating = true">Start a season</button>
        </div>
        <form v-else class="tournament-create-form" @submit.prevent="handleCreate">
          <div class="field" style="margin-bottom:0.75rem">
            <label class="field-label">Season name</label>
            <input v-model="newName" class="input" placeholder="Fall 2026 Round Robin" required />
          </div>
          <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
            Creates an empty season shell. Nobody's enrolled and no matches exist yet — start
            each week separately by picking who showed up.
          </p>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-primary" type="submit" :disabled="creatingSubmit">
              <span v-if="creatingSubmit" class="spinner" style="width:14px;height:14px;border-width:2px" />
              <span v-else>Create season</span>
            </button>
            <button class="btn btn-ghost" type="button" @click="creating = false">Cancel</button>
          </div>
          <p v-if="createError" class="flash flash-error" style="margin-top:0.75rem">{{ createError }}</p>
        </form>
      </div>
      <p v-else class="muted" style="font-size:0.85rem">Check back once an admin starts one.</p>
    </div>

    <!-- Active season -->
    <template v-else>
      <div class="card" style="padding:1.25rem;margin-bottom:1.25rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:0.5rem">
          <h2 style="font-size:1.1rem">{{ store.active.name }}</h2>
          <span class="muted" style="font-size:0.8rem">
            {{ store.weeks.length ? `Week ${store.currentWeek?.week_number}` : 'No weeks started yet' }}
            · {{ store.completedMatches.length }} / {{ store.matches.length }} matches played
          </span>
        </div>
      </div>

      <!-- Standings -->
      <div class="card" style="margin-bottom:1.5rem;overflow-x:auto">
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>W–L</th>
              <th>Pts for</th>
              <th>Pts against</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in store.standings" :key="p.id">
              <td class="mono muted">{{ i + 1 }}</td>
              <td>{{ p.profile?.display_name || p.profile?.username }}</td>
              <td class="mono">{{ p.wins }}–{{ p.losses }}</td>
              <td class="mono">{{ p.points_for }}</td>
              <td class="mono">{{ p.points_against }}</td>
              <td class="mono" :class="{ 'diff-pos': p.points_for - p.points_against > 0, 'diff-neg': p.points_for - p.points_against < 0 }">
                {{ p.points_for - p.points_against > 0 ? '+' : '' }}{{ p.points_for - p.points_against }}
              </td>
            </tr>
            <tr v-if="!store.standings.length">
              <td colspan="6" class="muted" style="text-align:center">Nobody's enrolled yet — start a week to bring players in.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Admin: start a week -->
      <div v-if="isAdmin" style="margin-bottom:1.5rem;display:flex;flex-direction:column;gap:0.75rem">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button v-if="!startingWeek" class="btn btn-primary" @click="startingWeek = true">
            Start week {{ nextWeekNumber }}
          </button>
          <button v-if="store.currentWeek && !addingMatch" class="btn btn-ghost" @click="addingMatch = true">
            Add a match
          </button>
        </div>
        <AttendeePicker
          v-if="startingWeek"
          :players="playersStore.players"
          :next-week-number="nextWeekNumber"
          :on-start="handleStartWeek"
          @cancel="startingWeek = false"
        />
        <AddMatchForm
          v-if="addingMatch"
          :players="playersStore.players"
          :on-add="handleAddMatch"
          @cancel="addingMatch = false"
        />
      </div>

      <!-- Self-report: your pending matches -->
      <div v-if="myPendingMatches.length" style="margin-bottom:1.5rem">
        <h3 style="font-size:0.95rem;margin-bottom:0.6rem">Your matches</h3>
        <div v-for="m in myPendingMatches" :key="m.id" class="card tournament-match-row">
          <MatchScoreRow :match="m" :my-id="user?.id" :on-report="handleReport" :on-remove="isAdmin ? handleRemove : undefined" />
        </div>
      </div>

      <div v-if="isAdmin && otherPendingMatches.length" style="margin-bottom:1.5rem">
        <h3 style="font-size:0.95rem;margin-bottom:0.6rem">Other pending matches (admin override)</h3>
        <div v-for="m in otherPendingMatches" :key="m.id" class="card tournament-match-row">
          <MatchScoreRow :match="m" :my-id="user?.id" admin-mode :on-report="handleReport" :on-remove="handleRemove" />
        </div>
      </div>

      <div v-if="store.completedMatches.length" style="margin-bottom:1.5rem">
        <h3 style="font-size:0.95rem;margin-bottom:0.6rem">Completed</h3>
        <div v-for="m in store.completedMatches" :key="m.id" class="tournament-completed-row muted">
          {{ m.player_a?.display_name || m.player_a?.username }}
          <strong class="mono">{{ m.score_a }}–{{ m.score_b }}</strong>
          {{ m.player_b?.display_name || m.player_b?.username }}
        </div>
      </div>

      <!-- Admin: season tools -->
      <div v-if="isAdmin" class="card" style="padding:1.25rem">
        <div class="field-label" style="margin-bottom:0.4rem">Season tools</div>
        <p class="muted" style="font-size:0.8rem;margin-bottom:0.75rem">
          Locks the season, computes the strength-of-schedule adjusted score from round-robin
          matches, and assigns final seeds. Cannot be undone.
        </p>
        <button class="btn btn-ghost" :disabled="finalizing" @click="handleFinalize">
          <span v-if="finalizing" class="spinner" style="width:14px;height:14px;border-width:2px" />
          <span v-else>Finalize season</span>
        </button>
      </div>

      <p v-if="reportError" class="flash flash-error" style="margin-top:1rem">{{ reportError }}</p>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTournamentsStore } from '@/stores/tournaments'
import { usePlayersStore } from '@/stores/players'
import { useAuth } from '@/composables/useAuth'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import MatchScoreRow from '@/components/tournament/MatchScoreRow.vue'
import AttendeePicker from '@/components/tournament/AttendeePicker.vue'
import AddMatchForm from '@/components/tournament/AddMatchForm.vue'
import PastSeasonsPanel from '@/components/tournament/PastSeasonsPanel.vue'

const store = useTournamentsStore()
const playersStore = usePlayersStore()
const { user, isAdmin } = useAuth()

const creating = ref(false)
const creatingSubmit = ref(false)
const createError = ref('')
const newName = ref('')
const reportError = ref('')
const startingWeek = ref(false)
const addingMatch = ref(false)
const finalizing = ref(false)

onMounted(() => {
  store.fetchActive()
  store.fetchPastSeasons()
  playersStore.fetch()
})
onLeagueChange(() => {
  creating.value = false
  startingWeek.value = false
  addingMatch.value = false
  store.fetchActive()
  store.fetchPastSeasons()
  playersStore.fetch()
})

const nextWeekNumber = computed(() => (store.currentWeek?.week_number ?? 0) + 1)

const myPendingMatches = computed(() =>
  store.pendingMatches.filter(m => m.player_a_id === user.value?.id || m.player_b_id === user.value?.id)
)
const otherPendingMatches = computed(() =>
  store.pendingMatches.filter(m => m.player_a_id !== user.value?.id && m.player_b_id !== user.value?.id)
)

async function handleCreate() {
  creatingSubmit.value = true
  createError.value = ''
  try {
    await store.createTournament(newName.value.trim())
    newName.value = ''
    creating.value = false
  } catch (e: any) {
    createError.value = e.message
  }
  creatingSubmit.value = false
}

async function handleStartWeek(attendeeIds: string[], targetMatches: number) {
  await store.startWeek(attendeeIds, targetMatches)
  startingWeek.value = false
}

async function handleAddMatch(playerAId: string, playerBId: string) {
  await store.addMatch(playerAId, playerBId)
  addingMatch.value = false
}

async function handleRemove(matchId: string) {
  reportError.value = ''
  try {
    await store.cancelMatch(matchId)
  } catch (e: any) {
    reportError.value = e.message
  }
}

async function handleReport(matchId: string, scoreA: number, scoreB: number) {
  reportError.value = ''
  try {
    await store.reportMatch(matchId, scoreA, scoreB)
  } catch (e: any) {
    reportError.value = e.message
  }
}

async function handleFinalize() {
  if (!confirm('Finalize the season? This locks it and cannot be undone.')) return
  finalizing.value = true
  reportError.value = ''
  try {
    await store.finalizeTournament()
  } catch (e: any) {
    reportError.value = e.message
  }
  finalizing.value = false
}
</script>

<style scoped>
.diff-pos { color: var(--net); }
.diff-neg { color: var(--ace); }
.tournament-match-row { padding: 0.9rem 1rem; margin-bottom: 0.6rem; }
.tournament-completed-row {
  font-size: 0.85rem; padding: 0.5rem 0.25rem;
  border-bottom: 1px solid var(--line);
}
.tournament-completed-row:last-child { border-bottom: none; }
.field-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--txt-muted); display: block; }
</style>
