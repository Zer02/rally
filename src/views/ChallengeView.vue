<template>
  <main class="page">
    <div class="container" style="max-width:600px">
      <div class="page-header">
        <p class="eyebrow">Send a challenge</p>
        <h1>Challenge</h1>
      </div>

      <div v-if="flash" class="flash" :class="`flash-${flashType}`">{{ flash }}</div>

      <div v-if="sent" class="flash flash-success" style="font-size:1rem;padding:1.25rem">
        Challenge sent to {{ sentName }}! They'll be notified.
        <div style="margin-top:0.75rem">
          <RouterLink to="/matches" class="btn btn-primary btn-sm">View matches</RouterLink>
        </div>
      </div>

      <JoinLeagueCard v-else-if="leagueStore.membershipKnown && !leagueStore.isMember" />

      <template v-else>
        <div class="card" style="overflow:hidden">
          <div class="card-header"><h3>Pick an opponent</h3></div>
          <div v-if="store.loading" style="padding:2rem;text-align:center">
            <span class="spinner" />
          </div>
          <div v-else>
            <div
              v-for="p in opponents"
              :key="p.id"
              class="opponent-row"
              :class="{ selected: selected === p.profile_id }"
              :aria-pressed="selected === p.profile_id"
              role="button"
              tabindex="0"
              @click="select(p)"
              @keydown.enter.prevent="select(p)"
              @keydown.space.prevent="select(p)"
            >
              <PlayerAvatar :name="pname(p)" :size="38" />
              <div class="opponent-info">
                <div class="opponent-name">{{ pname(p) }}</div>
                <div class="opponent-meta muted">
                  <TierBadge :rating="p.rating" />
                  <span class="mono">{{ p.rating }}</span>
                </div>
              </div>
              <span v-if="selected === p.profile_id" class="opponent-check" aria-hidden="true">✓</span>
            </div>
          </div>
        </div>

        <!-- v0.0.8.2: stays at the bottom of the screen once someone is picked, so the
             Send button is never a long scroll away from the name that was tapped. -->
        <div v-if="selectedPlayer" class="send-bar card" role="region" aria-label="Send challenge">
          <!-- thin strip along the top edge: how even the match is -->
          <div v-if="preview" class="send-strip" aria-hidden="true"><div class="send-strip-fill" :style="{ width: Math.round(preview.quality * 100) + '%' }" /></div>
          <div class="send-who">
            <PlayerAvatar :name="pname(selectedPlayer)" :size="34" />
            <div class="send-text">
              <div class="send-name">{{ pname(selectedPlayer) }}</div>
              <div v-if="preview" class="send-pts">
                <span class="muted">Win</span> <span class="delta delta-pos">+{{ preview.challengerWinDelta }}</span>
                <span class="muted send-gap">Loss</span> <span class="delta delta-neg">{{ preview.challengerLossDelta }}</span>
              </div>
            </div>
            <span v-if="preview" class="quality" :class="`quality-${qualityKey}`">{{ qualityText }}</span>
          </div>
          <button class="btn btn-primary send-btn" :disabled="sending" @click="send">
            <span v-if="sending" class="spinner" />
            <span v-else>Send challenge →</span>
          </button>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useLeagueStore } from '@/stores/leagues'
import JoinLeagueCard from '@/components/league/JoinLeagueCard.vue'
import { useAuth } from '@/composables/useAuth'
import { onLeagueChange } from '@/composables/useLeagueWatch'
import { previewPoints, qualityLabel } from '@/lib/rating'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Player } from '@/types'

const store   = usePlayersStore()
const leagueStore = useLeagueStore()
const matches = useMatchesStore()
const { user } = useAuth()
const route   = useRoute()

const selected = ref<string | null>(null)
const sending  = ref(false)
const sent     = ref(false)
const sentName = ref('')
const flash    = ref('')
const flashType = ref<'error'|'success'>('error')

onMounted(async () => {
  await store.fetch()
  // Pre-select if ?opponent= query param provided
  if (route.query.opponent) selected.value = route.query.opponent as string
})

