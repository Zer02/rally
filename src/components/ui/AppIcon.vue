<!-- AppIcon — v0.0.8.6. A handful of line icons (Feather-style, drawn here so nothing is downloaded). -->
<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PATHS[name]" />
</template>

<script setup lang="ts">
export type IconName = 'users' | 'trophy' | 'flame' | 'calendar' | 'pin' | 'chart' | 'racket' | 'list' | 'arrow'
withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })

const PATHS: Record<IconName, string> = {
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3-1.8-5.2-3.5-7C14.7 7.2 14 5.5 14 3c-3 1.8-5.5 5-5.5 8.5-1-.5-1.8-1.5-2-3C4.7 10 5 12 5 15c0 4.2 3 7 7 7z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  racket: '<circle cx="9.5" cy="9.5" r="6.5"/><path d="M14.2 14.2L21 21M5.5 6.5l6 6M8 4.2l7 7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
}
</script>
