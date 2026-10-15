<!--
  HomeDashboard — v0.0.7.6. A signed-in player's day on one screen: where they stand in the
  season, their matches this week, their level, and the two things they do most.
  Everything here is read from stores the other pages already use; nothing new on the server.
-->
<template>
  <section class="hello">
    <p class="eyebrow">{{ leagueName }}</p>
    <h1>Hi, {{ firstName }}</h1>
  </section>

  <p v-if="!ready" class="muted loading">Loading your season…</p>

  <div v-else class="dash">
    <!-- Where you stand -->
    <section class="card block season-card" data-test="season-card">
      <template v-if="store.active">
        <div class="card-head card-head-stack">
          <h3>{{ store.active.name }}</h3>
          <span class="muted card-sub">{{ weekLabel }}</span>
        </div>
        <div
          v-if="week.total"
          class="week-track"
          role="progressbar"
          aria-label="Matches played this week"
          :aria-valuenow="week.pct"
          aria-valuemin="0"
          aria-valuemax="100"
          data-test="week-progress"
        >
          <div class="week-fill" :style="{ width: week.pct + '%' }" />
        </div>
        <div v-if="myRow" class="stats">
          <div class="stat"><span class="stat-val mono">#{{ myRank }}</span><span class="stat-label">of {{ store.standings.length }}</span></div>
          <div class="stat"><span class="stat-val mono">{{ myRow.rr_points }}</span><span class="stat-label">points</span></div>
          <div class="stat"><span class="stat-val mono">{{ myRow.wins }}–{{ myRow.losses }}</span><span class="stat-label">record</span></div>
        </div>
        <p v-else class="muted empty">You're not in this season yet. Ask your league admin to add you.</p>
        <p v-if="streak >= 2" class="streak" data-test="streak">🔥 {{ streak }}-win streak</p>
        <div class="card-foot">
          <RouterLink to="/leaderboard" class="card-link">Full standings →</RouterLink>
          <span v-if="seasonPlayed" class="muted card-sub">{{ seasonPlayed }} {{ seasonPlayed === 1 ? 'match' : 'matches' }} this season</span>
        </div>
      </template>
      <template v-else>
        <h3>No season running</h3>
        <p class="muted empty">When your league starts a season, your rank and your matches will show up here.</p>
      </template>
    </section>

    <!-- Your matches this week -->
    <section v-if="store.active && store.currentWeek" class="card block week-card" data-test="week-card">
      <div class="card-head">
        <h3>Your matches this week</h3>
      </div>
      <ul v-if="myMatches.length" class="match-list">
        <li v-for="m in myMatches" :key="m.id" class="match-row">
          <div class="match-who">
            <span class="match-opp">vs {{ m.opponents }}</span>
            <span v-if="m.meta" class="match-meta muted">{{ m.meta }}</span>
          </div>
          <span class="chip" :class="m.chipClass">{{ m.chip }}</span>
        </li>
      </ul>
      <p v-else class="muted empty">Nothing on your card yet this week.</p>
      <RouterLink to="/tournament" class="card-link">Open Round Robin →</RouterLink>
    </section>

    <!-- Level -->
    <RouterLink v-if="me" to="/progress" class="card block level-card" data-test="level-card">
      <div class="card-head">
        <h3>Level {{ lp.current.level }} · {{ lp.current.title }}</h3>
        <span class="muted card-sub mono">{{ me.xp ?? 0 }} XP</span>
      </div>
      <div class="xp-track" role="progressbar" :aria-valuenow="lp.progressPct" aria-valuemin="0" aria-valuemax="100">
        <div class="xp-fill" :style="{ width: lp.progressPct + '%' }" />
      </div>
      <p class="muted level-next">
        <template v-if="lp.next">{{ lp.xpForLevel - lp.xpIntoLevel }} XP to {{ lp.next.title }}</template>
        <template v-else>You've reached the top level.</template>
      </p>
    </RouterLink>

    <!-- The two things players do most (the rest is in the tab bar) -->
    <div class="actions">
      <RouterLink to="/challenge" class="btn btn-primary">Challenge someone</RouterLink>
      <RouterLink to="/tournament" class="btn btn-ghost">Round Robin</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useSport } from '@/composables/useSport'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import { useTournamentsStore } from '@/stores/tournaments'
