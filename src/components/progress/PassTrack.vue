<!-- src/components/progress/PassTrack.vue - v0.0.8.4
     The season pass: every level, what it takes, and where you are. Opens from the level card on
     Progress. A bottom sheet on a phone, a centred panel on a wide screen. -->
<template>
  <Teleport to="body">
    <div class="pass-backdrop" data-test="pass-backdrop" @click.self="emit('close')">
      <div class="pass-sheet" role="dialog" aria-modal="true" aria-labelledby="pass-title" data-test="pass-sheet" @keydown.tab.prevent>
        <header class="pass-head">
          <div class="pass-head-text">
            <p class="pass-eyebrow">Season pass</p>
            <h2 id="pass-title" class="pass-title">Level {{ lp.current.level }} · {{ lp.current.title }}</h2>
            <p class="pass-sub mono">{{ passXp }} XP this season · {{ lifetimeXp }} XP lifetime</p>
          </div>
          <button ref="closeBtn" type="button" class="pass-close" aria-label="Close the season pass" @click="emit('close')">✕</button>
        </header>

        <ol class="pass-levels" data-test="pass-levels">
          <li
            v-for="l in levels" :key="l.level" class="pass-level"
            :class="{ reached: l.level < lp.current.level, current: l.level === lp.current.level, locked: l.level > lp.current.level }"
            :data-level="l.level" :aria-current="l.level === lp.current.level ? 'step' : undefined"
          >
            <span class="pass-num" aria-hidden="true">{{ l.level < lp.current.level ? '✓' : l.level }}</span>
            <div class="pass-body">
              <div class="pass-row">
                <span class="pass-level-title">{{ l.title }}</span>
                <span class="pass-xp mono">{{ l.xp }} XP</span>
              </div>
              <template v-if="l.level === lp.current.level">
                <div v-if="lp.next" class="pass-bar" role="progressbar" :aria-valuenow="lp.progressPct" aria-valuemin="0" aria-valuemax="100">
                  <div class="pass-bar-fill" :style="{ width: lp.progressPct + '%' }" />
                </div>
                <p class="pass-note">
                  <template v-if="lp.next">You are here · {{ lp.xpForLevel - lp.xpIntoLevel }} XP to {{ lp.next.title }}</template>
                  <template v-else>You are here · the top of the pass</template>
                </p>
              </template>
              <p v-else-if="l.level > lp.current.level" class="pass-note">{{ l.xp - passXp }} XP to go</p>
            </div>
          </li>
        </ol>

        <footer class="pass-foot">
          <p>The pass starts fresh each round robin season. Your lifetime XP stays on your profile.</p>
          <p>The quickest way up is the weekly quests. After 5 matches in a week, and for repeat games against the same player, each match earns less, but it always earns something.</p>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { allLevels, levelProgress } from '@/lib/xp'
import { useSport } from '@/composables/useSport'

const props = defineProps<{ passXp: number; lifetimeXp: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { sport } = useSport()
const levels = computed(() => allLevels(sport.value))
const lp = computed(() => levelProgress(props.passXp, sport.value))
const closeBtn = ref<HTMLButtonElement | null>(null)

let opener: Element | null = null
let scrollWas = ''
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }

onMounted(async () => {
  opener = document.activeElement
  scrollWas = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKey)
  await nextTick()
  closeBtn.value?.focus()
  document.querySelector('.pass-level.current')?.scrollIntoView({ block: 'center' })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = scrollWas
  if (opener instanceof HTMLElement) opener.focus()
})
</script>

<style scoped>
.pass-backdrop {
  position: fixed; inset: 0; z-index: 1000; background: rgba(5,8,12,0.72);
  display: flex; align-items: flex-end; justify-content: center;
}
.pass-sheet {
  width: 100%; max-width: 30rem; max-height: 88vh; max-height: 88dvh; overflow-y: auto; overscroll-behavior: contain;
  background: var(--table-mid); border: 1px solid var(--line); border-bottom: none;
  border-radius: 18px 18px 0 0; box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
  padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 701px) {
  .pass-backdrop { align-items: center; }
  .pass-sheet { border-bottom: 1px solid var(--line); border-radius: 18px; max-height: 84vh; }
}
.pass-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.pass-head-text { min-width: 0; }
.pass-eyebrow { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ball); margin-bottom: 0.2rem; }
.pass-title { font-family: var(--font-display); font-size: 1.35rem; line-height: 1.15; }
.pass-sub { color: var(--txt-secondary); font-size: 0.78rem; margin-top: 0.35rem; }
.pass-close {
  flex-shrink: 0; width: 2.25rem; height: 2.25rem; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--table-light); color: var(--txt-secondary); font-size: 1rem;
}
.pass-close:hover, .pass-close:focus-visible { color: var(--txt-primary); outline: 2px solid var(--ball); outline-offset: 2px; }

.pass-levels { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
.pass-level { display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.65rem 0.75rem; border-radius: 12px; border: 1px solid transparent; }
.pass-level.current { background: rgba(232,200,74,0.09); border-color: rgba(232,200,74,0.4); }
.pass-num {
  flex-shrink: 0; width: 1.9rem; height: 1.9rem; border-radius: 999px; display: grid; place-items: center;
  font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600;
  background: var(--table-light); color: var(--txt-secondary); border: 1px solid var(--line);
}
.pass-level.reached .pass-num { background: rgba(80,200,140,0.14); color: #6fd6a0; border-color: rgba(80,200,140,0.4); }
.pass-level.current .pass-num { background: var(--ball); color: #11151c; border-color: var(--ball); }
.pass-level.locked { opacity: 0.72; }
.pass-body { flex: 1; min-width: 0; }
.pass-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
.pass-level-title { font-size: 0.95rem; font-weight: 600; color: var(--txt-primary); }
.pass-xp { font-size: 0.78rem; color: var(--txt-secondary); white-space: nowrap; }
.pass-note { font-size: 0.78rem; color: var(--txt-secondary); margin-top: 0.2rem; }
.pass-bar { height: 8px; border-radius: 999px; background: var(--table-light); border: 1px solid var(--line); overflow: hidden; margin-top: 0.5rem; }
.pass-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--ball), #f3dc7a); }
.pass-foot { margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--line); font-size: 0.8rem; color: var(--txt-secondary); display: flex; flex-direction: column; gap: 0.5rem; }
</style>
