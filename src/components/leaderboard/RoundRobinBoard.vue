<!--
  RoundRobinBoard — v0.0.5.2 (points added v0.0.6.2). The leaderboard's
  default view: round robin standings with two dropdowns.

    Season  — the running season, any finalized past season, or "All-time"
              (career round robin stats from the players table).
    Rank by — what the table is sorted on. Options depend on the season
              choice (season stats vs. career stats).

  Every number a column shows is baked onto the row inside the computed
  (row.extra), same reason as the ladder board: StandingsTable only
  re-renders when its `rows`/`columns` props change reference, so values
  can't be resolved lazily from a closure over the dropdown state.
-->
<template>
  <div>
    <div class="board-filters">
      <div class="field" style="min-width:170px">
        <label class="field-label">Season</label>
        <select v-model="season" class="input">
          <option value="current">{{ currentLabel }}</option>
          <option v-for="s in store.pastSeasons" :key="s.id" :value="s.id">{{ s.name }}</option>
          <option value="alltime">All-time</option>
        </select>
      </div>
      <div class="field" style="min-width:170px">
        <label class="field-label">Rank by</label>
        <select v-model="metric" class="input">
          <option v-for="o in metricOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <div v-if="busy" style="text-align:center;padding:3rem 0">
      <span class="spinner" style="width:28px;height:28px;border-width:3px" />
    </div>

    <template v-else>
      <p v-if="loadError" class="flash flash-error" style="margin-bottom:1rem">{{ loadError }}</p>
      <StandingsTable
        :rows="board.rows"
        :columns="board.columns"
        :rating-label="board.ratingLabel"
        :me-id="user?.id"
        :empty-message="board.empty"
      />
      <PointsKey v-if="!isAllTime" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useTournamentsStore } from '@/stores/tournaments'
import { usePlayersStore } from '@/stores/players'
import { useAuth } from '@/composables/useAuth'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import StandingsTable, { type StandingRow, type StandingColumn } from '@/components/leaderboard/StandingsTable.vue'
import PointsKey from '@/components/tournament/PointsKey.vue'
import type { TournamentParticipant } from '@/types'

const store        = useTournamentsStore()
const playersStore = usePlayersStore()
const { user }     = useAuth()

// 'current' | 'alltime' | a completed tournament's id
const season = ref<string>('current')
const metric = ref<string>('points')

const pastRows   = ref<TournamentParticipant[]>([])
const pastLoading = ref(false)
const loadError  = ref('')

const isAllTime = computed(() => season.value === 'alltime')
const isPast    = computed(() => season.value !== 'current' && season.value !== 'alltime')
const busy      = computed(() => store.loading || pastLoading.value)

const currentLabel = computed(() =>
  store.active ? `Current season — ${store.active.name}` : 'Current season'
)

const SEASON_METRICS = [
  { value: 'points',    label: 'Points' },
  { value: 'wins',      label: 'Wins' },
  { value: 'rr_rating', label: 'RR rating' },
  { value: 'win_pct',   label: 'Win %' },
  { value: 'games_won', label: 'Games won' },
]
const ALLTIME_METRICS = [
  { value: 'titles',  label: 'Titles' },
  { value: 'seasons', label: 'Seasons played' },
  { value: 'best',    label: 'Best finish' },
]
const metricOptions = computed(() => {
  if (isAllTime.value) return ALLTIME_METRICS
  if (isPast.value) return [{ value: 'standings', label: 'Final placing' }, ...SEASON_METRICS]
  return SEASON_METRICS
})

// ── loading ────────────────────────────────────────────────────────
async function loadAll() {
  loadError.value = ''
  await Promise.all([store.fetchActive(), store.fetchPastSeasons(), playersStore.fetch()])
  // No running season → land on the most recent finished one instead of
  // an empty page.
  if (season.value === 'current' && !store.active && store.pastSeasons.length) {
    season.value = store.pastSeasons[0].id
  }
}

let loadToken = 0
async function loadPast(id: string) {
  const token = ++loadToken
  pastLoading.value = true
  loadError.value = ''
  try {
    const data = await store.fetchSeasonStandings(id)
    if (token === loadToken) pastRows.value = data
  } catch (e) {
    if (token === loadToken) { pastRows.value = []; loadError.value = (e as Error).message }
  } finally {
    if (token === loadToken) pastLoading.value = false
  }
}

watch(season, (id) => {
  metric.value = id === 'alltime' ? 'titles' : id === 'current' ? 'points' : 'standings'
  if (id !== 'current' && id !== 'alltime') loadPast(id)
})

onMounted(loadAll)
onLeagueChange(async () => {
  season.value = 'current'
  metric.value = 'points'
  pastRows.value = []
  await loadAll()
})

// ── building the table ─────────────────────────────────────────────
type Row = StandingRow & { extra: Record<string, string> }

function nameOf(p?: { display_name: string | null; username: string } | null) {
  return p?.display_name || p?.username || 'Unknown'
}
function pct(w: number, l: number) { return w + l > 0 ? Math.round((w / (w + l)) * 100) : null }
function pctLabel(w: number, l: number) { const v = pct(w, l); return v === null ? '—' : `${v}%` }

