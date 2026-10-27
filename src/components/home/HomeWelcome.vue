<!--
  HomeWelcome — v0.0.8.6. What a visitor (not signed in) sees, in the style of the new mockups: a hero with the
  pitch, two buttons and an illustration; the league's numbers; the top of the ladder beside the round robin's
  week; and a row of what Rally does. Numbers come from tables anyone can read, so a visitor sees the same as a
  member. When no league is known yet, the numbers and cards are left out and the pitch stands on its own.
-->
<template>
  <div class="welcome">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">{{ copy.eyebrow }}</p>
        <h1>{{ copy.line1 }}<br /><em>{{ copy.line2 }}</em></h1>
        <p class="hero-sub">{{ copy.sub }}</p>
        <div class="welcome-cta">
          <RouterLink to="/login" class="btn btn-primary">Join the league <AppIcon name="arrow" :size="16" /></RouterLink>
          <RouterLink to="/leaderboard" class="btn btn-ghost">View standings</RouterLink>
        </div>
      </div>
      <div class="hero-img" :style="{ '--pos-wide': scene.wide, '--pos-narrow': scene.narrow, '--block': scene.block }">
        <img class="hero-art" :src="scene.src" :alt="scene.alt" :width="1228" :height="scene.height" fetchpriority="high" decoding="async" />
      </div>
    </section>

    <template v-if="leagueId && loaded">
      <HomeStatStrip :players="players" :matches="matches" :matches-week="matchesWeek" :streak="streak" />
      <div class="panels">
        <HomeLadderCard :rows="ladder" />
        <HomeSeasonCard :season="season" :strip="scene.src" />
      </div>
    </template>

    <HomeFeatures class="steps" />

    <DuskBanner />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSport } from '@/composables/useSport'
import { useLeagueStore } from '@/stores/leagues'
import { getSport } from '@/lib/sports'
import { useHomeData } from '@/composables/useHomeData'
import { heroCopy } from '@/lib/homeStats'
import AppIcon from '@/components/ui/AppIcon.vue'
import HomeStatStrip from './HomeStatStrip.vue'
import HomeLadderCard from './HomeLadderCard.vue'
import HomeSeasonCard from './HomeSeasonCard.vue'
import HomeFeatures from './HomeFeatures.vue'
import DuskBanner from './DuskBanner.vue'

const { sport } = useSport()
const { leagueId, loaded, players, matches, matchesWeek, streak, ladder, season } = useHomeData()
// The sport of the league being shown. A visitor with no league remembered gets the site's only league,
// so use the sport of that league (not the generic one) when we know it.
const leagueStore = useLeagueStore()
const shownSport = computed(() => {
  const l = leagueStore.allLeagues.find(x => x.id === leagueId.value) ?? leagueStore.myLeagues.find(x => x.id === leagueId.value)
  return l ? getSport(l.sport) : sport.value
})
const copy = computed(() => heroCopy(shownSport.value))
// The hero picture: a dusk tennis court for court sports, an outdoor ping pong table for table sports.
const scene = computed(() => copy.value.art === 'table'
  // `wide` and `narrow` say which part of the picture to keep when it is cropped (the paddles and ball for the table,
  // the racket and skyline for the court), on a wide screen and on a phone
  ? { src: '/hero/table.jpg', alt: 'A ping pong table', height: 417, wide: '20% 82%', block: '60%', narrow: '40% 50%' }
  : { src: '/hero/tennis.jpg', alt: 'A tennis court', height: 454, wide: '100% 50%', block: '72%', narrow: '78% 50%' })
</script>

<style scoped>
.welcome { flex: 1; display: flex; flex-direction: column; }
.welcome > :not(.dusk) { flex: none; }
.hero { position: relative; isolation: isolate; display: block; margin: 0 calc(50% - 50vw); padding: 0.5rem calc(50vw - 50%) 2.25rem; min-height: 28rem; overflow: hidden; }
.hero-copy { position: relative; z-index: 1; max-width: 33rem; padding-top: 0.5rem; }
.hero h1 { margin: 0.5rem 0 1rem; font-size: clamp(2.2rem, 5.2vw, 3.4rem); }
.hero-sub { font-size: 1.05rem; color: var(--txt-secondary); line-height: 1.65; margin-bottom: 1.6rem; max-width: 30rem; }
.welcome-cta { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.welcome-cta .btn { font-size: 1rem; padding: 0.75rem 1.5rem; justify-content: center; }
/* the scene fills the right of the hero edge to edge and fades into the page on its left and bottom */
.hero-art { display: block; width: 100%; height: 100%; object-fit: cover; object-position: var(--pos-wide); }
.hero-img { position: absolute; z-index: 0; top: 0; right: 0; bottom: 0; width: var(--block, 72%); pointer-events: none;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.45) 24%, #000 52%), linear-gradient(to top, transparent 0%, #000 12%);
  -webkit-mask-composite: source-in; mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.45) 24%, #000 52%), linear-gradient(to top, transparent 0%, #000 12%); mask-composite: intersect; }
.panels { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 1.25rem; margin-top: 1.25rem; align-items: stretch; }

@media (max-width: 800px) {
  .hero { padding-bottom: 0; min-height: 0; }
  .hero-copy { max-width: none; }
  .welcome-cta { flex-direction: column; }
  .welcome-cta .btn { width: 100%; }
  .hero-art { object-position: var(--pos-narrow); }
  .hero-img { position: relative; width: auto !important; height: 17rem; margin: 1.25rem calc(50vw - 50%) 0 calc(50vw - 50%) ; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw);
    -webkit-mask-image: linear-gradient(to top, transparent 0%, #000 18%); mask-image: linear-gradient(to top, transparent 0%, #000 18%); }
  .panels { grid-template-columns: minmax(0, 1fr); }
}
</style>
