<template>
  <div class="rating-chart">
    <svg
      v-if="points.length > 1"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
      class="rating-chart-svg"
    >
      <!-- baseline at starting rating, for a quick "up or down since start" read -->
      <line
        :x1="pad" :x2="width - pad"
        :y1="baselineY" :y2="baselineY"
        stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3"
      />
      <polyline :points="linePoints" fill="none" :stroke="strokeColor" stroke-width="2" />
      <circle :cx="points[points.length - 1].x" :cy="points[points.length - 1].y" r="3" :fill="strokeColor" />
    </svg>

    <div v-else class="muted" style="padding:1.5rem 0;text-align:center;font-size:0.85rem">
      Not enough match history yet to chart a trend.
    </div>

    <div v-if="points.length > 1" class="rating-chart-footer">
      <span class="muted mono">{{ firstDate }} · {{ history[0].rating }}</span>
      <span class="muted mono">{{ lastDate }} · {{ history[history.length - 1].rating }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  history: { rating: number; recorded_at: string }[]
}>()

const width  = 400
const height = 90
const pad    = 6

const ratings = computed(() => props.history.map(h => h.rating))
const minR = computed(() => Math.min(...ratings.value))
const maxR = computed(() => Math.max(...ratings.value))
const range = computed(() => (maxR.value - minR.value) || 1)

function ratingToY(r: number) {
  return height - pad - ((r - minR.value) / range.value) * (height - pad * 2)
}

const points = computed(() => {
  const h = props.history
  if (h.length < 2) return []
  return h.map((entry, i) => ({
    x: pad + (i / (h.length - 1)) * (width - pad * 2),
    y: ratingToY(entry.rating),
  }))
})

const baselineY = computed(() => ratingToY(props.history[0]?.rating ?? 1000))
const linePoints = computed(() => points.value.map(p => `${p.x},${p.y}`).join(' '))

const strokeColor = computed(() => {
  if (ratings.value.length < 2) return '#8a8f9c'
  return ratings.value[ratings.value.length - 1] >= ratings.value[0] ? '#4ade80' : '#f87171'
})

const firstDate = computed(() => formatDate(props.history[0]?.recorded_at))
const lastDate  = computed(() => formatDate(props.history[props.history.length - 1]?.recorded_at))

function formatDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.rating-chart-svg { width: 100%; height: 90px; display: block; }
.rating-chart-footer {
  display: flex; justify-content: space-between;
  margin-top: 0.4rem; font-size: 0.7rem;
}
</style>
