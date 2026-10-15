<!--
  InstallAppCard — v0.0.7.8. A quiet card at the foot of the Profile page offering to add Rally
  to the home screen: an Install button where the browser allows it, otherwise the steps for
  the person's phone. "Not now" hides it for 30 days. Renders nothing when there is nothing to
  offer (already installed, or a browser that can't install apps). See useInstallPrompt.ts.
-->
<template>
  <section v-if="show" class="page-more install-card-wrap">
    <div class="card install-card">
      <div class="install-card-text">
        <h3>Install Rally</h3>
        <template v-if="canPrompt">
          <p class="muted">Add Rally to your home screen to open it like an app, full screen and one tap away.</p>
          <p class="muted install-hint">No button later? Use your browser's menu: <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
        </template>
        <p v-else-if="showAndroidSteps" class="muted">
          To add Rally to your home screen: open your browser's menu (the three dots), then tap
          <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        </p>
        <p v-else class="muted">
          To add Rally to your home screen: tap the <strong>Share</strong> button in Safari, then
          <strong>Add to Home Screen</strong>.
        </p>
      </div>
      <div class="install-card-actions">
        <button v-if="canPrompt" type="button" class="btn btn-primary btn-sm" @click="install">Install</button>
        <button type="button" class="install-dismiss" @click="dismiss">Not now</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const { show, canPrompt, showAndroidSteps, install, dismiss } = useInstallPrompt()
</script>

<style scoped>
.install-card { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
.install-card-text h3 { margin-bottom: 0.35rem; }
.install-card-text p { font-size: 0.85rem; line-height: 1.5; }
.install-hint { margin-top: 0.4rem; font-size: 0.78rem !important; }
.install-card-actions { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.install-dismiss { font: inherit; font-size: 0.8rem; color: var(--txt-muted); background: none; border: 0; padding: 0.25rem 0.5rem; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.install-dismiss:hover { color: var(--txt-secondary); }
</style>