import { usePlayersStore } from '@/stores/players'
import { levelProgress } from '@/lib/xp'
import { winStreak, headToHead, headToHeadText } from '@/lib/form'
import type { Profile, TournamentMatch } from '@/types'

const { user, profile } = useAuth()
const { sport, leagueName } = useSport()
const store = useTournamentsStore()
const playersStore = usePlayersStore()

const ready = ref(false)
async function load() {
  try { await Promise.all([store.fetchActive(), playersStore.fetch()]) }
  finally { ready.value = true }
}
onMounted(load)
onLeagueChange(load)

const nameOf = (p?: Profile | null) => p?.display_name || p?.username || 'Player'
const firstName = computed(() => nameOf(profile.value).split(/\s+/)[0] || 'there')
const myId = computed(() => user.value?.id ?? '')

// Season
const myRow = computed(() => store.standings.find(p => p.profile_id === myId.value) ?? null)
const myRank = computed(() => store.rankByProfileId.get(myId.value) ?? 0)
// This week's matches played, as a count and a bar. Seasons have no planned length, so
// the bar measures the week, not the season; the season total is shown as a plain number.
const week = computed(() => {
  const all = store.currentWeekMatches.filter(m => m.status !== 'bye')
  const done = all.filter(m => m.status === 'completed').length
  return { total: all.length, done, pct: all.length ? Math.round((done / all.length) * 100) : 0 }
})
const weekLabel = computed(() => {
  const w = store.currentWeek
  if (!w) return 'No week started yet'
  if (!week.value.total) return `Week ${w.week_number} · no matches set yet`
  return `Week ${w.week_number} · ${week.value.done} of ${week.value.total} matches played`
})
const seasonPlayed = computed(() => store.completedMatches.filter(m => m.status !== 'bye').length)

// Form: wins in a row this season (shown from two up)
const streak = computed(() => winStreak(store.matches, myId.value))

// This week, from this player's side of each match
const ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }
const myMatches = computed(() => {
  const id = myId.value
  const mine = (m: TournamentMatch) => [m.player_a_id, m.player_a2_id, m.player_b_id, m.player_b2_id].includes(id)
  return store.currentWeekMatches
    .filter(m => m.status !== 'bye' && mine(m))
    .sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3))
    .map(m => {
      const onA = m.player_a_id === id || m.player_a2_id === id
      const side = onA ? [m.player_a, m.player_a2] : [m.player_b, m.player_b2]
      const other = onA ? [m.player_b, m.player_b2] : [m.player_a, m.player_a2]
      const partner = side.find(p => p && p.id !== id)
      const mineScore = onA ? m.score_a : m.score_b
      const theirScore = onA ? m.score_b : m.score_a
      let chip = 'To play', chipClass = 'chip-todo'
      if (m.status === 'in_progress') { chip = m.court ? `Court ${m.court}` : 'Playing now'; chipClass = 'chip-live' }
      else if (m.status === 'completed' && mineScore != null && theirScore != null) {
        const won = mineScore > theirScore
        chip = `${won ? 'Won' : 'Lost'} ${mineScore}–${theirScore}`; chipClass = won ? 'chip-won' : 'chip-lost'
      }
      // The line under the opponent: who you partner, whether it is a challenge, and for a
      // one-on-one that is still to play, how you have done against them this season.
      const singles = !m.player_a2_id && !m.player_b2_id
      const oppId = onA ? m.player_b_id : m.player_a_id
      const upcoming = m.status === 'pending' || m.status === 'in_progress'
      const meta = [
        partner ? `with ${nameOf(partner)}` : '',
        m.phase === 'challenge' ? 'Challenge match' : '',
        singles && upcoming && oppId ? headToHeadText(headToHead(store.matches, id, oppId)) : '',
      ].filter(Boolean).join(' · ')
      return {
        id: m.id,
        opponents: other.filter(Boolean).map(p => nameOf(p)).join(' & ') || 'TBD',
        meta,
        chip, chipClass,
      }
    })
})

