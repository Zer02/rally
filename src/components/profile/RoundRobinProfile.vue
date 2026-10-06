<!--
  RoundRobinProfile — v0.0.5.2. The Profile page's default body: a player's
  round robin record, with one Season dropdown (the running season, any
  finished season they played, or "All-time" for career). The page shows
  everything at once, like the ladder profile: stat cards, the rating
  graph, season history (All-time only) and match history (every completed
  singles/doubles match in the chosen season, or all of them).

  The rating graph (v0.0.5.3) plots rr_rating_history: the rating after
  every match in the chosen season. Each season starts everyone at 1000, so
  "All-time" can't be one continuous line — it plots each season's ending
  rating instead. The ladder's own graph stays on the Ladder board.
-->
<template>
  <div>
    <div class="rr-filters">
      <div class="field" style="min-width:170px">
        <label class="field-label">Season</label>
        <select v-model="season" class="input">
          <option value="current">{{ currentLabel }}</option>
          <option v-for="h in history" :key="h.tournament.id" :value="h.tournament.id">{{ h.tournament.name }}</option>
          <option value="alltime">All-time</option>
        </select>
      </div>
    </div>

    <div v-if="loading" style="text-align:center;padding:2rem">
      <span class="spinner" style="width:24px;height:24px;border-width:3px" />
    </div>

    <template v-else>
      <p v-if="error" class="flash flash-error" style="margin-bottom:1rem">{{ error }}</p>

      <!-- ── Overview ── -->
        <p v-if="season === 'current' && !store.active" class="card muted" style="padding:1.25rem;text-align:center">
          No round robin season is running right now.
        </p>
        <p v-else-if="season === 'current' && !currentRow" class="card muted" style="padding:1.25rem;text-align:center">
          You haven't been enrolled in this season yet — you'll appear once you're picked for a week.
        </p>

        <div v-else class="stat-grid" style="margin-bottom:1.5rem">
          <div v-for="c in statCells" :key="c.label" class="stat-cell">
            <p class="stat-label">{{ c.label }}</p>
            <p class="stat-value" :style="c.small ? 'font-size:1.1rem' : ''">{{ c.value }}</p>
          </div>
        </div>

        <div v-if="showChart" class="card" style="margin-bottom:1.5rem;padding:1.25rem 1.25rem 0.75rem">
          <div class="card-header" style="margin-bottom:0.25rem">
            <h3>{{ season === 'alltime' ? 'Season-end RR rating' : 'RR rating history' }}</h3>
          </div>
          <RatingChart :history="chartHistory" />
        </div>

        <div v-if="season === 'alltime'" class="card" style="overflow:hidden;margin-bottom:1.5rem">
          <div class="card-header"><h3>Season history</h3></div>
          <p v-if="!history.length" class="muted" style="padding:1.5rem;text-align:center">
            No finished seasons yet.
          </p>
          <div v-else class="table-scroll">
            <table class="table table-stack-season">
              <thead><tr><th>Season</th><th>Finish</th><th>W–L</th><th>RR rating</th><th>Date</th></tr></thead>
              <tbody>
                <tr v-for="h in history" :key="h.tournament.id">
                  <td>{{ h.tournament.name }}</td>
                  <td class="mono">{{ h.seed ? `#${h.seed}` : '—' }}</td>
                  <td class="mono">{{ h.wins }}–{{ h.losses }}</td>
                  <td class="mono">{{ Math.round(h.rr_rating) }}</td>
                  <td class="muted mono">{{ formatDate(h.tournament.completed_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>


      <!-- ── Match history ── -->
      <div class="card" style="overflow:hidden;margin-top:0.25rem">
        <div class="card-header"><h3>Round robin matches</h3></div>
        <p v-if="matchesLoading" style="text-align:center;padding:1.5rem">
          <span class="spinner" style="width:18px;height:18px;border-width:2px" />
        </p>
        <p v-else-if="!matchRows.length" class="muted" style="padding:2rem;text-align:center">
          No round robin matches {{ season === 'alltime' ? 'yet' : 'in this season' }}.
        </p>
        <div v-else class="table-scroll">
          <table class="table table-stack-match">
            <thead>
              <tr>
                <th>Result</th><th>Match</th><th>Score</th><th>Δ</th>
                <th v-if="season === 'alltime'">Season</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in matchRows" :key="m.id">
                <td><span :class="m.won ? 'win' : 'loss'">{{ m.won ? 'W' : 'L' }}</span></td>
                <td>
                  <span v-if="m.partner" class="muted">w/ {{ m.partner }} · </span>vs {{ m.opponents }}
                  <span v-if="m.doubles" class="muted" style="font-size:0.72rem"> (doubles)</span>
                </td>
                <td class="mono">{{ m.score }}</td>
                <td>
                  <span v-if="m.delta !== null" class="delta" :class="m.delta >= 0 ? 'delta-pos' : 'delta-neg'">
                    {{ m.delta >= 0 ? '+' : '' }}{{ m.delta.toFixed(1) }}
                  </span>
                  <span v-else class="muted">—</span>
                </td>
                <td v-if="season === 'alltime'" class="muted">{{ m.season }}</td>
                <td class="muted mono">{{ formatDate(m.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useTournamentsStore } from '@/stores/tournaments'
import { usePlayersStore } from '@/stores/players'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import RatingChart from '@/components/ui/RatingChart.vue'
import type { Tournament, TournamentMatch } from '@/types'

const props = defineProps<{ profileId: string }>()

const store        = useTournamentsStore()
const playersStore = usePlayersStore()

interface HistoryRow {
  wins: number; losses: number; seed: number | null; adjusted_score: number | null
  points_for: number; points_against: number; rr_rating: number; tournament: Tournament
}
type MatchWithSeason = TournamentMatch & { tournament: { id: string; name: string } }

const season = ref<string>('current')   // 'current' | 'alltime' | tournament id

const history        = ref<HistoryRow[]>([])
const loading        = ref(false)
const error          = ref('')
const matches        = ref<MatchWithSeason[]>([])
interface RatingRow { tournament_id: string; match_id: string; rating: number; delta: number; recorded_at: string }
const ratingRows     = ref<RatingRow[]>([])
const matchesLoading = ref(false)

// ── loading ────────────────────────────────────────────────────────
async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [hist] = await Promise.all([
      store.fetchProfileRoundRobinHistory(props.profileId) as Promise<HistoryRow[]>,
      store.fetchActive(),
      playersStore.fetch(),
    ])
    history.value = hist
    // Land on the most useful default: the running season if they're in
    // it, otherwise their latest finished season, otherwise all-time.
    if (season.value === 'current' && !currentRow.value) {
      season.value = history.value[0]?.tournament.id ?? 'current'
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

let matchToken = 0
async function loadMatches() {
  const token = ++matchToken
  // No season running → nothing to fetch for "current".
  if (season.value === 'current' && !store.active) { matches.value = []; return }
  matchesLoading.value = true
  try {
    const tid = season.value === 'alltime' ? null : season.value === 'current' ? store.active!.id : season.value
    const data = await store.fetchProfileMatches(props.profileId, tid)
    if (token === matchToken) matches.value = data
  } catch (e) {
    if (token === matchToken) { matches.value = []; error.value = (e as Error).message }
  } finally {
    if (token === matchToken) matchesLoading.value = false
  }
}

let ratingToken = 0
async function loadRatingRows() {
  const token = ++ratingToken
  // "All-time" needs every season (for season-end points and match deltas).
  if (season.value === 'current' && !store.active) { ratingRows.value = []; return }
  try {
    const tid = season.value === 'alltime' ? null : season.value === 'current' ? store.active!.id : season.value
    const data = await store.fetchProfileRatingHistory(props.profileId, tid)
    if (token === ratingToken) ratingRows.value = data
  } catch (e) {
    if (token === ratingToken) { ratingRows.value = []; error.value = (e as Error).message }
  }
}

onMounted(async () => { await loadAll(); await Promise.all([loadMatches(), loadRatingRows()]) })
watch(season, () => { loadMatches(); loadRatingRows() })
onLeagueChange(async () => {
  season.value = 'current'
  await loadAll()
  await Promise.all([loadMatches(), loadRatingRows()])
})

// ── derived data ───────────────────────────────────────────────────
const currentLabel = computed(() => store.active ? `Current season — ${store.active.name}` : 'Current season')

const currentRow = computed(() => store.participants.find(p => p.profile_id === props.profileId) ?? null)
const pastRow    = computed(() => history.value.find(h => h.tournament.id === season.value) ?? null)
const player     = computed(() => playersStore.byId(props.profileId))

function pct(w: number, l: number) { return w + l > 0 ? `${Math.round((w / (w + l)) * 100)}%` : '—' }

interface Cell { label: string; value: string | number; small?: boolean }
const statCells = computed<Cell[]>(() => {
  if (season.value === 'alltime') {
    // Career = every finished season plus whatever the running one has so far.
    const rows = [...history.value.map(h => ({ w: h.wins, l: h.losses, gf: h.points_for })),
                  ...(currentRow.value ? [{ w: currentRow.value.wins, l: currentRow.value.losses, gf: currentRow.value.points_for }] : [])]
    const w = rows.reduce((n, r) => n + r.w, 0)
    const l = rows.reduce((n, r) => n + r.l, 0)
    const gf = rows.reduce((n, r) => n + r.gf, 0)
    return [
      { label: 'Titles', value: player.value?.rr_titles ?? 0 },
      { label: 'Best finish', value: player.value?.rr_best_finish ? `#${player.value.rr_best_finish}` : '—' },
      { label: 'Seasons played', value: player.value?.rr_seasons_played ?? 0 },
      { label: 'Career W–L', value: `${w}–${l}`, small: true },
      { label: 'Career win %', value: pct(w, l), small: true },
      { label: 'Career games won', value: gf, small: true },
    ]
  }
  if (season.value === 'current') {
    const r = currentRow.value
    if (!r) return []
    const rank = store.rankByProfileId.get(props.profileId)
    return [
      { label: 'RR rating', value: Math.round(r.rr_rating) },
      { label: 'Rank', value: rank ? `#${rank}` : '—' },
      { label: 'W–L', value: `${r.wins}–${r.losses}`, small: true },
      { label: 'Win %', value: pct(r.wins, r.losses), small: true },
      { label: 'Games won', value: r.points_for, small: true },
      { label: 'Games lost', value: r.points_against, small: true },
    ]
  }
  const h = pastRow.value
  if (!h) return []
  return [
    { label: 'Final placing', value: h.seed ? `#${h.seed}` : '—' },
    { label: 'RR rating', value: Math.round(h.rr_rating) },
    { label: 'W–L', value: `${h.wins}–${h.losses}`, small: true },
    { label: 'Win %', value: pct(h.wins, h.losses), small: true },
    { label: 'Games won', value: h.points_for, small: true },
    { label: 'Games lost', value: h.points_against, small: true },
  ]
})

// Chart points. Season views: the rating after each match, starting from
// the pre-first-match rating (rating - delta) so one match already draws a
// line. All-time: one point per season — the final rating of each finished
// season, then the running season's latest. Rounded so the chart's
// footer labels read as whole numbers.
const chartHistory = computed(() => {
  if (season.value === 'alltime') {
    const pts = [...history.value]
      .sort((a, b) => new Date(a.tournament.completed_at ?? 0).getTime() - new Date(b.tournament.completed_at ?? 0).getTime())
      .map(h => ({ rating: Math.round(h.rr_rating), recorded_at: h.tournament.completed_at ?? '' }))
    if (currentRow.value && store.active) {
      pts.push({ rating: Math.round(currentRow.value.rr_rating), recorded_at: new Date().toISOString() })
    }
    return pts
  }
  const rows = ratingRows.value
  if (!rows.length) return []
  const first = rows[0]
  return [
    { rating: Math.round(first.rating - first.delta), recorded_at: first.recorded_at },
    ...rows.map(r => ({ rating: Math.round(r.rating), recorded_at: r.recorded_at })),
  ]
})
const showChart = computed(() =>
  season.value === 'alltime'
    ? true
    : !(season.value === 'current' && !currentRow.value)
)

function nameOf(p?: { display_name: string | null; username: string } | null) {
  return p?.display_name || p?.username || '?'
}

const deltaByMatch = computed(() => new Map(ratingRows.value.map(r => [r.match_id, r.delta])))

const matchRows = computed(() =>
  matches.value.map(m => {
    const me = props.profileId
    const onA = m.player_a_id === me || m.player_a2_id === me
    const mine   = onA ? m.score_a : m.score_b
    const theirs = onA ? m.score_b : m.score_a
    const mates  = onA ? [m.player_a, m.player_a2] : [m.player_b, m.player_b2]
    const foes   = onA ? [m.player_b, m.player_b2] : [m.player_a, m.player_a2]
    const partner = m.format === 'doubles'
      ? mates.filter(p => p && p.id !== me).map(nameOf)[0] ?? null
      : null
    return {
      id: m.id,
      // Decided from the score rather than winner_id, which for doubles
      // only names one player.
      won: (mine ?? 0) > (theirs ?? 0),
      partner,
      opponents: foes.filter(Boolean).map(nameOf).join(' & ') || '?',
      doubles: m.format === 'doubles',
      score: mine != null && theirs != null ? `${mine}–${theirs}` : '—',
      delta: deltaByMatch.value.get(m.id) ?? null,
      season: m.tournament?.name ?? '',
      date: m.completed_at,
    }
  })
)

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.rr-filters { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
</style>
