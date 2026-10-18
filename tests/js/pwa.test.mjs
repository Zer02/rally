// The installable-app files (v0.0.7.5): manifest, icons, service worker, offline page.
// Static checks only; tests/browser/run.mjs exercises them in a real browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = f => readFileSync(join(ROOT, f), 'utf8')
const manifest = JSON.parse(read('public/manifest.webmanifest'))
const pngSize = f => { const b = readFileSync(join(ROOT, 'public', f)); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` }
const routes = [...read('src/router/index.ts').matchAll(/path:\s*['"]([^'"]+)['"]/g)].map(m => m[1])

test('manifest has what a browser needs to offer an install', () => {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color'])
    assert.ok(manifest[k], `manifest.${k} is missing`)
  assert.equal(manifest.display, 'standalone')
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
})

test('icons: a 192 and a 512 for any use, a 512 maskable, and every file is really that size', () => {
  const has = (size, purpose) => manifest.icons.some(i => i.sizes === size && i.purpose === purpose)
  assert.ok(has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable'))
  for (const i of manifest.icons) {
    const f = i.src.replace(/^\//, '')
    assert.ok(existsSync(join(ROOT, 'public', f)), `${i.src} does not exist`)
    assert.equal(pngSize(f), i.sizes, `${i.src} is not ${i.sizes}`)
    assert.equal(i.type, 'image/png')
  }
})

test('tab and iPhone icons (v0.0.8.1): a light ICO with 16/32/48 frames, a 32 PNG, a 180 touch icon', () => {
  const ico = readFileSync(join(ROOT, 'public', 'favicon.ico'))
  assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico is not an ICO file')
  const frames = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b)
  assert.deepEqual(frames, [16, 32, 48], 'the ICO should hold 16, 32 and 48 only; 256px frames make it 100 KB+ and browsers fetch it on every first visit')
  assert.ok(ico.length < 30_000, `favicon.ico is ${ico.length} bytes`)
  assert.equal(pngSize('favicon-32.png'), '32x32')
  assert.equal(pngSize('apple-touch-icon.png'), '180x180')
  const html = read('index.html')
  for (const f of ['/favicon.ico', '/favicon-32.png', '/favicon-192.png', '/apple-touch-icon.png'])
    assert.ok(html.includes(`href="${f}"`) && existsSync(join(ROOT, 'public', f)), `${f} is not linked from index.html or is missing`)
})

test('start page and shortcuts point at real routes', () => {
  for (const url of [manifest.start_url, ...(manifest.shortcuts ?? []).map(s => s.url)])
    assert.ok(routes.includes(url), `${url} is not a route in src/router/index.ts (routes: ${routes.join(' ')})`)
})

test('index.html links the manifest and agrees with it on colour', () => {
  const html = read('index.html')
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/)
  assert.ok(html.includes(`<meta name="theme-color" content="${manifest.theme_color}"`), 'theme-color differs from the manifest')
  assert.match(html, /viewport-fit=cover/, 'viewport-fit=cover is what makes the safe-area padding work')
  assert.match(html, /apple-touch-icon/)
})

test('service worker only answers page loads, and only ever caches the offline page', () => {
  const sw = read('public/sw.js')
  assert.match(sw, /mode !== 'navigate'\) return/, 'it must leave every non-page request alone')
  assert.doesNotMatch(sw, /cache\.put\(|addAll\(|cache\.addAll/, 'caching more than the offline page would risk serving stale app files or data')
  assert.equal([...sw.matchAll(/cache\.add\(/g)].length, 1, 'exactly one thing is cached: the offline page')
  assert.match(sw, /OFFLINE_URL = '\/offline\.html'/)
})

test('offline page stands alone: no external files to fail to load when offline', () => {
  const html = read('public/offline.html')
  assert.doesNotMatch(html, /<link[^>]+stylesheet|<script[^>]+src=|<img[^>]+src="http|url\(http/i)
  assert.match(html, /offline/i)
})

test('Vercel serves the worker uncached and the manifest with its own type', () => {
  const v = JSON.parse(read('vercel.json'))
  const h = src => Object.fromEntries((v.headers.find(x => x.source === src)?.headers ?? []).map(x => [x.key, x.value]))
  assert.equal(h('/sw.js')['Cache-Control'], 'no-cache')
  assert.equal(h('/manifest.webmanifest')['Content-Type'], 'application/manifest+json')
})
