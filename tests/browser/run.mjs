// Browser tests: the real app, in a real (headless) Chromium, with the database
// swapped for fake data (tests/browser/harness). Needs Playwright, which is not
// a project dependency:   npm i --no-save playwright && npx playwright install chromium
// (or point CHROME_PATH at an installed Chrome/Chromium).   run:  npm run test:browser
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
  console.error('Playwright is not installed. Run:  npm i --no-save playwright && npx playwright install chromium\n(or set CHROME_PATH to a Chrome/Chromium binary after installing the package)')
  process.exit(2)
}

const server = await createServer({
  root: ROOT, configFile: false, plugins: [vue()], logLevel: 'error',
  resolve: { alias: [{ find: '@/lib/supabase', replacement: join(here, 'harness', 'supabase-mock.ts') }, { find: '@', replacement: join(ROOT, 'src') }] },
  server: { host: '127.0.0.1', port: 5199, strictPort: false },
})
await server.listen()
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] })

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg) } }
const section = name => console.log('▸', name)

async function open(path, { width = 375, anon = false, noladder = false, pending = false, streak = false, nonmember = false, ghost = false, ua, standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 700, ...(ua ? { userAgent: ua } : {}) })
  // Pretend the page is running as an installed app (display-mode: standalone).
  if (standalone) await ctx.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = q => /display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
      : real(q)
  })
  await ctx.addInitScript(f => {
    localStorage.setItem('rally.currentLeague', '00000000-0000-0000-0000-0000000000aa')
    for (const [k, v] of Object.entries(f)) v ? localStorage.setItem(k, '1') : localStorage.removeItem(k)
  }, { anon, noladder, pending, streak, nonmember, ghost })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push(e.message))
  await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  return p
}
const close = p => p.context().close()

