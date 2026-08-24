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
        <!-- My pending actions -->
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
  matchesStore.pending.filter(m =>
    m.challenger_id === user.value?.id || m.opponent_id === user.value?.id
  )
)

async function accept(id: string) {
  await matchesStore.respond(id, true)
}
async function decline(id: string) {
  await matchesStore.respond(id, false)
}
function openResult(match: Match) {
  activeMatch.value = match
}
async function submitResult(payload: any) {
  await matchesStore.submitResult(
    payload.matchId, payload.winnerId, payload.loserId,
    payload.challengerScores, payload.opponentScores,
  )
  activeMatch.value = null
}
</script>

<style scoped>
.match-list { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
