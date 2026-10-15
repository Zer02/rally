// src/composables/useInstallPrompt.ts — v0.0.7.8
//
// "Add Rally to your home screen". Three cases:
//   - Chrome, Edge and Android browsers send a `beforeinstallprompt` event when the
//     app can be installed. We keep it and replay it when the person taps Install.
//   - iPhone and iPad Safari never send that event: the only way is Share, then
//     "Add to Home Screen", so we show those steps instead.
//   - On an Android phone with no offer (for example after a cancelled prompt, when the browser
//     waits before offering again) we show the manual menu steps, so there is always a way in.
// Nothing is shown once the app is running installed (standalone), after "Not now" (hidden
// for 30 days, then it comes back, so hiding it never blocks a later reinstall), or in a
// browser that offers none of this (a desktop one with no install offer).
import { computed, ref } from 'vue'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = ref<InstallEvent | null>(null)
const installed = ref(false)
let listening = false

// "Not now": remembered in this browser for 30 days. Storage can be blocked (private
// browsing), in which case it just lasts until the page is reloaded.
const HIDE_KEY = 'rally.installHiddenUntil'
const HIDE_DAYS = 30
function readHiddenUntil(): number {
  try { return Number(localStorage.getItem(HIDE_KEY)) || 0 } catch { return 0 }
}
const hiddenUntil = ref(readHiddenUntil())

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

/** Android phones and tablets (where the browser menu has Install app / Add to Home screen). */
export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
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
  const hidden = computed(() => Date.now() < hiddenUntil.value)
  const canPrompt = computed(() => !!deferred.value)
  const showIosSteps = computed(() => !installed.value && !deferred.value && isIosDevice())
  const showAndroidSteps = computed(() => !installed.value && !deferred.value && !isIosDevice() && isAndroidDevice())
  const show = computed(() =>
    !installed.value && !hidden.value && (canPrompt.value || showIosSteps.value || showAndroidSteps.value))

  async function install() {
    const ev = deferred.value
    if (!ev) return
    deferred.value = null            // an install event can be used only once
    await ev.prompt()
    const { outcome } = await ev.userChoice
    if (outcome === 'accepted') installed.value = true
  }

  /** "Not now": hide the card for 30 days. */
  function dismiss() {
    hiddenUntil.value = Date.now() + HIDE_DAYS * 864e5
    try { localStorage.setItem(HIDE_KEY, String(hiddenUntil.value)) } catch { /* not fatal */ }
  }

  return { show, canPrompt, showIosSteps, showAndroidSteps, installed, install, dismiss }
}
