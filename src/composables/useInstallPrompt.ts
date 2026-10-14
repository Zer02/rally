// src/composables/useInstallPrompt.ts — v0.0.7.5
//
// "Add Rally to your home screen". Two cases:
//   - Chrome, Edge and Android browsers send a `beforeinstallprompt` event when the
//     app can be installed. We keep it and replay it when the person taps Install.
//   - iPhone and iPad Safari never send that event: the only way is Share, then
//     "Add to Home Screen", so we show those steps instead.
// Nothing is shown once the app is running installed (standalone), or in a
// browser that offers neither.
import { computed, ref } from 'vue'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = ref<InstallEvent | null>(null)
const installed = ref(false)
let listening = false

/** True when the page is running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone, iPad (including iPadOS, which reports itself as a Mac with a touch screen). */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Call once at startup (main.ts): the install event can fire before any page mounts. */
export function listenForInstallPrompt() {
  if (listening || typeof window === 'undefined') return
  listening = true
  installed.value = isStandalone()
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()               // keep it for our own Install button
    deferred.value = e as InstallEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
}

export function useInstallPrompt() {
  const canPrompt = computed(() => !!deferred.value)
  const showIosSteps = computed(() => !installed.value && !deferred.value && isIosDevice())
  const show = computed(() => !installed.value && (canPrompt.value || showIosSteps.value))

  async function install() {
    const ev = deferred.value
    if (!ev) return
    deferred.value = null            // an install event can be used only once
    await ev.prompt()
    const { outcome } = await ev.userChoice
    if (outcome === 'accepted') installed.value = true
  }

  return { show, canPrompt, showIosSteps, installed, install }
}
