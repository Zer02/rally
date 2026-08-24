<template>
  <div class="match-card card">
    <div class="match-players">
      <div class="match-player" :class="{ winner: isWinner(match.challenger_id) }">
        <PlayerAvatar :name="match.challenger?.display_name || match.challenger?.username || '?'" :size="32" />
        <div>
          <div class="player-name">{{ match.challenger?.display_name || match.challenger?.username }}</div>
          <div class="player-unit muted">{{ match.challenger?.unit }}</div>
        </div>
      </div>

      <div class="match-center">
        <span class="status" :class="`status-${match.status}`">{{ match.status }}</span>
        <div v-if="match.status === 'completed'" class="match-score">
          {{ formatScore(match.challenger_score, match.opponent_score) }}
        </div>
      </div>

      <div class="match-player right" :class="{ winner: isWinner(match.opponent_id) }">
        <div class="right">
          <div class="player-name">{{ match.opponent?.display_name || match.opponent?.username }}</div>
          <div class="player-unit muted">{{ match.opponent?.unit }}</div>
        </div>
        <PlayerAvatar :name="match.opponent?.display_name || match.opponent?.username || '?'" :size="32" />
      </div>
    </div>

    <!-- Actions for pending/accepted matches -->
    <div v-if="showActions" class="match-actions">
      <template v-if="match.status === 'pending' && isOpponent">
        <button class="btn btn-primary btn-sm" @click="$emit('accept', match.id)">Accept</button>
        <button class="btn btn-danger  btn-sm" @click="$emit('decline', match.id)">Decline</button>
      </template>
      <template v-else-if="match.status === 'accepted' && isParticipant">
        <button class="btn btn-primary btn-sm" @click="$emit('submit', match)">Submit result</button>
      </template>
    </div>

    <div class="match-time muted">{{ formatTime(match.created_at) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
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

function isWinner(id: string) {
  return props.match.status === 'completed' && props.match.winner_id === id
}

function formatScore(c: string | null, o: string | null) {
  if (!c || !o) return ''
  const cs = c.split(',').map(Number)
  const os = o.split(',').map(Number)
  return cs.map((s, i) => `${s}–${os[i]}`).join(', ')
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.match-card { padding: 0.875rem 1.25rem; }
.match-players { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0.75rem; align-items: center; }
.match-player { display: flex; align-items: center; gap: 0.625rem; }
.match-player.right { flex-direction: row-reverse; text-align: right; }
.player-name { font-size: 0.875rem; font-weight: 500; color: var(--txt-secondary); }
.player-unit { font-size: 0.75rem; }
.match-player.winner .player-name { color: var(--txt-primary); }
.match-center { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.match-score { font-family: var(--font-mono); font-size: 0.75rem; color: var(--txt-muted); }
.match-actions { display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--line); }
.match-time { font-size: 0.72rem; color: var(--txt-muted); text-align: right; margin-top: 0.4rem; }
</style>
