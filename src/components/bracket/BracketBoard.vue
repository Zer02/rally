<template>
  <div class="bracket-scroll" data-testid="bracket">
    <div class="bracket">
      <section v-for="(round, ri) in rounds" :key="ri" class="b-round">
        <h3 class="b-round-title">{{ roundName(ri + 1, rounds.length) }}</h3>
        <div class="b-round-body">
          <component
            :is="canClick(m) ? 'button' : 'div'"
            v-for="m in round" :key="m.id"
            class="b-match" :class="{ 'is-bye': m.status === 'bye', 'is-click': canClick(m), 'is-selected': m.id === selectedId }"
            :type="canClick(m) ? 'button' : undefined"
            :data-match="`${m.round}-${m.slot}`"
            @click="canClick(m) && $emit('select', m)"
          >
            <div v-for="side in sides(m)" :key="side.key" class="b-row"
                 :class="{ 'is-winner': side.winner, 'is-loser': side.loser, 'is-empty': !side.id }">
              <span class="b-seed">{{ side.seed == null ? '' : `(${side.seed})` }}</span>
              <span class="b-name">{{ side.label }}</span>
              <span class="b-score">{{ side.score ?? '' }}</span>
            </div>
            <span v-if="m.status === 'bye'" class="b-tag">bye</span>
          </component>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { groupRounds, matchLoserId, profileName, roundName } from '@/lib/bracket'
import type { BracketMatch, BracketEntrant } from '@/types'

const props = defineProps<{
  matches: BracketMatch[]
  entrants: Map<string, BracketEntrant>
  /** Matches an admin may click to enter or correct a result. */
  editableIds?: Set<string>
  selectedId?: string | null
}>()
defineEmits<{ (e: 'select', m: BracketMatch): void }>()

const rounds = computed(() => groupRounds(props.matches))
const canClick = (m: BracketMatch) => !!props.editableIds?.has(m.id)

function sides(m: BracketMatch) {
  const loser = matchLoserId(m)
  const mk = (key: string, id: string | null, score: number | null) => {
    const e = id ? props.entrants.get(id) : undefined
    return {
      key, id, score, seed: e?.seed ?? null,
      label: id ? profileName(e?.profile) : (m.status === 'bye' ? '' : 'TBD'),
      winner: m.status === 'completed' && !!id && id === m.winner_id,
      loser: !!id && id === loser,
    }
  }
  return [mk('a', m.player_a_id, m.score_a), mk('b', m.player_b_id, m.score_b)]
}
</script>

<style scoped>
.bracket-scroll { overflow-x: auto; padding-bottom: 0.5rem; -webkit-overflow-scrolling: touch; }
.bracket { display: flex; gap: 1.25rem; min-width: min-content; align-items: stretch; }
.b-round { display: flex; flex-direction: column; width: 200px; flex: 0 0 200px; }
/* Headers sit at the top of each column. They cannot be sticky: the sideways scroll container blocks it. */
.b-round-title { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ball); margin: 0 0 0.6rem; }
.b-round-body { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 0.6rem; }
.b-match { position: relative; display: block; width: 100%; text-align: left; font: inherit; color: inherit; background: var(--table-mid); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 0; overflow: hidden; }
.b-match.is-bye { opacity: 0.7; }
.b-match.is-click { cursor: pointer; }
.b-match.is-click:hover, .b-match.is-selected { border-color: var(--ball); }
.b-row { display: flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.6rem; font-size: 0.84rem; min-width: 0; }
.b-row + .b-row { border-top: 1px solid var(--line); }
.b-seed { flex: 0 0 1.9rem; font-family: var(--font-mono); font-size: 0.7rem; color: var(--txt-secondary); }
.b-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }   /* long names wrap: nothing is cut off */
.b-score { flex: 0 0 auto; font-family: var(--font-mono); font-weight: 600; }
.b-row.is-winner { background: rgba(76, 175, 138, 0.14); font-weight: 600; }
.b-row.is-loser { color: var(--ace); }
.b-row.is-loser .b-name { text-decoration: line-through; }
.b-row.is-empty { color: var(--txt-muted); }
.b-tag { position: absolute; right: 0.5rem; bottom: 0.15rem; font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--txt-muted); }
</style>
