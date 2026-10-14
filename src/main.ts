import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { listenForInstallPrompt } from './composables/useInstallPrompt'
import './assets/main.css'

// The browser fires its "install" offer early, often before any page has
// mounted, so listen from the start (see useInstallPrompt.ts).
listenForInstallPrompt()

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app')

// v0.0.7.5: a tiny service worker that only shows an offline page when the app
// can't be reached (public/sw.js). Production only, so it never gets in the way
// of the dev server.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal: the app works without it */ })
  })
}