// Level
const me = computed(() => playersStore.byId(myId.value))
const lp = computed(() => levelProgress(me.value?.xp ?? 0, sport.value))
</script>

<style scoped>
.hello { padding: 0.5rem 0 1.25rem; }
.hello h1 { margin-top: 0.5rem; }
.loading { padding: 1rem 0; }

.block { padding: 1rem 1.25rem; margin-bottom: 1rem; display: block; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem; }
.card-head h3 { margin: 0; }
.card-head-stack { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
.card-sub { font-size: 0.8rem; }
.card-link { display: inline-block; margin-top: 0.75rem; font-size: 0.85rem; color: var(--ball); }
.empty { font-size: 0.9rem; line-height: 1.55; margin: 0; }

.week-track { height: 6px; border-radius: 999px; background: var(--table); border: 1px solid var(--line); overflow: hidden; margin-bottom: 0.9rem; }
.week-fill { height: 100%; background: var(--net); border-radius: 999px; transition: width 0.3s; }
.streak { margin: 0.75rem 0 0; font-size: 0.9rem; font-weight: 600; color: var(--ball); }
.card-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--table); }
.stat { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; padding: 0.8rem 0.25rem; }
.stat + .stat { border-left: 1px solid var(--line); }
.stat-val { font-size: 1.5rem; color: var(--txt-primary); line-height: 1.1; }
.stat:first-child .stat-val { color: var(--ball); }
.stat-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--txt-muted); }

.match-list { list-style: none; margin: 0; padding: 0; }
.match-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0; border-top: 1px solid var(--line); }
.match-row:first-child { border-top: 0; padding-top: 0.1rem; }
.match-who { display: flex; flex-direction: column; min-width: 0; }
.match-opp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.match-meta { font-size: 0.75rem; }
.chip { flex-shrink: 0; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 999px; border: 1px solid var(--line); color: var(--txt-secondary); white-space: nowrap; }
.chip-live { color: var(--table); background: var(--ball); border-color: var(--ball); }
.chip-won { color: var(--net); border-color: var(--net); }
.chip-lost { color: var(--ace); border-color: var(--ace); }

.level-card { color: inherit; text-decoration: none; }
.level-card:hover { border-color: var(--txt-muted); }
.xp-track { height: 6px; border-radius: 999px; background: var(--table); border: 1px solid var(--line); overflow: hidden; }
.xp-fill { height: 100%; background: var(--ball); border-radius: 999px; }
.level-next { font-size: 0.8rem; margin: 0.6rem 0 0; }

.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; padding-bottom: 1rem; }
.actions .btn { font-size: 0.95rem; padding: 0.8rem 0.5rem; display: flex; align-items: center; justify-content: center; text-align: center; }

/* Wide screens: this week's matches get the right-hand column, the rest stacks on the left. */
@media (min-width: 900px) {
  .dash { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.25rem; align-items: start; max-width: 920px; }
  .dash .block { margin-bottom: 0; }
  .season-card { grid-column: 1; grid-row: 1; }
  .level-card  { grid-column: 1; grid-row: 2; }
  .week-card   { grid-column: 2; grid-row: 1 / span 2; }
  .actions     { grid-column: 1 / -1; max-width: 26rem; }
}
@media (min-width: 700px) and (max-width: 899px) {
  .hello, .dash { max-width: 620px; }
}
</style>
