<!--
  SceneBackdrop — v0.0.9.1. The decorative picture behind a header (the signed-in home greeting, the profile header): the
  dusk tennis court or the outdoor ping pong table, whichever the league plays. It is only scenery: hidden from screen
  readers, and it never takes a click. The picture file, its size and its crop come from heroScene in lib/homeStats.ts,
  the same place the visitor home reads them from.

  Put it as the first child of an element with the `scene-header` class (see main.css), which sizes the header and keeps its
  words above the picture. A dark fade covers the left, where the words are, and clears to the right; a second fade at the
  bottom blends the picture into the page.
-->
<template>
  <div class="scene-backdrop" aria-hidden="true" data-test="scene-backdrop" :data-art="scene.art" :style="{ '--pos': scene.banner, '--pos-narrow': scene.bannerNarrow }">
    <img :src="scene.src" alt="" :width="scene.width" :height="scene.height" decoding="async" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { heroScene } from '@/lib/homeStats'

const props = defineProps<{ art: 'table' | 'court' }>()
const scene = computed(() => heroScene(props.art))
</script>

<style scoped>
.scene-backdrop { position: absolute; z-index: 0; inset: 0; pointer-events: none; overflow: hidden; }
.scene-backdrop img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: var(--pos); }
.scene-backdrop::after {
  content: ''; position: absolute; inset: 0;
  background:
    linear-gradient(to top, var(--table) 0%, rgba(7, 13, 23, 0) 30%),
    linear-gradient(to right, rgba(7, 13, 23, 0.92) 0%, rgba(7, 13, 23, 0.8) 34%, rgba(7, 13, 23, 0.3) 68%, rgba(7, 13, 23, 0.05) 100%);
}
/* a phone is narrow, so the words and buttons reach further across: keep the fade over more of it */
@media (max-width: 600px) {
  .scene-backdrop img { object-position: var(--pos-narrow); }
  .scene-backdrop::after {
    background:
      linear-gradient(to top, var(--table) 0%, rgba(7, 13, 23, 0) 30%),
      linear-gradient(to right, rgba(7, 13, 23, 0.92) 0%, rgba(7, 13, 23, 0.84) 58%, rgba(7, 13, 23, 0.4) 100%);
  }
}
</style>