const board = computed<{ rows: Row[]; columns: StandingColumn[]; ratingLabel: string; empty: string }>(() => {
  const col = (key: string, label: string, mobile = true): StandingColumn =>
    ({ key, label, mobile, value: (r) => (r as Row).extra[key] ?? '—' })

  // ── All-time: career round robin stats ──
  if (isAllTime.value) {
    const m = metric.value
    const players = playersStore.players.filter(p => (p.rr_seasons_played ?? 0) > 0)
    const best = (p: typeof players[number]) => p.rr_best_finish ?? Infinity
    const sorted = [...players]
      .filter(p => m !== 'best' || p.rr_best_finish != null)
      .sort((a, b) => {
        if (m === 'seasons') return b.rr_seasons_played - a.rr_seasons_played || b.rr_titles - a.rr_titles
        if (m === 'best')    return best(a) - best(b) || b.rr_titles - a.rr_titles
        return b.rr_titles - a.rr_titles || best(a) - best(b) || b.rr_seasons_played - a.rr_seasons_played
      })
    const primary = { titles: 'Titles', seasons: 'Seasons', best: 'Best finish' }[m] ?? 'Titles'
    const rows: Row[] = sorted.map(p => ({
      id: p.id, profile_id: p.profile_id, name: nameOf(p.profile), unit: p.profile?.unit,
      rating: m === 'seasons' ? p.rr_seasons_played : m === 'best' ? (p.rr_best_finish ?? 0) : p.rr_titles,
      extra: {
        titles:  String(p.rr_titles),
        best:    p.rr_best_finish ? `#${p.rr_best_finish}` : '—',
        seasons: String(p.rr_seasons_played),
      },
    }))
    const columns = [col('titles', 'Titles'), col('best', 'Best finish'), col('seasons', 'Seasons')]
      .filter(c => c.key !== m)
    return { rows, columns, ratingLabel: primary, empty: 'No finished round robin seasons yet.' }
  }

  // ── A season: running or finished ──
  const source: TournamentParticipant[] = isPast.value ? pastRows.value : store.standings
  const m = metric.value
  const pctSort = (p: TournamentParticipant) => pct(p.wins, p.losses) ?? -1
  // Points order: match points, then wins, then games won — the same
  // order finalize_tournament() seeds by.
  const byPoints = (a: TournamentParticipant, b: TournamentParticipant) =>
    b.rr_points - a.rr_points || b.wins - a.wins || b.points_for - a.points_for
  const sorted = [...source].sort((a, b) => {
    if (m === 'wins')      return b.wins - a.wins || byPoints(a, b)
    if (m === 'rr_rating') return b.rr_rating - a.rr_rating
    if (m === 'win_pct')   return pctSort(b) - pctSort(a) || b.wins - a.wins
    if (m === 'games_won') return b.points_for - a.points_for || b.wins - a.wins
    // Final placing: a finished season keeps its official final seed order
    // (bracket results can reorder it, and seasons finished before points
    // existed were seeded wins-first). 'points' is the plain points order.
    if (m === 'standings') {
      const sa = a.seed ?? Infinity, sb = b.seed ?? Infinity
      if (sa !== sb) return sa - sb
    }
    return byPoints(a, b)
  })

  const primaryOf = (p: TournamentParticipant) =>
    m === 'rr_rating' ? p.rr_rating : m === 'win_pct' ? (pct(p.wins, p.losses) ?? 0)
      : m === 'games_won' ? p.points_for : m === 'wins' ? p.wins : p.rr_points
  const ratingLabel = { standings: 'Points', points: 'Points', wins: 'Wins', rr_rating: 'RR Rating', win_pct: 'Win %', games_won: 'Games won' }[m] ?? 'Points'

  const rows: Row[] = sorted.map(p => ({
    id: p.id, profile_id: p.profile_id, name: nameOf(p.profile), unit: p.profile?.unit,
    rating: primaryOf(p),
    extra: {
      final: p.seed ? `#${p.seed}` : '—',
      pts:   String(p.rr_points),
      wl:    `${p.wins}–${p.losses}`,
      pct:   pctLabel(p.wins, p.losses),
      gw:    String(p.points_for),
      rr:    String(Math.round(p.rr_rating)),
    },
  }))

  const columns = [
    ...(isPast.value ? [col('final', 'Final')] : []),
    col('pts', 'Points'),
    col('wl', 'W–L'),
    col('pct', 'Win %'),
    col('gw', 'Games won', false),
    col('rr', 'RR Rating'),
  ].filter(c => !(c.key === 'pts' && (m === 'points' || m === 'standings')) && !(c.key === 'pct' && m === 'win_pct') && !(c.key === 'gw' && m === 'games_won') && !(c.key === 'rr' && m === 'rr_rating'))

  const empty = isPast.value
    ? 'Nobody was enrolled in this season.'
    : store.active ? "Nobody's enrolled yet — standings appear once the first week starts."
    : 'No round robin season is running right now.'
  return { rows, columns, ratingLabel, empty }
})
</script>

<style scoped>
.board-filters { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: flex-end; margin-bottom: 1rem; }
/* v0.0.6.5: on a phone the two dropdowns stack full width and line up with the
   rest of the page (they were indented on one side and right-aligned on the other). */
@media (max-width: 600px) {
  .board-filters { justify-content: stretch; flex-direction: column; gap: 0.75rem; }
  .board-filters .field { min-width: 0 !important; width: 100%; }
}
</style>
