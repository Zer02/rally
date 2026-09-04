<template>
  <div
    class="avatar"
    :style="{
      width: size + 'px',
      height: size + 'px',
      background: bg,
      color: fg,
      fontSize: (override ? Math.round(size * 0.5) : Math.round(size * 0.38)) + 'px',
    }"
  >{{ override ?? initials }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  size?: number
  override?: string
}>()

const size = computed(() => props.size ?? 36)

const PALETTES = [
  { bg: '#faeeda', fg: '#854f0b' },
  { bg: '#e1f5ee', fg: '#0f6e56' },
  { bg: '#eeedfe', fg: '#3c3489' },
  { bg: '#e6f1fb', fg: '#185fa5' },
  { bg: '#faece7', fg: '#712b13' },
  { bg: '#fbeaf0', fg: '#72243e' },
  { bg: '#eaf3de', fg: '#3b6d11' },
]

const palette = computed(() => {
  const i = props.name.charCodeAt(0) % PALETTES.length
  return PALETTES[i]
})

const bg = computed(() => palette.value.bg)
const fg = computed(() => palette.value.fg)

const initials = computed(() => {
  const parts = props.name.trim().split(' ')
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return props.name.slice(0, 2).toUpperCase()
})
</script>
