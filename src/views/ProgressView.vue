<!-- src/views/ProgressView.vue — v0.0.5.1 -->
<template>
  <main class="page">
    <div class="container">
      <div v-if="!me" style="text-align:center;padding:3rem 0">
        <span v-if="loading" class="spinner" style="width:28px;height:28px;border-width:3px" />
        <p v-else class="muted">
          You haven't joined this league yet — use the league icon in the nav to join it first.
        </p>
      </div>

      <template v-else>
        <div class="page-header">
          <p class="eyebrow">Your progress</p>
          <h1 style="font-size:clamp(1.4rem,3vw,2rem)">Every rally counts</h1>
          <p class="muted" style="font-size:0.9rem;margin-top:0.35rem">
            Win or lose, showing up moves you forward.
          </p>
        </div>

        <!-- Level + XP bar -->
        <div class="card level-card">
          <div class="level-top">
            <div>
              <p class="level-eyebrow">Level {{ lp.current.level }}</p>
              <h2 class="level-title">{{ lp.current.title }}</h2>
            </div>
            <div class="level-xp mono">{{ me.xp }} XP</div>
          </div>

          <div class="xp-track" role="progressbar" :aria-valuenow="lp.progressPct" aria-valuemin="0" aria-valuemax="100">
            <div class="xp-fill" :style="{ width: lp.progressPct + '%' }" />
          </div>

          <p class="level-next muted">
            <template v-if="lp.next">
              {{ lp.xpForLevel - lp.xpIntoLevel }} XP to <strong>{{ lp.next.title }}</strong>
            </template>
            <template v-else>You've reached the top level. Legend.</template>
          </p>

          <p class="play-xp muted">
            This week: {{ progress.playXpWeek.matches }} {{ progress.playXpWeek.matches === 1 ? 'match' : 'matches' }}
            played · <strong class="mono">+{{ progress.playXpWeek.xp }} XP</strong>
            <span v-if="progress.playXpWeek.matches > 5">(after 5 matches each one earns a little less)</span>
          </p>
          <p class="play-xp-rule muted">
            Round robin matches: a win earns {{ winXp }} XP, and a loss earns {{ XP_PER_POINT }} XP for each
            game you won (up to {{ lossMaxXp }}). Ladder matches earn 15.
          </p>
        </div>

        <div v-if="progress.error" class="flash flash-error" style="margin-bottom:1.5rem">{{ progress.error }}</div>

        <!-- Quests -->
        <section v-for="group in groups" :key="group.key" class="quest-group">
          <div class="quest-group-head">
            <h3>{{ group.label }}</h3>
            <span class="muted quest-refresh">{{ group.refresh }}</span>
          </div>

          <div v-if="!group.items.length" class="card quest-empty muted">
            {{ group.empty }}
          </div>

          <div v-for="q in group.items" :key="q.template.id" class="card quest" :class="{ done: q.completed }">
            <div class="quest-main">
              <div class="quest-title-row">
                <span class="quest-check" :class="{ on: q.completed }">{{ q.completed ? '✓' : '' }}</span>
                <span class="quest-title">{{ q.template.title }}</span>
                <span class="quest-xp mono">+{{ q.template.xp_reward }} XP</span>
              </div>
              <p class="quest-desc muted">{{ q.template.description }}</p>
              <div class="quest-bar">
                <div class="quest-bar-fill" :style="{ width: questPct(q) + '%' }" />
              </div>
              <p class="quest-count mono muted">
                {{ Math.min(q.progress, q.template.target_count) }} / {{ q.template.target_count }}
              </p>
            </div>
          </div>
        </section>

        <!-- Recently earned -->
        <section v-if="progress.recent.length" class="quest-group">
          <div class="quest-group-head"><h3>Recently earned</h3></div>
          <div class="card">
            <div v-for="(r, i) in progress.recent" :key="i" class="earned-row">
              <span class="earned-title">{{ r.title }}</span>
              <span class="muted earned-cadence">{{ r.cadence }}</span>
              <span class="earned-xp mono">+{{ r.xp }} XP</span>
            </div>
          </div>
        </section>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { usePlayersStore } from '@/stores/players'
