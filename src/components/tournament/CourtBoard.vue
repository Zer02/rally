<template>
  <div>
    <!-- Admin: call the next match to whichever court just opened -->
    <div v-if="isAdmin && uncalledMatches.length" class="card" style="padding:1.25rem;margin-bottom:1rem">
      <h3 style="font-size:0.95rem;margin-bottom:0.75rem">Call to court</h3>
      <div v-for="m in uncalledMatches" :key="m.id" class="call-row">
        <span class="call-names">
          {{ name(m.player_a) }} <span class="muted">vs</span> {{ name(m.player_b) }}
          <span v-if="m.phase === 'challenge'" class="status status-pending" style="margin-left:0.4rem">Challenge</span>
        </span>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <input v-model.number="courtInputs[m.id]" type="number" min="1" class="input court-input" placeholder="Court #" />
          <button class="btn btn-primary btn-sm" :disabled="!courtInputs[m.id] || calling === m.id" @click="call(m.id)">
            <span v-if="calling === m.id" class="spinner" style="width:12px;height:12px;border-width:2px" />
            <span v-else>Call</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Courts currently in use -->
    <div v-if="inProgress.length" style="margin-bottom:1.5rem">
      <h3 style="font-size:0.95rem;margin-bottom:0.6rem">On court now</h3>
      <div class="court-grid">
        <div
          v-for="m in inProgress"
          :key="m.id"
          class="card court-card"
          :class="{ 'court-card-mine': isMine(m) }"
        >
          <div class="court-card-head">
            <span class="court-number">Court {{ m.court }}</span>
            <span v-if="isMine(m)" class="status status-accepted">Your match</span>
          </div>
          <div v-if="isAdmin || isMine(m)">
            <MatchScoreRow :match="m" :my-id="myId" :admin-mode="isAdmin" :on-report="onReport" />
          </div>
          <div v-else class="call-names">
            {{ name(m.player_a) }} <span class="muted">vs</span> {{ name(m.player_b) }}
          </div>
          <button v-if="isAdmin" class="btn btn-ghost btn-sm" style="margin-top:0.6rem" @click="uncall(m.id)">
            Uncall
          </button>
        </div>
      </div>
    </div>

    <p v-if="boardError" class="flash flash-error">{{ boardError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { TournamentMatch, Profile } from '@/types'
import MatchScoreRow from './MatchScoreRow.vue'

const props = defineProps<{
  uncalledMatches: TournamentMatch[]
  inProgress: TournamentMatch[]
  isAdmin: boolean
  myId?: string
  onCall: (matchId: string, court: number) => Promise<void>
  onUncall: (matchId: string) => Promise<void>
  onReport: (matchId: string, scoreA: number, scoreB: number) => Promise<void>
}>()

const courtInputs = reactive<Record<string, number | null>>({})
const calling      = ref<string | null>(null)
const boardError   = ref('')

function name(p?: Profile) {
  return p?.display_name || p?.username || '?'
}

function isMine(m: TournamentMatch) {
  return !!props.myId && (m.player_a_id === props.myId || m.player_b_id === props.myId)
}

async function call(matchId: string) {
  const court = courtInputs[matchId]
  if (!court) return
  calling.value = matchId
  boardError.value = ''
  try {
    await props.onCall(matchId, court)
    courtInputs[matchId] = null
  } catch (e: any) {
    boardError.value = e.message
  }
  calling.value = null
}

async function uncall(matchId: string) {
  boardError.value = ''
  try {
    await props.onUncall(matchId)
  } catch (e: any) {
    boardError.value = e.message
  }
}
</script>

<style scoped>
.call-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
.call-row:last-child { border-bottom: none; }
.call-names { font-size: 0.85rem; }
.court-input { width: 90px; text-align: center; flex-shrink: 0; padding: 0.45rem 0.5rem; }
.court-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.75rem; }
.court-card { padding: 0.9rem 1rem; }
.court-card-mine { border-color: var(--ball); }
.court-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.court-number { font-weight: 600; font-size: 0.85rem; }
</style>
