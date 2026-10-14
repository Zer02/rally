// public/sw.js — v0.0.7.5
//
// A deliberately tiny service worker. Its only job is to show a friendly page
// when the app is opened with no connection, instead of the browser's error
// screen. It does NOT cache the app, the API or anything else, so players can
// never be stuck on an old version, and live data is never served stale:
// every request except opening a page goes straight to the network, untouched.
//
// If offline.html changes, bump OFFLINE_CACHE so phones fetch the new copy.
const OFFLINE_CACHE = 'rally-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('rally-offline-') && k !== OFFLINE_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  // Only page loads. Scripts, styles, fonts and every Supabase call are left alone.
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)))
})
