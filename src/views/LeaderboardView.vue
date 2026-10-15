<!-- src/views/LeaderboardView.vue — v0.0.7.9 (join prompt for non-members) · v0.0.7.3 (Board is a two-way toggle beside the title, not a dropdown) -->
<template>
  <main class="page">
    <div class="container">
      <div class="page-header page-header-row">
        <div>
          <p class="eyebrow">{{ leagueName }}</p>
          <h1>Standings</h1>
        </div>
        <div class="segmented" role="tablist" aria-label="Board">
          <button
            v-for="b in BOARDS"
            :key="b.value"
            type="button"
            role="tab"
            :class="{ active: board === b.value }"
            :aria-selected="board === b.value"
            @click="board = b.value"
          >{{ b.label }}</button>
        </div>
      </div>

      <JoinLeagueCard />

      <RoundRobinBoard v-if="board === 'rr'" />
      <LadderBoard v-else />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import JoinLeagueCard from '@/components/league/JoinLeagueCard.vue'
import RoundRobinBoard from '@/components/leaderboard/RoundRobinBoard.vue'
import LadderBoard from '@/components/leaderboard/LadderBoard.vue'
import { useSport } from '@/composables/useSport'

const { leagueName } = useSport()

// Round robin is the default board as of v0.0.5.2; the ladder standings
// are unchanged, just one dropdown away.
const BOARDS = [
  { value: 'rr', label: 'Round robin' },
  { value: 'ladder', label: 'Ladder' },
] as const
const board = ref<'rr' | 'ladder'>('rr')
</script>
