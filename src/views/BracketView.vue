<template>
  <main class="page container">
    <RouterLink to="/tournaments" class="muted" style="font-size:0.8rem;text-decoration:none">← All tournaments</RouterLink>

    <div v-if="store.loading && !store.current" style="text-align:center;padding:3rem 0">
      <span class="spinner" style="width:28px;height:28px;border-width:3px" />
    </div>

    <div v-else-if="!store.current" class="card" style="padding:1.5rem;margin-top:1rem">
      <p class="muted">That tournament doesn't exist (it may have been deleted).</p>
    </div>

    <template v-else>
      <div class="page-header" style="margin-top:0.75rem">
        <p class="eyebrow">{{ store.current.status === 'completed' ? 'Finished' : 'In progress' }}</p>
        <h1 style="overflow-wrap:anywhere">{{ store.current.name }}</h1>
        <p class="muted" style="font-size:0.85rem">
          {{ store.entrants.length }} players · {{ store.current.bracket_size }}-slot knockout ·
          seeded by {{ store.current.seeding === 'ladder' ? 'ladder' : 'round robin' }} rating
        </p>
      </div>

      <div v-if="store.championName" class="card champion" data-testid="champion">
        <span class="champion-label">Champion</span>
        <span class="champion-name">{{ store.championName }}</span>
      </div>

      <BracketBoard
        :matches="store.matches" :entrants="store.entrantByProfile"
        :editable-ids="editableIds" :selected-id="selected?.id ?? null"
        @select="pick"
      />
      <p v-if="canAdmin" class="muted" style="font-size:0.78rem;margin-top:0.6rem">
        Tap a match to enter its result. A result can be corrected until the next match has been played.
      </p>

      <!-- Admin: enter / correct a result -->
      <section v-if="canAdmin && selected" class="card score-panel" data-testid="score-panel">
        <h2 style="font-size:1rem;margin-bottom:0.75rem">
          {{ selected.status === 'completed' ? 'Correct result' : 'Enter result' }}
        </h2>
        <div class="score-row">
          <label class="score-side">
            <span class="score-name">{{ nameOf(selected.player_a_id) }}</span>
            <input v-model="scoreA" class="input score-input" inputmode="numeric" aria-label="Score for the first player" />
          </label>
          <span class="muted">v</span>
          <label class="score-side">
            <span class="score-name">{{ nameOf(selected.player_b_id) }}</span>
            <input v-model="scoreB" class="input score-input" inputmode="numeric" aria-label="Score for the second player" />
          </label>
        </div>
        <p class="muted" style="font-size:0.78rem;margin:0.6rem 0">First to 4 games, or a full set to 6.</p>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
            <span v-if="saving" class="spinner" style="width:14px;height:14px;border-width:2px" />
            <span v-else>Save result</span>
          </button>
          <button class="btn btn-ghost" type="button" @click="selected = null">Cancel</button>
        </div>
        <p v-if="formError" class="flash flash-error" style="margin-top:0.75rem">{{ formError }}</p>
      </section>

      <p v-if="canAdmin && lockedNote" class="muted" style="font-size:0.78rem;margin-top:0.6rem">{{ lockedNote }}</p>

      <div v-if="canAdmin" class="page-more">
        <button v-if="!confirming" class="btn btn-danger btn-sm" style="align-self:flex-start" @click="confirming = true">Delete tournament</button>
        <div v-else class="card" style="padding:1rem">
          <p style="font-size:0.9rem;margin-bottom:0.75rem">Delete “{{ store.current.name }}” and every result in it? This can't be undone.</p>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-danger btn-sm" :disabled="deleting" @click="remove">Yes, delete it</button>
            <button class="btn btn-ghost btn-sm" @click="confirming = false">Keep it</button>
          </div>
          <p v-if="deleteError" class="flash flash-error" style="margin-top:0.75rem">{{ deleteError }}</p>
        </div>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BracketBoard from '@/components/bracket/BracketBoard.vue'
import { useBracketsStore } from '@/stores/brackets'
import { useLeagueStore } from '@/stores/leagues'
import { useAuth } from '@/composables/useAuth'
import { profileName, scoreBlock } from '@/lib/bracket'
import type { BracketMatch } from '@/types'

const route  = useRoute()
const router = useRouter()
const store  = useBracketsStore()
const leagues = useLeagueStore()
const { isAdmin } = useAuth()

const canAdmin = computed(() => leagues.isCurrentLeagueAdmin || isAdmin.value)
const selected = ref<BracketMatch | null>(null)
const scoreA = ref(''), scoreB = ref('')
const saving = ref(false), formError = ref('')
const confirming = ref(false), deleting = ref(false), deleteError = ref('')

const editableIds = computed(() => canAdmin.value
  ? new Set(store.matches.filter(m => !scoreBlock(m, store.matches)).map(m => m.id))
  : new Set<string>())

// Completed matches that can no longer be changed, so the admin knows why a tap does nothing.
const lockedNote = computed(() =>
  store.matches.some(m => m.status === 'completed' && scoreBlock(m, store.matches)?.startsWith('Locked'))
    ? 'Matches whose winner has already played the next round are locked.' : '')

const nameOf = (id: string | null) => profileName(id ? store.entrantByProfile.get(id)?.profile : null)

function pick(m: BracketMatch) {
  selected.value = m
  formError.value = ''
  scoreA.value = m.score_a == null ? '' : String(m.score_a)
  scoreB.value = m.score_b == null ? '' : String(m.score_b)
}

const toCount = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

async function save() {
  if (!selected.value) return
  formError.value = ''; saving.value = true
  try {
    await store.reportMatch(selected.value.id, toCount(scoreA.value), toCount(scoreB.value))
    selected.value = null
  } catch (e: any) { formError.value = e.message }
  finally { saving.value = false }
}

async function remove() {
  if (!store.current) return
  deleteError.value = ''; deleting.value = true
  try { await store.deleteEvent(store.current.id); router.push('/tournaments') }
  catch (e: any) { deleteError.value = e.message }
  finally { deleting.value = false }
}

watch(() => route.params.id, id => { if (id) { selected.value = null; store.fetchEvent(String(id)) } })
onMounted(() => {
  store.fetchEvent(String(route.params.id))
  if (!leagues.isCurrentLeagueAdmin) leagues.refreshCurrentLeagueAdmin?.()
})
</script>

<style scoped>
.champion { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; padding: 0.9rem 1.2rem; margin-bottom: 1.25rem; border-color: var(--ball); }
.champion-label { font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ball); }
.champion-name { font-family: var(--font-display); font-size: 1.4rem; overflow-wrap: anywhere; }
.score-panel { padding: 1.1rem; margin-top: 1rem; }
.score-row { display: flex; align-items: flex-end; gap: 0.75rem; flex-wrap: wrap; }
.score-side { display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 8rem; min-width: 0; }
.score-name { font-size: 0.85rem; overflow-wrap: anywhere; }
.score-input { width: 100%; }
</style>