// Switching leagues means a different opponent list entirely — and
// whoever was selected almost certainly isn't in the new one.
onLeagueChange(() => {
  selected.value = null
  store.fetch()
})

const opponents = computed(() =>
  store.sorted.filter(p => p.profile_id !== user.value?.id)
)

const me = computed(() => store.byId(user.value?.id ?? ''))
// Only someone actually in this league's list counts as picked (a stale ?opponent= does not).
const selectedPlayer = computed(() =>
  selected.value ? opponents.value.find(p => p.profile_id === selected.value) ?? null : null
)

const preview = computed(() => {
  if (!selected.value || !me.value) return null
  const opp = store.byId(selected.value)
  if (!opp) return null
  return previewPoints(
    { rating: me.value.rating, uncertainty: me.value.uncertainty, streak: me.value.streak },
    { rating: opp.rating,      uncertainty: opp.uncertainty,      streak: opp.streak },
  )
})

const qualityKey  = computed(() => preview.value ? qualityLabel(preview.value.quality).key : '')
const qualityText = computed(() => preview.value ? qualityLabel(preview.value.quality).label : '')

function pname(p: Player) {
  return p.profile?.display_name || p.profile?.username || '?'
}

function select(p: Player) {
  selected.value = selected.value === p.profile_id ? null : p.profile_id
}

async function send() {
  if (!selectedPlayer.value || !user.value) return
  sending.value = true; flash.value = ''
  try {
    await matches.challenge(user.value.id, selected.value)
    const opp = store.byId(selected.value)
    sentName.value = opp ? pname(opp) : 'your opponent'
    sent.value = true
  } catch (e: any) {
    flash.value = e.message; flashType.value = 'error'
  }
  sending.value = false
}
</script>

<style scoped>
.opponent-row { display: flex; align-items: center; gap: 0.875rem; padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--line); cursor: pointer; transition: background 0.1s; -webkit-tap-highlight-color: transparent; }
.opponent-row:last-child { border-bottom: none; }
.opponent-row:hover { background: var(--table-light); }
.opponent-row:focus-visible { outline: 2px solid var(--ball); outline-offset: -2px; }
.opponent-row.selected { background: rgba(232,200,74,0.08); box-shadow: inset 3px 0 0 var(--ball); }
.opponent-info { flex: 1; min-width: 0; }
.opponent-name { font-size: 0.9rem; font-weight: 500; color: var(--txt-primary); }
.opponent-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; margin-top: 2px; }
.opponent-check { color: var(--ball); font-weight: 700; font-size: 1rem; }

/* The send bar: sticks to the bottom of the screen while the list is longer than the
   screen, and settles into place under the list once the list's end is in view. On phones it
   sits above the bottom tab bar (3.5rem, plus the home-indicator inset, as in main.css). */
.send-bar {
  position: sticky; z-index: 50; margin-top: 1rem; overflow: hidden;
  bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
  padding: 0.7rem 1rem 0.8rem; display: flex; flex-direction: column; gap: 0.6rem;
  background: var(--table-mid); border-color: rgba(232,200,74,0.35);
  box-shadow: 0 -6px 24px rgba(0,0,0,0.45), var(--shadow);
}
@media (max-width: 700px) { .send-bar { bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem); } }
.send-strip { position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--table-light); }
.send-strip-fill { height: 100%; background: var(--net); transition: width 0.3s; }
.send-who { display: flex; align-items: center; gap: 0.7rem; min-width: 0; margin-top: 0.15rem; }
.send-text { flex: 1; min-width: 0; line-height: 1.3; }
.send-name { font-size: 0.95rem; font-weight: 600; color: var(--txt-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.send-pts { display: flex; align-items: baseline; gap: 0.3rem; font-size: 0.72rem; white-space: nowrap; }
.send-gap { margin-left: 0.5rem; }
.send-who .quality { flex-shrink: 0; }
.send-btn { width: 100%; justify-content: center; padding: 0.65rem; }
</style>
