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
              @click="select(p)"
            >
              <PlayerAvatar :name="pname(p)" :size="38" />
              <div class="opponent-info">
                <div class="opponent-name">{{ pname(p) }}</div>
                <div class="opponent-meta muted">
                  <TierBadge :rating="p.rating" />
                  <span class="mono">{{ p.rating }}</span>
                  <span v-if="p.profile?.unit">· Unit {{ p.profile.unit }}</span>
                </div>
              </div>
              <div class="opponent-pts" v-if="selected === p.profile_id && preview">
                <div class="pts-row">
                  <span class="muted" style="font-size:0.72rem">Win</span>
                  <span class="delta delta-pos">+{{ preview.challengerWinDelta }}</span>
                </div>
                <div class="pts-row">
                  <span class="muted" style="font-size:0.72rem">Loss</span>
                  <span class="delta delta-neg">{{ preview.challengerLossDelta }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selected && preview" class="quality-preview card" style="margin-top:1rem;padding:1rem 1.25rem">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="muted" style="font-size:0.8rem">Match quality</span>
            <span class="quality" :class="`quality-${qualityKey}`">{{ qualityText }}</span>
          </div>
          <div class="quality-bar-track" style="margin-top:0.5rem">
            <div class="quality-bar-fill" :style="{ width: Math.round(preview.quality * 100) + '%' }" />
          </div>
        </div>

        <button
          class="btn btn-primary"
          style="width:100%;margin-top:1rem;justify-content:center;padding:0.75rem"
          :disabled="!selected || sending"
          @click="send"
        >
          <span v-if="sending" class="spinner" />
          <span v-else>Send challenge →</span>
        </button>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePlayersStore } from '@/stores/players'
import { useMatchesStore } from '@/stores/matches'
import { useAuth } from '@/composables/useAuth'
import { previewPoints, qualityLabel } from '@/lib/rating'
import TierBadge from '@/components/ui/TierBadge.vue'
import PlayerAvatar from '@/components/ui/PlayerAvatar.vue'
import type { Player } from '@/types'

const store   = usePlayersStore()
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

const opponents = computed(() =>
  store.sorted.filter(p => p.profile_id !== user.value?.id)
)

const me = computed(() => store.byId(user.value?.id ?? ''))

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
  if (!selected.value || !user.value) return
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
.opponent-row { display: flex; align-items: center; gap: 0.875rem; padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--line); cursor: pointer; transition: background 0.1s; }
.opponent-row:last-child { border-bottom: none; }
.opponent-row:hover { background: var(--table-light); }
.opponent-row.selected { background: rgba(232,200,74,0.06); }
.opponent-info { flex: 1; }
.opponent-name { font-size: 0.9rem; font-weight: 500; color: var(--txt-primary); }
.opponent-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; margin-top: 2px; }
.opponent-pts  { display: flex; flex-direction: column; gap: 3px; }
.pts-row { display: flex; align-items: center; gap: 4px; }
.quality-bar-track { height: 5px; background: var(--table-light); border-radius: 3px; overflow: hidden; }
.quality-bar-fill  { height: 100%; background: var(--net); border-radius: 3px; transition: width 0.3s; }
</style>
