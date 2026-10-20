<template>
  <main class="page container">
    <div class="page-header">
      <p class="eyebrow">{{ leagueName }}</p>
      <h1>Tournaments</h1>
    </div>

    <div v-if="store.loading && !store.events.length" style="text-align:center;padding:3rem 0">
      <span class="spinner" style="width:28px;height:28px;border-width:3px" />
    </div>

    <template v-else>
      <div v-if="store.events.length" class="t-list" data-testid="tournament-list">
        <RouterLink v-for="e in store.events" :key="e.id" :to="`/tournaments/${e.id}`" class="card t-item">
          <span class="t-name">{{ e.name }}</span>
          <span class="muted t-meta">
            {{ e.bracket_size }}-slot knockout · seeded by {{ e.seeding === 'ladder' ? 'ladder' : 'round robin' }}
          </span>
          <span class="t-status" :class="{ done: e.status === 'completed' }">
            {{ e.status === 'completed' ? 'Finished' : 'In progress' }}
          </span>
        </RouterLink>
      </div>
      <div v-else class="card" style="padding:1.5rem">
        <p class="muted">No tournaments yet.</p>
        <p v-if="!canAdmin" class="muted" style="font-size:0.85rem;margin-top:0.5rem">An admin can set one up here.</p>
      </div>

      <!-- Admin: create -->
      <section v-if="canAdmin" class="card t-create" data-testid="create-panel">
        <h2 style="font-size:1.05rem;margin-bottom:0.25rem">New knockout tournament</h2>
        <p class="muted" style="font-size:0.8rem;margin-bottom:1rem">
          Standard seeding, 2 to 64 players. Top seeds get byes when the field isn't a power of two.
          Results here don't change ratings, XP, the pass or quests.
        </p>

        <div class="field" style="margin-bottom:0.75rem">
          <label class="field-label" for="t-name">Name</label>
          <input id="t-name" v-model="name" class="input" placeholder="Autumn Open" maxlength="80" />
        </div>

        <div class="field" style="margin-bottom:0.75rem">
          <label class="field-label" for="t-seeding">Seed by</label>
          <select id="t-seeding" v-model="seeding" class="input">
            <option value="ladder">Ladder rating</option>
            <option value="round_robin">Round robin rating</option>
          </select>
        </div>

        <div class="field" style="margin-bottom:0.75rem">
          <div class="t-entrants-head">
            <label class="field-label" style="margin:0">Players ({{ picked.size }})</label>
            <span>
              <button type="button" class="btn btn-ghost btn-sm" @click="selectAll">All</button>
              <button type="button" class="btn btn-ghost btn-sm" @click="picked = new Set()">None</button>
            </span>
          </div>
          <div class="t-entrants">
            <label v-for="p in roster" :key="p.profile_id" class="t-check">
              <input type="checkbox" :checked="picked.has(p.profile_id)" @change="toggle(p.profile_id)" />
              <span class="t-check-name">{{ profileName(p.profile) }}</span>
            </label>
          </div>
        </div>

        <p v-if="fieldProblem && picked.size" class="muted" style="font-size:0.8rem;margin-bottom:0.75rem">{{ fieldProblem }}</p>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-ghost" type="button" :disabled="!!fieldProblem || previewing" @click="doPreview">
            <span v-if="previewing" class="spinner" style="width:14px;height:14px;border-width:2px" />
            <span v-else>Preview draw</span>
          </button>
          <button class="btn btn-primary" type="button" :disabled="!!fieldProblem || !name.trim() || creating" @click="doCreate">
            <span v-if="creating" class="spinner" style="width:14px;height:14px;border-width:2px" />
            <span v-else>Create tournament</span>
          </button>
        </div>

        <div v-if="preview.length" class="t-preview" data-testid="preview">
          <p class="muted" style="font-size:0.8rem;margin:1rem 0 0.5rem">
            {{ preview[0].bracket_size }}-slot bracket, {{ byes }} {{ byes === 1 ? 'bye' : 'byes' }}
          </p>
          <ol class="t-seeds">
            <li v-for="r in preview" :key="r.profile_id">
              <span class="t-seed-n">{{ r.seed }}</span>
              <span class="t-seed-name">{{ nameOf(r.profile_id) }}</span>
              <span class="muted t-seed-rating">{{ r.rating == null ? 'no history' : Math.round(r.rating) }}</span>
              <span v-if="r.has_bye" class="t-seed-bye">bye</span>
            </li>
          </ol>
        </div>

        <p v-if="formError" class="flash flash-error" style="margin-top:0.75rem">{{ formError }}</p>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBracketsStore } from '@/stores/brackets'