import { useProgressStore, type QuestView } from '@/stores/progress'
import { levelProgress } from '@/lib/xp'
import { GAMES_TO_WIN, LOSS_MAX_POINTS, XP_PER_POINT, rrMatchXp } from '@/lib/score'
import { useSport } from '@/composables/useSport'

const { user } = useAuth()
const leagueStore  = useLeagueStore()
const playersStore = usePlayersStore()
const progress     = useProgressStore()

const loading = computed(() => progress.loading || playersStore.loading)
const me = computed(() => playersStore.byId(user.value?.id ?? ''))
const { sport } = useSport()
const lp = computed(() => levelProgress(me.value?.xp ?? 0, sport.value))
const winXp = rrMatchXp(GAMES_TO_WIN, 0)
const lossMaxXp = XP_PER_POINT * LOSS_MAX_POINTS

const groups = computed(() => [
  { key: 'weekly',   label: 'This week',   refresh: 'Refreshes every Monday',
    items: progress.byCadence.weekly,   empty: 'No weekly quests right now.' },
  { key: 'monthly',  label: 'This month',  refresh: 'Refreshes on the 1st',
    items: progress.byCadence.monthly,  empty: 'No monthly quests right now.' },
  { key: 'seasonal', label: 'This season', refresh: 'Runs for the whole round robin season',
    items: progress.byCadence.seasonal, empty: 'Seasonal quests appear once a round robin season is running.' },
])

function questPct(q: QuestView) {
  return Math.min(100, Math.round((q.progress / q.template.target_count) * 100))
}

// Sync first (server recomputes + awards XP), then refresh the players
// list so the XP total above reflects anything just earned.
async function load() {
  await progress.fetch()
  await playersStore.fetch()
}

onMounted(load)
watch(() => leagueStore.currentLeagueId, load)
</script>

<style scoped>
.level-card { padding: 1.5rem 1.5rem 1.25rem; margin-bottom: 2rem; }
.level-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.level-eyebrow { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ball); margin-bottom: 0.25rem; }
.level-title { font-family: var(--font-display); font-size: clamp(1.5rem, 4vw, 2rem); line-height: 1.1; }
.level-xp { color: var(--txt-secondary); font-size: 1rem; }
.play-xp { font-size: 0.85rem; margin-top: 0.5rem; }
.play-xp-rule { font-size: 0.8rem; margin-top: 0.25rem; }
.xp-track { height: 12px; border-radius: 999px; background: var(--table-light); border: 1px solid var(--line); overflow: hidden; }
.xp-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--ball), #f3dc7a); transition: width 0.6s ease; }
.level-next { margin-top: 0.7rem; font-size: 0.85rem; }
.level-next strong { color: var(--txt-primary); font-weight: 600; }

.quest-group { margin-bottom: 2rem; }
.quest-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; }
.quest-group-head h3 { font-size: 1rem; }
.quest-refresh { font-size: 0.75rem; }
.quest-empty { padding: 1rem 1.25rem; font-size: 0.85rem; }

.quest { padding: 1rem 1.25rem; margin-bottom: 0.65rem; }
.quest.done { border-color: rgba(76,175,138,0.45); }
.quest-title-row { display: flex; align-items: center; gap: 0.6rem; }
.quest-check {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid var(--line); display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.72rem; font-weight: 700; color: #0e1117;
}
.quest-check.on { background: var(--net); border-color: var(--net); }
.quest-title { font-weight: 600; font-size: 0.95rem; flex: 1; }
.quest-xp { color: var(--ball); font-size: 0.8rem; }
.quest.done .quest-xp { color: var(--net); }
.quest-desc { font-size: 0.82rem; margin: 0.35rem 0 0.7rem 1.65rem; }
.quest-bar { height: 6px; border-radius: 999px; background: var(--table-light); overflow: hidden; margin-left: 1.65rem; }
.quest-bar-fill { height: 100%; background: var(--ball); border-radius: 999px; transition: width 0.5s ease; }
.quest.done .quest-bar-fill { background: var(--net); }
.quest-count { font-size: 0.72rem; margin: 0.35rem 0 0 1.65rem; }

.earned-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.7rem 1.25rem; border-top: 1px solid var(--line); }
.earned-row:first-child { border-top: none; }
.earned-title { flex: 1; font-size: 0.88rem; font-weight: 500; }
.earned-cadence { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; }
.earned-xp { color: var(--net); font-size: 0.8rem; }
</style>
