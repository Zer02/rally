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
      <HeroArt :variant="copy.art" class="hero-img" />
    </section>

    <template v-if="leagueId && loaded">
      <HomeStatStrip :players="players" :matches="matches" :matches-week="matchesWeek" :streak="streak" />
      <div class="panels">
        <HomeLadderCard :rows="ladder" />
        <HomeSeasonCard :season="season" />
      </div>
    </template>

    <HomeFeatures class="steps" />
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
import HeroArt from './HeroArt.vue'
import HomeStatStrip from './HomeStatStrip.vue'
import HomeLadderCard from './HomeLadderCard.vue'
import HomeSeasonCard from './HomeSeasonCard.vue'
import HomeFeatures from './HomeFeatures.vue'

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
</script>

<style scoped>
.hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 1rem; align-items: center; padding: 0.5rem 0 1.75rem; }
.hero h1 { margin: 0.5rem 0 1rem; font-size: clamp(2.2rem, 5.2vw, 3.4rem); }
.hero-sub { font-size: 1.05rem; color: var(--txt-secondary); line-height: 1.65; margin-bottom: 1.6rem; max-width: 30rem; }
.welcome-cta { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.welcome-cta .btn { font-size: 1rem; padding: 0.75rem 1.5rem; justify-content: center; }
.hero-img { min-width: 0; }
.panels { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 1.25rem; margin-top: 1.25rem; align-items: stretch; }

@media (max-width: 800px) {
  .hero { grid-template-columns: minmax(0, 1fr); gap: 0.5rem; padding-bottom: 1.25rem; }
  .hero-img { order: 2; max-width: 30rem; margin: 0 auto; }
  .welcome-cta { flex-direction: column; }
  .welcome-cta .btn { width: 100%; }
  .panels { grid-template-columns: minmax(0, 1fr); }
}
</style>