import { usePlayersStore } from '@/stores/players'
import { useLeagueStore } from '@/stores/leagues'
import { useAuth } from '@/composables/useAuth'
import { entrantError, profileName } from '@/lib/bracket'
import type { SeedPreviewRow } from '@/types'

const router  = useRouter()
const store   = useBracketsStore()
const players = usePlayersStore()
const leagues = useLeagueStore()
const { isAdmin } = useAuth()

const canAdmin   = computed(() => leagues.isCurrentLeagueAdmin || isAdmin.value)
const leagueName = computed(() => leagues.currentLeague?.name ?? 'League')

const name     = ref('')
const seeding  = ref<'ladder' | 'round_robin'>('ladder')
const picked   = ref<Set<string>>(new Set())
const preview  = ref<SeedPreviewRow[]>([])
const previewing = ref(false)
const creating   = ref(false)
const formError  = ref('')

const roster = computed(() =>
  [...players.players].sort((a, b) => profileName(a.profile).localeCompare(profileName(b.profile))))
const fieldProblem = computed(() => entrantError(picked.value.size))
const byes = computed(() => preview.value.filter(r => r.has_bye).length)
const nameOf = (id: string) => profileName(players.players.find(p => p.profile_id === id)?.profile)

function toggle(id: string) {
  const next = new Set(picked.value)
  next.has(id) ? next.delete(id) : next.add(id)
  picked.value = next
}
const selectAll = () => { picked.value = new Set(roster.value.map(p => p.profile_id)) }

// Any change to the field or the seeding basis makes an earlier preview stale.
watch([picked, seeding], () => { preview.value = []; formError.value = '' })

async function doPreview() {
  formError.value = ''; previewing.value = true
  try { preview.value = await store.previewSeeds(seeding.value, [...picked.value]) }
  catch (e: any) { formError.value = e.message }
  finally { previewing.value = false }
}

async function doCreate() {
  formError.value = ''; creating.value = true
  try {
    const id = await store.createEvent(name.value, seeding.value, [...picked.value])
    router.push(`/tournaments/${id}`)
  } catch (e: any) { formError.value = e.message }
  finally { creating.value = false }
}

onMounted(async () => {
  await Promise.all([store.fetchEvents(), players.players.length ? Promise.resolve() : players.fetch()])
  if (!leagues.isCurrentLeagueAdmin) leagues.refreshCurrentLeagueAdmin?.()
})
</script>

<style scoped>
.t-list { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.5rem; }
.t-item { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.9rem 1.1rem; text-decoration: none; color: inherit; }
.t-item:hover { border-color: var(--ball); }
.t-name { font-weight: 600; flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; }
.t-meta { font-size: 0.8rem; }
.t-status { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sky); }
.t-status.done { color: var(--net); }
.t-create { padding: 1.25rem; margin-top: 1.5rem; }
.t-entrants-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; gap: 0.5rem; }
.t-entrants { max-height: 14rem; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0.25rem 0.6rem; }
.t-check { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0; font-size: 0.9rem; }
.t-check-name { min-width: 0; overflow-wrap: anywhere; }
.t-seeds { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.t-seeds li { display: flex; align-items: baseline; gap: 0.6rem; font-size: 0.85rem; min-width: 0; }
.t-seed-n { flex: 0 0 1.6rem; font-family: var(--font-mono); color: var(--txt-secondary); }
.t-seed-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.t-seed-rating { font-family: var(--font-mono); font-size: 0.75rem; }
.t-seed-bye { font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ball); }
</style>
