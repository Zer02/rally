<!-- src/components/match/MatchCard.vue — v0.0.5.4: scoreboard layout via ScoreCard -->
<template>
  <ScoreCard
    :sides="sides"
    :done="match.status === 'completed'"
    :when="formatTime(match.completed_at ?? match.created_at)"
    :status="match.status !== 'completed' ? match.status : null"
    :result="result"
    meta="Ladder"
  >
    <template #footer>
      <div v-if="showActions" class="match-actions">
        <template v-if="match.status === 'pending' && isOpponent">
          <button class="btn btn-primary btn-sm" @click="$emit('accept', match.id)">Accept</button>
          <button class="btn btn-danger  btn-sm" @click="$emit('decline', match.id)">Decline</button>
        </template>
        <template v-else-if="match.status === 'accepted' && isParticipant">
          <button class="btn btn-primary btn-sm" @click="$emit('submit', match)">Submit result</button>
        </template>
      </div>
    </template>
  </ScoreCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ScoreCard, { type ScoreSide } from '@/components/match/ScoreCard.vue'
import type { Match } from '@/types'

const props = defineProps<{
  match:         Match
  currentUserId?: string
}>()

defineEmits(['accept', 'decline', 'submit'])

const isOpponent    = computed(() => props.match.opponent_id   === props.currentUserId)
const isChallenger  = computed(() => props.match.challenger_id === props.currentUserId)
const isParticipant = computed(() => isOpponent.value || isChallenger.value)
const showActions   = computed(() => isParticipant.value && props.match.status !== 'completed' && props.match.status !== 'declined')

// "11,9,11" → [11, 9, 11]. Anything non-numeric is dropped rather than shown as NaN.
function parseGames(raw: string | null): number[] | null {
  if (!raw) return null
  const g = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n))
  return g.length ? g : null
}

const sides = computed<[ScoreSide, ScoreSide]>(() => {
  const m = props.match
  const cGames = parseGames(m.challenger_score)
  const oGames = parseGames(m.opponent_score)
  const both   = !!cGames && !!oGames && cGames.length === oGames.length
  const cWon   = both ? cGames!.filter((g, i) => g > oGames![i]).length : null
  const oWon   = both ? oGames!.filter((g, i) => g > cGames![i]).length : null
  const nm = (p?: { display_name: string | null; username: string } | null) => p?.display_name || p?.username || '?'
  const done = m.status === 'completed'
  return [
    {
      names: [nm(m.challenger)], unit: m.challenger?.unit, delta: done ? m.challenger_delta : null,
      isWinner: done && m.winner_id === m.challenger_id, isMe: m.challenger_id === props.currentUserId,
      games: both ? cGames : null, total: cWon,
    },
    {
      names: [nm(m.opponent)], unit: m.opponent?.unit, delta: done ? m.opponent_delta : null,
      isWinner: done && m.winner_id === m.opponent_id, isMe: m.opponent_id === props.currentUserId,
      games: both ? oGames : null, total: oWon,
    },
  ]
})

const result = computed<'win' | 'loss' | null>(() => {
  if (props.match.status !== 'completed' || !isParticipant.value || !props.match.winner_id) return null
  return props.match.winner_id === props.currentUserId ? 'win' : 'loss'
})

function formatTime(iso: string) {
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1)    return 'Just now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.match-actions { display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.6rem; padding-top: 0.7rem; border-top: 1px solid var(--line); }
</style>
