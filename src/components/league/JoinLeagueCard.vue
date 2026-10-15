<!--
  JoinLeagueCard — v0.0.7.9. Shown to someone who is signed in but has not joined the league they
  are looking at. Signing up only makes an account; a player record (what puts you on the
  leaderboard and lets you challenge and report scores) exists only after joining, and the only
  way to join used to be a menu item inside the league icon. Renders nothing for members, for
  visitors, and while the person's leagues are still loading.
-->
<template>
  <section v-if="show" class="card join-card" data-test="join-card">
    <h3>{{ options.length === 1 ? `Join ${options[0].name}` : 'Join a league' }}</h3>
    <template v-if="options.length">
      <p class="muted">
        You're signed in, but you haven't joined {{ options.length === 1 ? 'this league' : 'a league' }} yet.
        Join to appear on the leaderboard, challenge players and report scores.
      </p>
      <div class="join-actions">
        <button
          v-for="l in options"
          :key="l.id"
          type="button"
          class="btn btn-primary"
          :disabled="!!joining"
          @click="join(l.id)"
        >
          <span v-if="joining === l.id" class="spinner" style="width:14px;height:14px;border-width:2px" />
          <span v-else>Join {{ l.name }}</span>
        </button>
      </div>
    </template>
    <p v-else class="muted">There is no league open to join yet. Ask your league organiser.</p>
    <div v-if="error" class="flash flash-error" style="margin-top:0.75rem">{{ error }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useLeagueStore } from '@/stores/leagues'
import { usePlayersStore } from '@/stores/players'

const { isAuthed } = useAuth()
const leagues = useLeagueStore()
const players = usePlayersStore()

const show = computed(() => isAuthed.value && leagues.membershipKnown && !leagues.isMember)

// The league they are looking at, if it is a real one they could join; otherwise every league open to them.
const options = computed(() => {
  const looking = leagues.allLeagues.find(l => l.id === leagues.currentLeagueId)
  return looking && !leagues.myLeagues.some(m => m.id === looking.id) ? [looking] : leagues.joinableLeagues
})

const joining = ref<string | null>(null)
const error = ref('')

async function join(id: string) {
  joining.value = id
  error.value = ''
  try {
    await leagues.joinLeague(id)
    await players.fetch()        // the pages below were showing the old, empty list
  } catch (e: any) {
    error.value = e?.message || 'Could not join the league. Please try again.'
  }
  joining.value = null
}
</script>

<style scoped>
.join-card { padding: 1.25rem; margin-bottom: 1.25rem; }
.join-card h3 { margin-bottom: 0.5rem; }
.join-card p { font-size: 0.9rem; line-height: 1.55; margin-bottom: 1rem; }
.join-actions { display: flex; flex-direction: column; gap: 0.6rem; }
.join-actions .btn { display: flex; justify-content: center; align-items: center; }
</style>
