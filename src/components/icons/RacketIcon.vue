<!-- src/components/icons/RacketIcon.vue — v0.0.4.8
     No single "tennis racket" emoji exists in Unicode (🎾 is a ball, not
     a racket), so this draws one instead — used wherever the app used
     to fall back to the 🏆 trophy emoji as its default league icon. -->
<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="rotate(-25 16 16)">
      <ellipse cx="14" cy="11" rx="6.5" ry="8" fill="none" :stroke="color" stroke-width="2.2" />
      <line x1="14" y1="3.4" x2="14" y2="18.6" :stroke="color" stroke-width="1.1" />
      <line x1="7.8" y1="11" x2="20.2" y2="11" :stroke="color" stroke-width="1.1" />
      <rect x="12.3" y="18.3" width="3.4" height="10.5" rx="1.6" :fill="color" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), {
  size: 20,
  color: 'var(--ball)',
})
</script>
