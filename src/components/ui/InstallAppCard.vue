<!--
  InstallAppCard — v0.0.7.5. A quiet card at the foot of the Profile page offering
  to add Rally to the home screen. Renders nothing when there is nothing to offer
  (already installed, or a browser that can't install apps). See useInstallPrompt.ts.
-->
<template>
  <section v-if="show" class="page-more install-card-wrap">
    <div class="card install-card">
      <div class="install-card-text">
        <h3>Install Rally</h3>
        <p v-if="canPrompt" class="muted">Add Rally to your home screen to open it like an app, full screen and one tap away.</p>
        <p v-else class="muted">
          To add Rally to your home screen: tap the <strong>Share</strong> button in Safari, then
          <strong>Add to Home Screen</strong>.
        </p>
      </div>
      <button v-if="canPrompt" type="button" class="btn btn-primary btn-sm" @click="install">Install</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const { show, canPrompt, install } = useInstallPrompt()
</script>

<style scoped>
.install-card { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
.install-card-text h3 { margin-bottom: 0.35rem; }
.install-card-text p { font-size: 0.85rem; line-height: 1.5; }
.install-card .btn { flex-shrink: 0; }
</style>
