<!-- src/views/LeaderboardView.vue — v0.0.5.2 -->
<template>
  <main class="page">
    <div class="container">
      <div class="page-header" style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <p class="eyebrow">Building League</p>
          <h1>Standings</h1>
        </div>
        <div class="field" style="min-width:170px">
          <label class="field-label">Board</label>
          <select v-model="board" class="input">
            <option value="rr">Round robin</option>
            <option value="ladder">Ladder</option>
          </select>
        </div>
      </div>

      <RoundRobinBoard v-if="board === 'rr'" />
      <LadderBoard v-else />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import RoundRobinBoard from '@/components/leaderboard/RoundRobinBoard.vue'
import LadderBoard from '@/components/leaderboard/LadderBoard.vue'

// Round robin is the default board as of v0.0.5.2; the ladder standings
// are unchanged, just one dropdown away.
const board = ref<'rr' | 'ladder'>('rr')
</script>
