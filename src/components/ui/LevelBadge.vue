<!-- src/components/ui/LevelBadge.vue — v0.0.5.0
     Battle-pass level pill. Deliberately NOT called "tier": TierBadge
     already means the rating tier (Rookie → Champion) in this app. -->
<template>
  <span class="level-badge">
    <span class="level-num">Lv {{ lvl.level }}</span>
    <span v-if="!compact" class="level-title">{{ lvl.title }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getLevel } from '@/lib/xp'

const props = defineProps<{ xp: number; compact?: boolean }>()
const lvl = computed(() => getLevel(props.xp))
</script>

<style scoped>
.level-badge {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.2rem 0.65rem; border-radius: 999px;
  border: 1px solid rgba(232,200,74,0.35); background: rgba(232,200,74,0.08);
  font-size: 0.75rem; font-weight: 600; white-space: nowrap;
}
.level-num   { color: var(--ball); font-family: var(--font-mono); }
.level-title { color: var(--txt-secondary); font-weight: 500; }
</style>
