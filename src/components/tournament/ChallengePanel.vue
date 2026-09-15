<template>
  <div class="card" style="padding:1.25rem">
    <h3 style="font-size:0.95rem;margin-bottom:0.4rem">Issue a challenge</h3>
    <p class="muted" style="font-size:0.8rem;margin-bottom:0.9rem">
      Challenge anyone currently ranked above you — one challenge per week.
      Wins add bonus points but never touch your win-loss record.
    </p>

    <p v-if="usedThisWeek" class="flash flash-info" style="font-size:0.8rem">
      You've already used your challenge for this week.
    </p>

    <div v-if="challengeable.length" class="challenge-list">
      <div v-for="p in challengeable" :key="p.profile_id" class="challenge-row">
        <span>
          <span class="mono muted" style="margin-right:0.5rem">#{{ rank(p.profile_id) }}</span>
          {{ p.profile?.display_name || p.profile?.username }}
        </span>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="usedThisWeek || issuingFor === p.profile_id"
          @click="issue(p.profile_id)"
        >
          <span v-if="issuingFor === p.profile_id" class="spinner" style="width:12px;height:12px;border-width:2px" />
          <span v-else>Challenge</span>
        </button>
      </div>
    </div>
    <p v-else class="muted" style="font-size:0.85rem">
      {{ myProfileId ? "You're already at the top of the standings." : 'Join the season to challenge someone.' }}
    </p>

    <p v-if="challengeError" class="flash flash-error" style="margin-top:0.75rem">{{ challengeError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TournamentParticipant } from '@/types'

const props = defineProps<{
  standings: TournamentParticipant[]
  myProfileId?: string
  usedThisWeek: boolean
  canChallenge: (profileId: string) => boolean
  onChallenge: (profileId: string) => Promise<void>
}>()

const challengeable = computed(() =>
  props.standings.filter(p => props.canChallenge(p.profile_id))
)

function rank(profileId: string) {
  return props.standings.findIndex(p => p.profile_id === profileId) + 1
}

const issuingFor     = ref<string | null>(null)
const challengeError = ref('')

async function issue(profileId: string) {
  issuingFor.value = profileId
  challengeError.value = ''
  try {
    await props.onChallenge(profileId)
  } catch (e: any) {
    challengeError.value = e.message
  }
  issuingFor.value = null
}
</script>

<style scoped>
.challenge-list { display: flex; flex-direction: column; gap: 0.4rem; }
.challenge-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.55rem 0.75rem; border-radius: var(--radius-sm);
  border: 1px solid var(--line); font-size: 0.85rem;
}
</style>