try {
  // ── 1. Every page fits the screen, and shows no "Unit" ──────────────
  section('every page: no sideways scroll, nothing cut off, no unit, no errors')
  const PAGES = ['/', '/leaderboard', '/matches', '/profile', '/progress', '/player/00000000-0000-0000-0000-000000000002', '/challenge', '/referee', '/tournament']
  for (const width of [375, 320, 1280]) for (const path of PAGES) {
    const p = await open(path, { width }); const tag = `${path} @${width}`
    const r = await p.evaluate(() => {
      const iw = innerWidth
      const inScroll = el => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth) return true } return false }
      const poking = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > iw + 1 && !inScroll(el) }).length
      const clipped = [...document.querySelectorAll('body *')].filter(el => { const o = getComputedStyle(el).overflowX; return (o === 'hidden' || o === 'clip') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !/ellipsis/.test(getComputedStyle(el).textOverflow) }).length
      return { pageW: document.documentElement.scrollWidth, iw, poking, clipped, text: document.body.innerText }
    })
    ok(r.pageW <= r.iw + 1, `${tag}: page scrolls sideways (${r.pageW} > ${r.iw})`)
    ok(r.poking === 0, `${tag}: ${r.poking} element(s) poke past the screen edge`)
    ok(r.clipped === 0, `${tag}: ${r.clipped} box(es) clip their content`)
    ok(!/\bUnit\b/.test(r.text), `${tag}: the word "Unit" is still on the page`)
    ok(p.errs.length === 0, `${tag}: page errors ${p.errs.join(' | ')}`)
    await close(p)
  }

  // ── 2. The unit field is gone from the forms ────────────────────────
  section('no unit field when signing up or editing a profile')
  let p = await open('/login', { anon: true })
  await p.getByText(/join|sign up|create/i).first().click().catch(() => {}); await p.waitForTimeout(300)
  ok(await p.locator('input[name="unit"], #signup-unit').count() === 0, 'sign-up form has no unit input')
  ok(!/unit|apartment/i.test(await p.locator('body').innerText()), 'sign-up form never mentions unit or apartment')
  await close(p)
  p = await open('/profile'); await p.getByRole('button', { name: /edit profile/i }).click(); await p.waitForTimeout(200)
  ok(await p.locator('form input').count() === 1, 'edit-profile form has just the display name')
  ok(!/unit/i.test(await p.locator('form').innerText()), 'edit-profile form has no unit label')
  await close(p)

  // ── 3. "How points work" key matches the first-to-4 / full-set-to-6 rules ──
  section('how-points-work key')
  for (const width of [375, 1280]) {
    p = await open('/leaderboard', { width }); await p.locator('.points-key summary').click(); await p.waitForTimeout(200)
    const rowsTxt = await p.$$eval('.points-key-table tbody tr', trs => trs.map(t => [...t.children].map(c => c.textContent.trim())))
    const want = [['Win', '4', '16'],
      ['First to 4'], ['Lose 3–4', '3', '12'], ['Lose 2–4', '2', '8'], ['Lose 1–4', '1', '4'], ['Lose 0–4', '0', '0'],
      ['Full set to 6'], ['Lose 5–6', '3', '12'], ['Lose 3–6 to 4–6', '2', '8'], ['Lose 1–6 to 2–6', '1', '4'], ['Lose 0–6', '0', '0']]
    ok(JSON.stringify(rowsTxt) === JSON.stringify(want), `@${width}: key rows ${JSON.stringify(rowsTxt)}`)
    const notes = await p.locator('.points-key-notes').innerText()
    ok(/first to 4 games, or a full set to 6/.test(notes) && /0–4 or 0–6 loss earns nothing/.test(notes), `@${width}: notes say first to 4 or a full set to 6 / a shutout earns nothing`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `@${width}: key does not overflow`)
    await close(p)
  }

  // ── 4. Progress page states the XP rule ─────────────────────────────
  section('progress page XP line')
  p = await open('/progress'); const prog = await p.locator('body').innerText()
  ok(/win earns 16 XP/.test(prog) && /loss earns 0 to 12 XP/.test(prog.replace(/\n/g, ' ')), 'progress explains 16 XP for a win, 0 to 12 for a loss'); await close(p)

  // ── 5. Bottom tab bar ───────────────────────────────────────────────
  section('bottom tab bar')
  p = await open('/matches')
  const labels = await p.$$eval('.tabbar .tab', t => t.map(x => x.textContent.trim()))
  ok(JSON.stringify(labels) === JSON.stringify(['Leaderboard', 'Matches', 'Round Robin', 'Progress', 'Profile']), 'tab order ' + labels)
  const hrefs = await p.$$eval('.tabbar .tab', t => t.map(x => x.getAttribute('href'))); ok(JSON.stringify(hrefs) === '["/leaderboard","/matches","/tournament","/progress","/profile"]', 'tab links ' + hrefs)
  const g = await p.evaluate(() => { const bar = document.querySelector('.tabbar').getBoundingClientRect(), tabs = [...document.querySelectorAll('.tab')].map(t => t.getBoundingClientRect())
    return { atBottom: Math.abs(bar.bottom - innerHeight) < 1, full: bar.width === innerWidth, minH: Math.min(...tabs.map(t => t.height)), minW: Math.min(...tabs.map(t => t.width)), cls: document.body.className, cut: [...document.querySelectorAll('.tab-label')].filter(l => l.scrollWidth > l.clientWidth).length } })
  ok(g.atBottom && g.full, 'bar fixed to the bottom, full width'); ok(g.minH >= 44 && g.minW >= 60, `tap targets ${g.minW}x${g.minH}`); ok(g.cls.includes('has-tabbar'), 'body reserves room'); ok(g.cut === 0, 'no clipped labels')
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(150)
  const clr = await p.evaluate(() => { const c = [...document.querySelectorAll('.sc')].pop().getBoundingClientRect(); return c.bottom <= document.querySelector('.tabbar').getBoundingClientRect().top - 4 }); ok(clr, 'last card clears the bar')
  for (const [label, path] of [['Leaderboard', '/leaderboard'], ['Round Robin', '/tournament'], ['Progress', '/progress'], ['Profile', '/profile'], ['Matches', '/matches']]) {
    await p.locator('.tabbar .tab', { hasText: label }).tap(); await p.waitForTimeout(450)
    ok(new URL(p.url()).pathname === path && (await p.locator('.tab.active').allInnerTexts()).map(s => s.trim()).join() === label, `one tap to ${label}`)
  }
  // A dropdown opens a picker, not a keyboard, so the bar must stay; a box you type into hides it until you leave.
  await p.locator('select').first().focus(); await p.waitForTimeout(250); ok(await p.locator('.tabbar').isVisible(), 'a focused dropdown does NOT hide the bar')
  await p.locator('select').first().click(); await p.waitForTimeout(250); ok(await p.locator('.tabbar').isVisible(), 'an opened dropdown does NOT hide the bar')
  await p.evaluate(() => document.activeElement.blur()); await close(p)
  p = await open('/tournament', { pending: true })
  await p.locator('select').first().focus().catch(() => {}); await p.waitForTimeout(250); ok(await p.locator('.tabbar').isVisible(), 'tournament page: a focused dropdown keeps the bar')
  await p.locator('.score-input').first().focus(); await p.waitForTimeout(250); ok(!(await p.locator('.tabbar').isVisible()), 'bar hides while a score box (number input) has focus')
  await p.locator('.score-input').nth(1).focus(); await p.waitForTimeout(300); ok(!(await p.locator('.tabbar').isVisible()), 'bar stays hidden when moving from one score box to the next')
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(400); ok(await p.locator('.tabbar').isVisible(), 'bar is back after leaving the score boxes')
  await p.locator('.match-score-inputs button, .match-score-inputs .btn').first().focus(); await p.waitForTimeout(250); ok(await p.locator('.tabbar').isVisible(), 'a focused button keeps the bar'); await close(p)
  p = await open('/leaderboard', { width: 320 }); ok(await p.evaluate(() => [...document.querySelectorAll('.tab-label')].filter(l => l.scrollWidth > l.clientWidth).length === 0), '320px: labels whole'); await close(p)
  for (const [w, shown] of [[700, true], [701, false], [1280, false]]) { p = await open('/matches', { width: w }); ok((await p.locator('.tabbar').isVisible()) === shown, `@${w}: tab bar ${shown ? 'shown' : 'hidden'}`); await close(p) }
  p = await open('/leaderboard', { anon: true }); ok(JSON.stringify(await p.$$eval('.tabbar .tab', t => t.map(x => x.textContent.trim()))) === JSON.stringify(['Leaderboard', 'Matches', 'Round Robin', 'Sign in']), 'signed out: Sign in replaces Progress/Profile'); await close(p)
  p = await open('/login', { anon: true }); ok(await p.locator('.tabbar').count() === 0, 'no bar on the sign-in page'); await close(p)

  // ── 6. Red x to remove a match ──────────────────────────────────────
  section('remove-match red x')
  for (const width of [375, 1280]) {
    p = await open('/matches', { width, noladder: true })
    ok((await p.locator('.sc').count()) >= 5, `@${width}: round robin cards shown`)
    const n = await p.locator('.rm-x').count(); ok(n === await p.locator('.sc').count() && n > 0, `@${width}: one x per card (${n})`)
    ok(!(await p.getByRole('button', { name: /^remove$/i }).count()), `@${width}: old text button gone`)
    const geo = await p.evaluate(() => { const c = document.querySelector('.sc'), x = c.querySelector('.rm-x').getBoundingClientRect(), w = c.querySelector('.sc-when').getBoundingClientRect(), cr = c.getBoundingClientRect()
      return { right: x.left >= w.right - 0.5, row: Math.abs(x.top + x.height / 2 - (w.top + w.height / 2)) < 6, inside: x.right <= cr.right && x.top >= cr.top, size: Math.min(x.width, x.height), red: getComputedStyle(c.querySelector('.rm-x')).color } })
    ok(geo.right && geo.row && geo.inside, `@${width}: x sits right of the date, same row, inside the card`); ok(geo.size >= 28, `@${width}: tap size ${geo.size}`); ok(geo.red === 'rgb(224, 82, 82)', `@${width}: red ${geo.red}`)
    ok(await p.locator('.rm-confirm').count() === 0, 'no confirm panel yet')
    await p.locator('.rm-x').first().click(); ok(await p.locator('.rm-confirm').count() === 1, `@${width}: x opens the confirmation`)
    await p.locator('.rm-x').first().click(); ok(await p.locator('.rm-confirm').count() === 0, `@${width}: x again closes it`)
    await p.locator('.rm-x').nth(1).click(); await p.getByText('Cancel', { exact: true }).click(); ok(await p.locator('.rm-confirm').count() === 0, `@${width}: Cancel closes it`)
    ok((await p.evaluate(() => (window.__rpc || []).filter(r => r.name.startsWith('remove')).length)) === 0, `@${width}: nothing removed before confirming`)
    await p.locator('.rm-x').nth(2).click(); await p.getByText('Yes, remove it').click(); await p.waitForTimeout(400)
    ok((await p.evaluate(() => (window.__rpc || []).filter(r => r.name === 'remove_tournament_match').length)) === 1, `@${width}: Yes, remove it calls the remove function once`)
    ok(await p.locator('.flash-success').count() === 1, `@${width}: success notice`); ok(p.errs.length === 0, `@${width}: no errors ${p.errs}`); await close(p)
  }

  // ── 7. Profile: match lists become two-line rows on a phone ─────────
  section('profile match list on a phone')
  p = await open('/profile', { width: 375 })
  const stacked = await p.evaluate(() => { const t = document.querySelector('.table-stack-match'); if (!t) return null; const tr = t.querySelector('tbody tr'); return { display: getComputedStyle(tr).display, headHidden: getComputedStyle(t.querySelector('thead')).display === 'none', fits: t.getBoundingClientRect().right <= innerWidth } })
  ok(stacked && stacked.display === 'grid' && stacked.headHidden && stacked.fits, 'match rows are two-line grids that fit the screen ' + JSON.stringify(stacked)); await close(p)
  p = await open('/profile', { width: 1280 })
  ok(await p.evaluate(() => { const t = document.querySelector('.table-stack-match'); return !!t && getComputedStyle(t.querySelector('thead')).display !== 'none' }), 'desktop keeps the normal table with its header'); await close(p)

  // ── 8. Score entry: the boxes and the Report button follow the first-to-4 / full-set-to-6 rule ──
  section('score entry: up to 6, only a finished score (4 or 6) can be sent')
  for (const width of [375, 1280]) {
    p = await open('/tournament', { width, pending: true }); const T = `score entry @${width}`
    const boxes = await p.locator('.score-input').count()
    ok(boxes === 2, `${T}: two score boxes for the pending match (found ${boxes})`)
    if (boxes === 2) {
      ok((await p.locator('.score-input').first().getAttribute('max')) === '6', `${T}: score box max is 6`)
      const [a, b] = [p.locator('.score-input').nth(0), p.locator('.score-input').nth(1)]
      const btn = p.locator('.match-score-inputs button, .match-score-inputs .btn').first()
      for (const [x, y, legal] of [[6, 4, true], [4, 6, true], [6, 0, true], [0, 6, true], [6, 5, true], [5, 6, true], [4, 0, true], [0, 4, true], [4, 3, true], [3, 4, true], [4, 2, true], [4, 4, false], [6, 6, false], [7, 2, false], [5, 3, false], [3, 5, false], [5, 4, false], [5, 5, false], [3, 0, false]]) {
        await a.fill(String(x)); await b.fill(String(y))
        ok((await btn.isEnabled()) === legal, `${T}: ${x}-${y} ${legal ? 'can' : 'cannot'} be submitted`)
      }
      await a.fill('5'); await b.fill('3'); await p.waitForTimeout(150)
      const hint = (await p.locator('.score-hint').allInnerTexts()).join(' ')
      ok(/exactly 4 games.*exactly 6/i.test(hint), `${T}: the hint for 5-3 names both formats (got "${hint}")`)
      await a.fill('4'); await b.fill('2'); await p.waitForTimeout(150)
      ok((await p.locator('.score-hint').count()) === 0, `${T}: no hint for 4-2, a finished first-to-4 score`)
      await a.fill('6'); await b.fill('3'); await btn.click(); await p.waitForTimeout(300)
      const calls = await p.evaluate(() => window.__rpc || [])
      ok(calls.some(c => c.name === 'report_tournament_match' && c.args.p_match_id === 'tmP' && c.args.p_score_a === 6 && c.args.p_score_b === 3), `${T}: 6-3 is sent to the database for the right match (${JSON.stringify(calls.map(c => c.name))})`)
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
      ok(p.errs.length === 0, `${T}: no page errors ${p.errs.join(';')}`)
    }
    await close(p)
  }

  // ── 9. Leaderboard filters and Round Robin page order (v0.0.7.3) ──────
  section('leaderboard filters on one row; round robin leads with the season')
  for (const width of [320, 375, 1280]) {
    const T = `@${width}`
    let p = await open('/leaderboard', { width })
    ok(await p.locator('.segmented button').count() === 2, `${T}: Board is a two-way toggle`)
    ok(await p.locator('select').count() === 2, `${T}: two dropdowns left (Season, Rank by), not three`)
    const tops = await p.$$eval('.board-filters select', els => els.map(e => Math.round(e.getBoundingClientRect().top)))
    ok(tops.length === 2 && tops[0] === tops[1], `${T}: Season and Rank by share a row ${tops}`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    if (width < 700) {
      // the podium / table used to start ~455px down; the filters are now compact
      const firstRow = await p.evaluate(() => { const e = document.querySelector('main .container > div:last-child .standings, main table, main .podium, main [class*="podium"]'); return e ? Math.round(e.getBoundingClientRect().top) : -1 })
      ok(firstRow > 0 && firstRow < 400, `${T}: standings start high on the page (${firstRow}px)`)
    }
    await p.locator('.segmented button', { hasText: 'Ladder' }).click(); await p.waitForTimeout(300)
    ok((await p.locator('.segmented button.active').innerText()).trim() === 'Ladder', `${T}: choosing Ladder switches the board`)
    ok(await p.locator('select').count() === 1, `${T}: the ladder has just its Season dropdown`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    const p = await open('/tournament', { width: 375 })
    const order = await p.evaluate(() => {
      const main = document.querySelector('main'); const kids = [...main.children]
      const idx = sel => kids.findIndex(k => k.matches(sel) || k.querySelector(sel))
      return { header: idx('.page-header'), season: idx('table, .standings, [class*="podium"]'), more: idx('.page-more') }
    })
    ok(order.header === 0 && order.season > 0 && order.more > order.season, `round robin: header, then the season, then the tools at the bottom ${JSON.stringify(order)}`)
    ok(await p.locator('.page-more').getByText(/past seasons/i).count() === 1, 'past seasons is still there, in the bottom block')
    ok(await p.locator('.page-more').getByText('Player accounts').count() === 1, 'player accounts is still there for an admin, in the bottom block')
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'round robin: no sideways scroll')
    await close(p)
  }

  // ── 10. Home page sits close under the top bar (v0.0.7.4; both homes since v0.0.7.6) ──
  section('home page spacing under the top bar')
  for (const width of [375, 1280]) {
    const p = await open('/', { width })
    const gap = await p.evaluate(() => Math.round(document.querySelector('.eyebrow').getBoundingClientRect().top - document.querySelector('nav, header').getBoundingClientRect().bottom))
    ok(gap > 0 && gap <= 48, `@${width}: gap from the top bar to the first heading is ${gap}px (was 96px+)`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `@${width}: no sideways scroll`)
    await close(p)
  }

  // ── 11. Installable app (v0.0.7.5) ─────────────────────────────────────
  section('installable app: manifest, install card, offline page')
  {
    const p = await open('/', { width: 375 })
    ok(await p.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href')) === '/manifest.webmanifest', 'the page links the manifest')
    ok(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')) === '#0e1117', 'theme colour is set')
    const man = await p.evaluate(async () => { const r = await fetch('/manifest.webmanifest'); return { ok: r.ok, json: await r.json() } })
    ok(man.ok && man.json.display === 'standalone' && man.json.icons.length >= 3, 'the manifest is served and says standalone with icons')
    for (const ic of man.json.icons) {
      const st = await p.evaluate(async src => (await fetch(src)).status, ic.src)
      ok(st === 200, `icon ${ic.src} loads (${st})`)
    }
    await close(p)
  }
  {
    // Chrome-style: the browser offers to install, we show a button and replay its prompt.
    const p = await open('/profile', { width: 375 })
    ok(await p.locator('.install-card').count() === 0, 'no install card when the browser has not offered to install')
    await p.evaluate(() => {
      const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve() }
      e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e)
    })
    await p.waitForTimeout(200)
    ok(await p.locator('.install-card').isVisible(), 'install card appears once the browser offers to install')
    ok(await p.locator('.install-card button', { hasText: 'Install' }).count() === 1, 'it has an Install button')
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'install card: no sideways scroll')
    await p.locator('.install-card button', { hasText: 'Install' }).click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(300)
    ok(await p.evaluate(() => window.__prompted) === 1, 'tapping Install replays the browser prompt exactly once')
    ok(await p.locator('.install-card').count() === 0, 'the card goes away after installing')
    ok(p.errs.length === 0, `install: no page errors ${p.errs}`)
    await close(p)
  }
  {
    // iPhone Safari never sends the event: show the Share / Add to Home Screen steps.
    const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    const p = await open('/profile', { width: 375, ua: IOS })
    const t = (await p.locator('.install-card').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ')
    ok(/Share/.test(t) && /Add to Home Screen/.test(t), `iPhone sees the steps (${t})`)
    ok(await p.locator('.install-card button', { hasText: 'Install' }).count() === 0, 'iPhone: no Install button (there is nothing to replay)')
    await close(p)
    // ...and nothing once it is already running as an installed app.
    const q = await open('/profile', { width: 375, ua: IOS, standalone: true })
    ok(await q.locator('.install-card').count() === 0, 'nothing to install when already running as an app')
    await q.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e) })
    await q.waitForTimeout(200)
    ok(await q.locator('.install-card').count() === 0, 'still nothing, even if the browser offers')
    await close(q)
  }
  {
    // The service worker, on its own: serve public/ from a throwaway server, let it install,
    // then take the server away and open a page. We should get the offline page, and nothing
    // else should have been cached (no stale app, no stale data).
    const publicDir = join(ROOT, 'public')
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
    const sockets = new Set()
    const srv = createHttpServer((req, res) => {
      const url = new URL(req.url, 'http://x'); const name = url.pathname === '/' ? '/shell.html' : url.pathname
      if (name === '/shell.html') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><title>shell</title><p id="shell">app shell</p>') }
      const f = join(publicDir, name)
      if (!f.startsWith(publicDir) || !existsSync(f)) { res.statusCode = 404; return res.end('nope') }
      res.setHeader('content-type', types[name.slice(name.lastIndexOf('.'))] || 'application/octet-stream'); res.end(readFileSync(f))
    })
    srv.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)) })
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    const origin = `http://127.0.0.1:${srv.address().port}`
    const ctx = await browser.newContext({ serviceWorkers: 'allow' }); const p = await ctx.newPage()
    await p.goto(origin + '/'); 
    const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; return !!r.active || !!r.installing || !!r.waiting })
    ok(reg, 'the service worker installs')
    await p.waitForFunction(() => navigator.serviceWorker.controller || true); await p.reload(); await p.waitForTimeout(300)
    ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'it takes control of the page')
    const cached = await p.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); return out })
    ok(JSON.stringify(cached) === JSON.stringify({ 'rally-offline-v1': ['/offline.html'] }), `only the offline page is cached ${JSON.stringify(cached)}`)
    for (const c of sockets) c.destroy(); await new Promise(r => srv.close(r))
    await p.goto(origin + '/leaderboard', { waitUntil: 'domcontentloaded' }).catch(() => {})
    ok(/You're offline/.test(await p.locator('h1').innerText({ timeout: 3000 }).catch(() => '')), 'with the server gone, opening a page shows the offline page')
    ok((await p.locator('button', { hasText: 'Try again' }).count()) === 1, 'and it offers Try again')
    await ctx.close()
  }

  // ── 12. Home page redesign (v0.0.7.6): a day view for players, a short welcome for visitors ──
  section('home: player dashboard and visitor welcome')
  for (const width of [320, 375, 1280]) {
    const T = `@${width}`
    const p = await open('/', { width })
    ok(/^Hi, \S+/.test((await p.locator('h1').innerText({ timeout: 3000 }).catch(() => '')).trim()), `${T}: a signed-in player is greeted by name`)
    ok(await p.locator('.welcome').count() === 0, `${T}: a signed-in player never sees the visitor page`)
    const stats = await p.$$eval('[data-test="season-card"] .stat-val', els => els.map(e => e.textContent.trim()))
    ok(stats.length === 3 && /^#\d+$/.test(stats[0]) && /^\d+$/.test(stats[1]) && /^\d+–\d+$/.test(stats[2]), `${T}: season card shows rank, points and record ${JSON.stringify(stats)}`)
    const chips = await p.$$eval('[data-test="week-card"] .chip', els => els.map(e => e.textContent.trim()))
    ok(chips.length > 0 && chips.every(c => /^(To play|Court \d+|Playing now|Won \d+–\d+|Lost \d+–\d+)$/.test(c)), `${T}: this week's matches each carry a status ${JSON.stringify(chips)}`)
    ok(/level \d+/i.test(await p.locator('[data-test="level-card"]').innerText({ timeout: 3000 }).catch(() => '')), `${T}: level card shows the level`)
    ok(await p.locator('.actions a', { hasText: 'Challenge someone' }).count() === 1 && await p.locator('.actions a', { hasText: 'Round Robin' }).count() === 1, `${T}: the two quick actions are there`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    if (width === 1280) {
      const cols = await p.evaluate(() => ['[data-test="season-card"]', '[data-test="week-card"]'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().left)))
      ok(cols[1] > cols[0] + 200, `${T}: on a wide screen this week's matches sit in a second column ${cols}`)
    }
    await close(p)
  }
  for (const width of [320, 375, 1280]) {
    const T = `@${width}`
    const p = await open('/', { width, anon: true })
    ok(await p.locator('.welcome').count() === 1 && await p.locator('[data-test="season-card"]').count() === 0, `${T}: a visitor sees the welcome, not the dashboard`)
    ok(await p.locator('.welcome-cta a', { hasText: 'Join the league' }).count() === 1 && await p.locator('.welcome-cta a', { hasText: 'View standings' }).count() === 1, `${T}: visitor has Join the league and View standings`)
    ok(await p.locator('.steps li').count() === 3, `${T}: three short steps explain how it works`)
    const tops = await p.$$eval('.welcome-cta a', els => els.map(e => Math.round(e.getBoundingClientRect().top)))
    ok(width > 600 ? true : tops[0] === tops[1], `${T}: the two buttons share a row on a phone ${tops}`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }

  // ── 13. Home: week progress bar, win streak, head to head (v0.0.7.7) ──
  section('home: week progress bar, win streak, head to head')
  {
    // Default fixtures: this week (week 2) has 3 matches, all played; the signed-in player's results run
    // ... L W L W L W (oldest to newest), so the streak is only 1 and must not be shown.
    const p = await open('/', { width: 375 })
    ok(await p.locator('[data-test="week-progress"]').getAttribute('aria-valuenow') === '100', 'bar: 3 of 3 played is 100%')
    ok(/Week 2 · 3 of 3 matches played/.test(await p.locator('[data-test="season-card"]').innerText()), 'week label says 3 of 3 played')
    ok(/6 matches this season/.test(await p.locator('[data-test="season-card"]').innerText()), 'season total is shown as a number')
    ok(await p.locator('[data-test="streak"]').count() === 0, 'a streak of 1 is not shown')
    const metas = await p.$$eval('[data-test="week-card"] .match-meta', els => els.map(e => e.textContent.trim()))
    ok(metas.includes('Challenge match'), `a challenge match is labelled as one ${JSON.stringify(metas)}`)
    ok(!metas.some(t => /this season/.test(t)), 'finished matches show no head to head')
    await close(p)
  }
  for (const width of [320, 375, 1280]) {
    const T = `@${width}`
    // pending: an unreported match against a player you beat 6-2 earlier in singles (their doubles match does not count).
    // streak: two more recent wins, so the run is three. Week 2 then has 6 matches, 5 played.
    const p = await open('/', { width, pending: true, streak: true })
    ok(await p.locator('[data-test="week-progress"]').getAttribute('aria-valuenow') === '83', `${T}: bar: 5 of 6 played is 83%`)
    ok(/Week 2 · 5 of 6 matches played/.test(await p.locator('[data-test="season-card"]').innerText()), `${T}: week label says 5 of 6 played`)
    ok(/8 matches this season/.test(await p.locator('[data-test="season-card"]').innerText()), `${T}: season total counts the new wins`)
    ok((await p.locator('[data-test="streak"]').innerText({ timeout: 3000 }).catch(() => '')).includes('3-win streak'), `${T}: a three-win streak is shown`)
    const row = (await p.locator('[data-test="week-card"] .match-row', { hasText: 'To play' }).innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ')
    ok(/You lead 1–0 this season/.test(row), `${T}: the upcoming match shows your record against that player (${row})`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }

  // ── 14. Install card: Android steps, "Not now" for 30 days (v0.0.7.8) ──
  section('install card: android steps, hide for 30 days')
  {
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    const card = p => p.locator('.install-card')
    const p = await open('/profile', { width: 375, ua: ANDROID })
    // No offer from the browser (say, after a cancelled prompt): the menu steps are shown, with no Install button.
    const t = (await card(p).innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ')
    ok(/Install app/.test(t) && /Add to Home screen/.test(t), `Android with no offer sees the menu steps (${t})`)
    ok(await p.locator('.install-card button', { hasText: 'Install' }).count() === 0, 'and no Install button, because there is nothing to replay')
    // The browser then offers: the Install button replaces the steps, and the menu is still mentioned.
    await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e) })
    await p.waitForTimeout(200)
    ok(await p.locator('.install-card button', { hasText: 'Install' }).count() === 1, 'once the browser offers, there is an Install button')
    ok(/No button later\? Use your browser's menu/.test(await card(p).innerText()), 'and the card still says where the menu option is')
    // "Not now" hides it, and it stays hidden after a reload.
    await p.locator('.install-card button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {})
    await p.waitForTimeout(200)
    ok(await card(p).count() === 0, '"Not now" hides the card')
    const until = await p.evaluate(() => Number(localStorage.getItem('rally.installHiddenUntil')))
    const days = (until - Date.now()) / 864e5
    ok(days > 29 && days <= 30, `it is hidden for 30 days (${days.toFixed(1)})`)
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400)
    ok(await card(p).count() === 0, 'still hidden after a reload')
    // Once the 30 days are up it comes back, so hiding it can never block a later reinstall.
    await p.evaluate(() => localStorage.setItem('rally.installHiddenUntil', String(Date.now() - 1000)))
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400)
    ok(await card(p).count() === 1, 'back again once the 30 days have passed')
    ok(p.errs.length === 0, `no page errors ${p.errs}`)
    await close(p)
    // iPhone has "Not now" too, and a desktop browser with no offer still shows nothing.
    const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    const q = await open('/profile', { width: 375, ua: IOS })
    ok(await q.locator('.install-card button', { hasText: 'Not now' }).count() === 1, 'iPhone card has Not now')
    await close(q)
    const d = await open('/profile', { width: 1280 })
    ok(await card(d).count() === 0, 'a desktop browser with no install offer shows nothing')
    await close(d)
  }

  // ── 15. New accounts that have not joined a league (v0.0.7.9) ──
  section('not in a league yet: join card instead of a half-working app')
  for (const width of [320, 375, 1280]) {
    const T = `@${width}`
    const card = p => p.locator('[data-test="join-card"]')
    // Home: the join card, no dashboard, and joining turns it into the real thing
    let p = await open('/', { width, nonmember: true })
    ok((await card(p).innerText({ timeout: 3000 }).catch(() => '')).includes('Join Riverside Tennis Club'), `${T}: Home offers to join the league by name`)
    ok(await p.locator('[data-test="season-card"]').count() === 0, `${T}: Home does not show a dashboard to a non-member`)
    ok(/once you've joined/.test(await p.locator('main').innerText()), `${T}: Home says what joining unlocks`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    await p.locator('[data-test="join-card"] button', { hasText: 'Join Riverside Tennis Club' }).click({ timeout: 3000 }).catch(() => {})
    await p.waitForTimeout(600)
    const ins = await p.evaluate(() => (window.__inserts || []).filter(i => i.table === 'players'))
    ok(ins.length === 1 && ins[0].payload.profile_id === '00000000-0000-0000-0000-000000000099' && ins[0].payload.league_id === '00000000-0000-0000-0000-0000000000aa', `${T}: Join saves the person's own player record (${JSON.stringify(ins)})`)
    ok(await card(p).count() === 0 && await p.locator('[data-test="season-card"]').count() === 1, `${T}: after joining the card is gone and the dashboard appears`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
    // Profile: the card replaces "use the league icon in the nav"
    p = await open('/profile', { width, nonmember: true })
    ok(await card(p).count() === 1 && !/league icon in the nav/.test(await p.locator('main').innerText()), `${T}: Profile offers the join button, not a hunt through the menu`)
    await close(p)
    // Challenge: no opponent list for someone who cannot actually play
    p = await open('/challenge', { width, nonmember: true })
    ok(await card(p).count() === 1 && await p.getByText('Pick an opponent').count() === 0, `${T}: Challenge asks a non-member to join first`)
    await close(p)
    // Leaderboard: the standings are still there to look at, with the card above
    p = await open('/leaderboard', { width, nonmember: true })
    ok(await card(p).count() === 1 && await p.locator('.board-filters').count() === 1, `${T}: Leaderboard shows the join card above the standings`)
    await close(p)
    // Members never see it
    for (const path of ['/', '/profile', '/challenge', '/leaderboard']) {
      p = await open(path, { width })
      ok(await card(p).count() === 0, `${T}: a member never sees the join card on ${path}`)
      await close(p)
    }
  }
  {
    // The stuck-spinner bug: reporting a result against someone who never joined must explain itself,
    // stop spinning, and save nothing.
    const p = await open('/matches', { width: 375, ghost: true })
    await p.getByText('view ladder').first().click({ timeout: 3000 }).catch(() => {})       // the page opens on Round robin
    await p.waitForTimeout(300)
    await p.getByRole('button', { name: 'Submit result' }).first().click({ timeout: 3000 }).catch(() => {})
    const inputs = p.locator('.score-input')
    await inputs.nth(0).fill('11', { timeout: 3000 }).catch(() => {}); await inputs.nth(1).fill('8', { timeout: 3000 }).catch(() => {})
    await p.locator('.modal-footer .btn-primary').click({ timeout: 3000 }).catch(() => {})
    await p.waitForTimeout(600)
    const err = (await p.locator('.backdrop .flash-error').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ')
    ok(/Gwen Ghost hasn't joined this league yet/.test(err), `the result window says who has not joined (${err})`)
    ok(await p.locator('.modal-footer .spinner').count() === 0, 'the submit button stops spinning')
    ok(await p.locator('.modal-footer .btn-primary').isEnabled({ timeout: 3000 }).catch(() => false), 'and can be used again')
    const saved = await p.evaluate(() => (window.__updates || []).filter(u => u.table === 'matches'))
    ok(saved.length === 0, `nothing was saved, so no half-reported match is left behind (${JSON.stringify(saved)})`)
    await p.locator('.modal-footer .btn-ghost').click({ timeout: 3000 }).catch(() => {})
    ok(await p.locator('.modal-footer').count() === 0, 'Cancel still closes the window')
    ok(p.errs.length === 0, `no uncaught errors ${p.errs}`)
    await close(p)
  }
} finally {
  await browser.close(); await server.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
