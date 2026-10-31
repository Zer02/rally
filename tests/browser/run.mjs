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

async function open(path, { noRemovalFocusout = false, width = 375, anon = false, noladder = false, pending = false, streak = false, nonmember = false, ghost = false, crowd = false, above = false, farabove = false, notadmin = false, bracketerr = false, elo = false, pingpong = false, norr = false, noleague = false, byeweek = false, twoleagues = false, ua, standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 700, ...(ua ? { userAgent: ua } : {}) })
  // Pretend the page is running as an installed app (display-mode: standalone).
  if (standalone) await ctx.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = q => /display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
      : real(q)
  })
  // Pretend to be a phone browser that sends no focusout/blur when a focused box is removed from the page (the cause of the vanishing bar, v0.0.9.3).
  if (noRemovalFocusout) await ctx.addInitScript(() => {
    let removing = 0; const rc = Node.prototype.removeChild
    Node.prototype.removeChild = function (c) { removing++; try { return rc.call(this, c) } finally { removing-- } }
    const rm = Element.prototype.remove; Element.prototype.remove = function () { removing++; try { return rm.call(this) } finally { removing-- } }
    const stop = e => { if (removing) e.stopImmediatePropagation() }
    window.addEventListener('focusout', stop, true); window.addEventListener('blur', stop, true)
  })
  await ctx.addInitScript(f => {
    localStorage.setItem('rally.currentLeague', '00000000-0000-0000-0000-0000000000aa')
    for (const [k, v] of Object.entries(f)) v ? localStorage.setItem(k, '1') : localStorage.removeItem(k)
  }, { anon, noladder, pending, streak, nonmember, ghost, crowd, above, farabove, notadmin, bracketerr, elo, pingpong, norr, noleague, byeweek, twoleagues })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push(e.message))
  await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  return p
}
const close = p => p.context().close()

try {
  // ── 1. Every page fits the screen, and shows no "Unit" ──────────────
  section('every page: no sideways scroll, nothing cut off, no unit, no errors')
  const PAGES = ['/', '/leaderboard', '/matches', '/profile', '/progress', '/player/00000000-0000-0000-0000-000000000002', '/challenge', '/referee', '/tournament', '/tournaments', '/tournaments/bk1', '/tournaments/bk2']
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
    // v0.0.9.1: the signed-in greeting sits inside a picture band, so measure to the top of the band (the heading is inside it)
    const gap = await p.evaluate(() => Math.round((document.querySelector('[data-test="home-scene"]') ?? document.querySelector('.eyebrow')).getBoundingClientRect().top - document.querySelector('nav, header').getBoundingClientRect().bottom))
    ok(gap > 0 && gap <= 48, `@${width}: gap from the top bar to the first heading (or the picture band it sits in) is ${gap}px (was 96px+)`)
    const inBand = await p.evaluate(() => { const b = document.querySelector('[data-test="home-scene"]')?.getBoundingClientRect(), g = document.querySelector('[data-test="home-scene"] h1')?.getBoundingClientRect(); return !!b && !!g && g.top >= b.top && g.bottom <= b.bottom })
    ok(inBand, `@${width}: the greeting sits inside the picture band`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `@${width}: no sideways scroll`)
    await close(p)
  }

  // ── 11. Installable app (v0.0.7.5) ─────────────────────────────────────
  section('installable app: manifest, install card, offline page')
  {
    const p = await open('/', { width: 375 })
    ok(await p.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href')) === '/manifest.webmanifest', 'the page links the manifest')
    ok(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')) === '#070d17', 'theme colour is set (the new navy, v0.0.8.6)')
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
    ok(await p.locator('.steps li').count() === 4, `${T}: four short items say what Rally does`)
    const boxes = await p.$$eval('.welcome-cta a', els => els.map(e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) } }))
    ok(width > 800 ? boxes[0].top === boxes[1].top : (boxes[1].top > boxes[0].top && boxes.every(b => b.w >= width * 0.7)), `${T}: buttons share a row on a wide screen and stack full width on a phone ${JSON.stringify(boxes)}`)
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

  section('challenge: the send bar stays on screen, however long the list')
  for (const [width, height] of [[375, 667], [320, 568], [1280, 800]]) {
    const T = `${width}px`
    const p = await open('/challenge', { width, crowd: true })
    await p.setViewportSize({ width, height })
    const rows = p.locator('.opponent-row'), bar = p.locator('.send-bar')
    ok(await rows.count() === 29, `${T}: the long list is there (${await rows.count()} players)`)
    ok(await p.evaluate(() => document.documentElement.scrollHeight) > height * 3, `${T}: the list is several screens tall`)
    ok(await bar.count() === 0, `${T}: no bar until someone is picked`)
    // pick someone at the very top of a long list
    await rows.nth(0).click(); await p.waitForTimeout(150)
    ok(await bar.count() === 1, `${T}: picking someone shows the send bar`)
    const box = await bar.boundingBox(), tab = p.locator('.tabbar')
    ok(box && box.y >= 0 && box.y + box.height <= height, `${T}: the whole bar is inside the screen, with no scrolling (${JSON.stringify(box)})`)
    ok(await p.evaluate(() => window.scrollY) === 0, `${T}: the page did not have to scroll`)
    if (width < 700 && await tab.count() && await tab.isVisible()) {
      const tb = await tab.boundingBox(); ok(box.y + box.height <= tb.y + 0.5, `${T}: the bar sits above the tab bar (${box.y + box.height} vs ${tb.y})`)
    }
    const picked = (await rows.nth(0).locator('.opponent-name').innerText()).trim()
    ok((await bar.locator('.send-name').innerText()).trim() === picked, `${T}: the bar names who was tapped (${picked})`)
    ok(/Win\s*\+\d+/.test(await bar.innerText()) && /Loss\s*-?\d+/.test(await bar.innerText().then(t => t.replace('\u2212', '-'))), `${T}: the bar shows points for a win and a loss`)
    ok(await bar.locator('.quality').count() === 1, `${T}: and the match quality`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${T}: nothing sticks out sideways`)
    // scroll away and pick another from the middle: the bar is still reachable
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2)); await p.waitForTimeout(150)
    const mid = rows.nth(14); await mid.scrollIntoViewIfNeeded()
    const midName = (await mid.locator('.opponent-name').innerText()).trim()
    await mid.click(); await p.waitForTimeout(150)
    const b2 = await bar.boundingBox()
    ok(b2 && b2.y >= 0 && b2.y + b2.height <= height, `${T}: mid-list, the bar is still on screen`)
    ok(await p.locator('.opponent-row.selected').count() === 1, `${T}: exactly one player is marked`)
    ok((await bar.locator('.send-name').innerText()).trim() === (await mid.locator('.opponent-name').innerText()).trim(), `${T}: the bar follows the new pick`)
    // at the very end of the list the bar settles under it instead of covering the last player
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(150)
    const last = await rows.nth(28).boundingBox(), b3 = await bar.boundingBox()
    ok(b3.y >= last.y + last.height - 1, `${T}: at the end of the list the bar does not hide the last player`)
    // sending goes to the right person
    await p.evaluate(() => { window.__inserts = [] })
    await bar.locator('.send-btn').click(); await p.waitForTimeout(300)
    const ins = await p.evaluate(() => window.__inserts || [])
    ok(ins.length === 1 && ins[0].table === 'matches' && ins[0].payload.status === 'pending' && /0000000001/.test(ins[0].payload.opponent_id), `${T}: Send challenge challenges the picked player ${JSON.stringify(ins)}`)
    ok((await p.locator('.flash-success').innerText()).includes(`Challenge sent to ${midName}`) && await bar.count() === 0, `${T}: confirmation shown, bar gone`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    // tapping the picked player again un-picks them; the keyboard works too; a stale ?opponent= shows no bar
    let p = await open('/challenge', { width: 375, crowd: true })
    const rows = p.locator('.opponent-row')
    await rows.nth(2).click(); await rows.nth(2).click(); await p.waitForTimeout(100)
    ok(await p.locator('.send-bar').count() === 0, 'tapping the same player again clears the pick and the bar')
    await rows.nth(3).focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(100)
    ok(await p.locator('.send-bar').count() === 1 && await rows.nth(3).getAttribute('aria-pressed') === 'true', 'the keyboard can pick a player (Enter)')
    await close(p)
    p = await open('/challenge?opponent=00000000-0000-0000-0000-0000000000ff', { width: 375 })
    ok(await p.locator('.send-bar').count() === 0 && await p.locator('.opponent-row').count() === 5, 'an ?opponent= that is not in this league picks nobody')
    await close(p)
    p = await open('/challenge?opponent=00000000-0000-0000-0000-000000000003', { width: 375 })
    ok(await p.locator('.send-bar .send-name').innerText() === 'Cat', 'a link from a player page (?opponent=) opens with that player picked')
    await close(p)
  }

  section('progress: the rating-aware weekly quests')
  for (const [width, label, opts, want, hide] of [
    [375, 'top of the league (default)', {},
      ['Fair Fight or Mentor', 'Be the Challenger', 'Show up', 'Double header'], ['Punch Up', 'Reach']],
    [375, 'one player 70 above', { above: true },
      ['Punch Up', 'Be the Challenger', 'Show up', 'Double header'], ['Reach', 'Fair Fight or Mentor']],
    [375, 'one player 150 above', { above: true, farabove: true },
      ['Punch Up', 'Reach', 'Be the Challenger', 'Show up', 'Double header'], ['Fair Fight or Mentor']],
    [1280, 'one player 150 above, desktop', { farabove: true },
      ['Punch Up', 'Reach', 'Be the Challenger'], ['Fair Fight or Mentor']],
  ]) {
    const p = await open('/progress', { width, ...opts })
    await p.waitForSelector('.quest', { timeout: 8000 })
    const titles = await p.$$eval('.quest .quest-title', e => e.map(x => x.textContent.trim()))
    for (const w of want) ok(titles.includes(w), `${label}: shows "${w}" (${titles.join(', ')})`)
    for (const h of hide) ok(!titles.includes(h), `${label}: does not show "${h}"`)
    const xps = await p.$$eval('.quest', e => Object.fromEntries(e.map(q => [q.querySelector('.quest-title').textContent.trim(), q.querySelector('.quest-xp').textContent.trim()])))
    if (titles.includes('Punch Up')) ok(xps['Punch Up'] === '+25 XP', `${label}: Punch Up pays 25 (${xps['Punch Up']})`)
    if (titles.includes('Fair Fight or Mentor')) ok(xps['Fair Fight or Mentor'] === '+25 XP', `${label}: Fair Fight or Mentor pays 25`)
    if (titles.includes('Reach')) ok(xps['Reach'] === '+40 XP', `${label}: Reach pays 40 (${xps['Reach']})`)
    ok(xps['Be the Challenger'] === '+20 XP', `${label}: Be the Challenger pays 20 (${xps['Be the Challenger']})`)
    const desc = await p.locator('.quest', { hasText: titles.includes('Punch Up') ? 'Punch Up' : 'Fair Fight' }).locator('.quest-desc').innerText()
    ok(titles.includes('Punch Up') ? /rated above you/.test(desc) : /within 100 points/.test(desc) && /below you/.test(desc), `${label}: wording matches (${desc})`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: nothing sticks out sideways`)
    ok(p.errs.length === 0, `${label}: no page errors ${p.errs}`)
    await close(p)
  }

  section('season pass: opens from the level card, and every screen shows the season level')
  const PASS_AT = [0, 100, 250, 425, 600, 750, 900, 1075, 1250, 1400]
  const levelFor = xp => PASS_AT.filter(t => xp >= t).length
  for (const [width, height] of [[375, 667], [320, 568], [1280, 800]]) {
    const T = `${width}px`
    const p = await open('/progress', { width })
    p.setDefaultTimeout(5000)   // a broken pass should fail quickly, not hang
    await p.setViewportSize({ width, height })
    await p.waitForSelector('[data-test=level-open]')
    const pass = Number((await p.locator('.level-xp').innerText()).replace(/\D/g, ''))
    const life = Number((await p.locator('.level-xp-life').innerText()).replace(/\D/g, ''))
    ok(life > 0 && pass === Math.floor(life * 0.4), `${T}: the big number is the season's XP (${pass}) and the lifetime total sits beside it (${life})`)
    const lvl = levelFor(pass)
    ok(new RegExp(`level ${lvl}\\b`, 'i').test(await p.locator('.level-eyebrow').innerText()), `${T}: the level shown is the season level, ${lvl} (not the lifetime level ${levelFor(life)})`)
    ok(/repeat\s+games against the same player/.test((await p.locator('.play-xp-rule').innerText()).replace(/\n/g, ' ')), `${T}: the page says repeat games earn less`)
    ok(await p.locator('[role=dialog]').count() === 0, `${T}: the pass is closed to start with`)

    await p.locator('[data-test=level-open]').click(); await p.waitForTimeout(250)
    const sheet = p.locator('[role=dialog]')
    ok(await sheet.count() === 1, `${T}: tapping the level opens the season pass`)
    ok(await p.locator('.pass-level').count() === 10, `${T}: all ten levels are listed`)
    ok(await p.locator('.pass-level.current').count() === 1 && await p.locator('.pass-level.current').getAttribute('data-level') === String(lvl), `${T}: your level (${lvl}) is the one marked`)
    ok(await p.locator('.pass-level.reached').count() === lvl - 1 && await p.locator('.pass-level.locked').count() === 10 - lvl, `${T}: ${lvl - 1} done, ${10 - lvl} still to come`)
    const xps = await p.$$eval('.pass-level', e => e.map(x => Number(x.querySelector('.pass-xp').textContent.replace(/\D/g, ''))))
    ok(JSON.stringify(xps) === JSON.stringify(PASS_AT), `${T}: each level shows what it takes (${xps})`)
    const head = await p.locator('.pass-sub').innerText()
    ok(head.includes(`${pass} XP this season`) && head.includes(`${life} XP lifetime`), `${T}: the pass shows season and lifetime XP (${head})`)
    const nextAt = PASS_AT[lvl]   // XP of the next level
    ok(lvl === 10 || (await p.locator('.pass-level.current .pass-note').innerText()).includes(`${nextAt - pass} XP to`), `${T}: your row says how far to the next level`)
    ok(lvl === 10 || (await p.locator('.pass-level.locked .pass-note').first().innerText()).includes(`${nextAt - pass} XP to go`), `${T}: locked levels say how many XP to go`)
    ok(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Close the season pass', `${T}: focus starts on the close button`)
    ok(await p.evaluate(() => getComputedStyle(document.body).overflow) === 'hidden', `${T}: the page behind does not scroll while it is open`)
    const box = await sheet.boundingBox()
    ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5, `${T}: the pass fits the screen ${JSON.stringify(box)}`)
    const inView = await p.evaluate(() => { const s = document.querySelector('[role=dialog]').getBoundingClientRect(), c = document.querySelector('.pass-level.current').getBoundingClientRect(); return c.top >= s.top - 1 && c.bottom <= s.bottom + 1 })
    ok(inView, `${T}: your own level is scrolled into view`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${T}: nothing sticks out sideways`)

    await p.keyboard.press('Escape'); await p.waitForTimeout(150)
    ok(await sheet.count() === 0, `${T}: Escape closes it`)
    ok(await p.evaluate(() => document.activeElement?.getAttribute('data-test')) === 'level-open', `${T}: focus goes back to the level card`)
    ok(await p.evaluate(() => getComputedStyle(document.body).overflow) !== 'hidden', `${T}: the page scrolls again`)
    await p.keyboard.press('Enter'); await p.waitForTimeout(150)
    ok(await sheet.count() === 1, `${T}: Enter on the level card opens it from the keyboard`)
    await p.locator('.pass-close').click(); await p.waitForTimeout(150)
    ok(await sheet.count() === 0, `${T}: the close button closes it`)
    await p.locator('[data-test=level-open]').click(); await p.waitForTimeout(150)
    await p.mouse.click(2, 2); await p.waitForTimeout(150)
    ok(await sheet.count() === 0, `${T}: tapping outside closes it`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    // the other places a level is shown follow the season pass, and the profile keeps the lifetime total
    let p = await open('/progress', { width: 375 }); await p.waitForSelector('.level-xp')
    const pass = Number((await p.locator('.level-xp').innerText()).replace(/\D/g, '')), life = Number((await p.locator('.level-xp-life').innerText()).replace(/\D/g, ''))
    await close(p)
    p = await open('/', { width: 375 }); await p.waitForSelector('[data-test=level-card]')
    const home = await p.locator('[data-test=level-card]').innerText()
    ok(home.includes(`${pass} XP`) && new RegExp(`level ${levelFor(pass)}\\b`, 'i').test(home) && !home.includes(`${life} XP`), `home: the level card shows the season pass (${home.replace(/\n/g, ' ')})`)
    await close(p)
    p = await open('/profile', { width: 375 }); await p.waitForSelector('[data-test=lifetime-xp]')
    ok((await p.locator('[data-test=lifetime-xp]').innerText()).includes(`${life} XP lifetime`), 'profile: lifetime XP is kept on the profile')
    ok((await p.locator('.level-badge').first().innerText()).includes(`Lv ${levelFor(pass)}`), `profile: the level badge is the season level (${levelFor(pass)})`)
    await close(p)
  }

  // ── 16. Tournaments (v0.0.8.5): list, create panel, bracket, entering and correcting results ──
  section('tournaments: list and create panel')
  const rpcs = pg => pg.evaluate(() => window.__rpc || [])
  const lastRpc = async (pg, name) => (await rpcs(pg)).filter(r => r.name === name).pop()
  for (const width of [375, 1280]) {
    const T = `tournaments @${width}`
    let p = await open('/tournaments', { width })
    ok(await p.locator('[data-testid=tournament-list] a').count() === 2, `${T}: both events are listed`)
    const listTxt = await p.locator('[data-testid=tournament-list]').innerText()
    ok(/Autumn Open Championship Knockout/.test(listTxt) && /in progress/i.test(listTxt) && /finished/i.test(listTxt) && /8-slot knockout/.test(listTxt), `${T}: names, sizes and status show (${listTxt.replace(/\n/g, ' | ')})`)
    ok(await p.locator('[data-testid=create-panel]').count() === 1, `${T}: an admin sees the create panel`)
    ok(await p.getByRole('button', { name: 'Preview draw' }).isDisabled() && await p.getByRole('button', { name: 'Create tournament' }).isDisabled(), `${T}: with nobody picked, preview and create are off`)
    await p.locator('.t-check').first().click()
    ok(/at least 2/.test(await p.locator('[data-testid=create-panel]').innerText()), `${T}: one player gives the "at least 2" reason`)
    ok(await p.getByRole('button', { name: 'Preview draw' }).isDisabled(), `${T}: one player is not enough to preview`)
    await p.getByRole('button', { name: 'All', exact: true }).click()
    ok(await p.getByRole('button', { name: 'Preview draw' }).isEnabled(), `${T}: six players can be previewed`)
    ok(await p.getByRole('button', { name: 'Create tournament' }).isDisabled(), `${T}: but create still needs a name`)
    await p.locator('#t-name').fill('Club Open')
    await p.getByRole('button', { name: 'Preview draw' }).click(); await p.waitForTimeout(300)
    const call = await lastRpc(p, 'preview_bracket_seeds')
    ok(call && call.args.p_seeding === 'ladder' && call.args.p_profile_ids.length === 6 && call.args.p_league_id === '00000000-0000-0000-0000-0000000000aa', `${T}: preview asked for the ladder draw of 6 in this league (${JSON.stringify(call)})`)
    const prev = await p.locator('[data-testid=preview]').innerText()
    ok(/8-slot bracket, 2 byes/.test(prev), `${T}: preview says 8 slots and 2 byes (${prev.replace(/\n/g, ' ')})`)
    const seedNames = await p.$$eval('.t-seeds li', lis => lis.map(l => l.querySelector('.t-seed-name').textContent.trim()))
    ok(JSON.stringify(seedNames) === JSON.stringify(['Alexandra Rivera-Montgomery', 'Bartholomew Nakamura', 'Cat', 'Dmitri Volkov-Santos', 'Eloise Fairweather', 'Finn']), `${T}: seeds in rating order ${seedNames}`)
    ok(JSON.stringify(await p.$$eval('.t-seeds li', lis => lis.map(l => !!l.querySelector('.t-seed-bye')))) === JSON.stringify([true, true, false, false, false, false]), `${T}: only seeds 1 and 2 show a bye`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: preview does not overflow`)
    await p.locator('#t-seeding').selectOption('round_robin'); await p.waitForTimeout(150)
    ok(await p.locator('[data-testid=preview]').count() === 0, `${T}: changing the seeding basis clears the old preview`)
    await p.locator('#t-seeding').selectOption('ladder')
    await p.getByRole('button', { name: 'Create tournament' }).click(); await p.waitForTimeout(500)
    const made = await lastRpc(p, 'create_bracket_event')
    ok(made && made.args.p_name === 'Club Open' && made.args.p_seeding === 'ladder' && made.args.p_profile_ids.length === 6, `${T}: create sent the name, basis and six players (${JSON.stringify(made)})`)
    ok(new URL(p.url()).pathname === '/tournaments/bk1', `${T}: and went to the new bracket (${p.url()})`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    const p = await open('/tournaments', { width: 1280 })
    const href = await p.locator('.nav-link', { hasText: 'Tournaments' }).getAttribute('href')
    ok(href === '/tournaments', `desktop nav has a Tournaments link (${href})`)
    await close(p)
    const q = await open('/tournaments', { width: 375 })
    await q.locator('.nav-burger, [aria-label*="enu"]').first().click().catch(() => {}); await q.waitForTimeout(200)
    ok(await q.locator('.nav-drop-link', { hasText: 'Tournaments' }).count() === 1, 'the phone menu has a Tournaments link')
    await close(q)
  }

  section('tournaments: players see the bracket but cannot change it')
  for (const path of ['/tournaments', '/tournaments/bk1']) {
    const p = await open(path, { width: 375, notadmin: true })
    ok(await p.locator('[data-testid=create-panel]').count() === 0, `${path}: no create panel for a player`)
    ok(await p.locator('.b-match.is-click').count() === 0, `${path}: no match can be tapped`)
    ok(await p.getByRole('button', { name: /delete tournament/i }).count() === 0, `${path}: no delete button`)
    ok(await p.locator('[data-testid=score-panel]').count() === 0, `${path}: no score panel`)
    if (path.endsWith('bk1')) ok(await p.locator('[data-testid=bracket]').count() === 1, 'a player still sees the bracket')
    await close(p)
  }

  section('tournaments: the bracket')
  for (const width of [375, 1280]) {
    const T = `bracket @${width}`
    const p = await open('/tournaments/bk1', { width })
    const titles = await p.$$eval('.b-round-title', hs => hs.map(h => h.textContent.trim()))
    ok(JSON.stringify(titles) === JSON.stringify(['Quarterfinals', 'Semifinals', 'Final']), `${T}: round headers ${titles}`)
    ok(await p.locator('.b-round').nth(0).locator('.b-match').count() === 4 && await p.locator('.b-round').nth(2).locator('.b-match').count() === 1, `${T}: 4 / 2 / 1 matches`)
    const ht = await p.$$eval('.b-round-title', hs => hs.map(h => Math.round(h.getBoundingClientRect().top)))
    ok(new Set(ht).size === 1, `${T}: round headers line up along the top (${ht})`)
    ok(/\(1\)\s*Alexandra/.test((await p.locator('[data-match="1-1"]').innerText()).replace(/\n/g, ' ')), `${T}: seeds show in brackets, seed 1 first`)
    ok(await p.locator('[data-match="1-1"]').innerText().then(t => /bye/i.test(t)), `${T}: the bye is labelled`)
    ok(await p.locator('.b-row.is-loser').count() === 1 && await p.locator('.b-row.is-winner').count() === 1, `${T}: one loser and one winner so far`)
    const loser = await p.locator('.b-row.is-loser').evaluate(el => { const n = getComputedStyle(el.querySelector('.b-name')); return { deco: n.textDecorationLine, col: getComputedStyle(el).color, txt: el.innerText.replace(/\n/g, ' ') } })
    ok(loser.deco === 'line-through' && loser.col === 'rgb(224, 82, 82)' && /Eloise/.test(loser.txt), `${T}: the loser is struck through in red (${JSON.stringify(loser)})`)
    ok(await p.locator('[data-match="2-2"]').innerText().then(t => /TBD/.test(t)), `${T}: an unknown opponent reads TBD`)
    ok(await p.locator('[data-testid=champion]').count() === 0, `${T}: no champion yet`)
    const scroll = await p.evaluate(() => { const s = document.querySelector('.bracket-scroll'); return { sw: s.scrollWidth, cw: s.clientWidth, page: document.documentElement.scrollWidth, iw: innerWidth } })
    ok(scroll.page <= scroll.iw + 1, `${T}: the page itself does not scroll sideways`)
    if (width === 375) ok(scroll.sw > scroll.cw, `${T}: the bracket scrolls inside its own box (${scroll.sw} > ${scroll.cw})`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    const p = await open('/tournaments/bk2', { width: 375 })
    ok(/champion/i.test(await p.locator('[data-testid=champion]').innerText()) && /Alexandra Rivera-Montgomery/.test(await p.locator('[data-testid=champion]').innerText()), 'a finished event shows its champion')
    ok(await p.locator('.b-row.is-loser').count() === 3, 'three losers struck through in a finished 4-player bracket')
    ok(await p.locator('.b-match.is-click').count() === 1, 'only the final can still be corrected once it has been played (the semifinals are locked)')
    ok(/locked/i.test(await p.locator('body').innerText()), 'and the page says why')
    await close(p)
  }

  section('tournaments: entering and correcting results')
  {
    const p = await open('/tournaments/bk1', { width: 375 })
    ok(await p.locator('.b-match.is-click').count() === 3, 'three matches can be scored: the open quarterfinal, the corrected one, and the semifinal with both players known')
    ok(await p.locator('[data-match="1-1"].is-click, [data-match="2-2"].is-click, [data-match="3-1"].is-click').count() === 0, 'a bye, a match waiting for a player and the empty final cannot be tapped')
    await p.locator('[data-match="1-4"]').click(); await p.waitForTimeout(200)
    const panel = p.locator('[data-testid=score-panel]')
    ok(await panel.count() === 1 && /Enter result/.test(await panel.innerText()) && /Cat/.test(await panel.innerText()) && /Finn/.test(await panel.innerText()), 'tapping a match opens the score panel with both names')
    const [a, b] = [panel.locator('input').nth(0), panel.locator('input').nth(1)]
    const save = panel.getByRole('button', { name: 'Save result' })
    for (const [x, y] of [[4, 4], [5, 3], [7, 5]]) {
      await a.fill(String(x)); await b.fill(String(y)); await save.click(); await p.waitForTimeout(150)
      ok(await panel.locator('.flash-error').count() === 1, `${x}-${y}: an unfinished score shows a reason`)
    }
    await a.fill(''); await b.fill('3'); await save.click(); await p.waitForTimeout(150)
    ok(/whole numbers/.test(await panel.locator('.flash-error').innerText()), 'an empty box asks for whole numbers')
    ok(!(await rpcs(p)).some(r => r.name === 'report_bracket_match'), 'none of those reached the database')
    await a.fill('4'); await b.fill('2'); await save.click(); await p.waitForTimeout(300)
    const rep = await lastRpc(p, 'report_bracket_match')
    ok(rep && rep.args.p_match_id === 'bk1-1-4' && rep.args.p_score_a === 4 && rep.args.p_score_b === 2, `a finished score is sent for that match (${JSON.stringify(rep)})`)
    ok(await panel.count() === 0, 'and the panel closes')
    await p.locator('[data-match="1-2"]').click(); await p.waitForTimeout(200)
    ok(/Correct result/.test(await panel.innerText()) && await panel.locator('input').nth(0).inputValue() === '4' && await panel.locator('input').nth(1).inputValue() === '2', 'a played match opens as a correction, pre-filled with its score')
    await p.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(100)
    ok(await panel.count() === 0, 'Cancel closes it without sending anything')
    ok(p.errs.length === 0, `no page errors ${p.errs}`)
    await close(p)
  }
  {
    const p = await open('/tournaments/bk1', { width: 375, bracketerr: true })
    await p.locator('[data-match="2-1"]').click(); await p.waitForTimeout(150)
    const panel = p.locator('[data-testid=score-panel]')
    await panel.locator('input').nth(0).fill('4'); await panel.locator('input').nth(1).fill('1')
    await panel.getByRole('button', { name: 'Save result' }).click(); await p.waitForTimeout(300)
    ok(/already played the next round/.test(await panel.locator('.flash-error').innerText()), 'a refusal from the database is shown in the panel, and the panel stays open')
    await close(p)
  }
  {
    const p = await open('/tournaments/bk1', { width: 375 })
    await p.getByRole('button', { name: /delete tournament/i }).click(); await p.waitForTimeout(150)
    ok(/can't be undone/.test(await p.locator('body').innerText()) && !(await rpcs(p)).some(r => r.name === 'delete_bracket_event'), 'delete asks first and sends nothing yet')
    await p.getByRole('button', { name: 'Keep it' }).click(); await p.waitForTimeout(100)
    ok(await p.getByRole('button', { name: /delete tournament/i }).count() === 1, '"Keep it" backs out')
    await p.getByRole('button', { name: /delete tournament/i }).click()
    await p.getByRole('button', { name: /yes, delete/i }).click(); await p.waitForTimeout(500)
    const del = await lastRpc(p, 'delete_bracket_event')
    ok(del && del.args.p_event_id === 'bk1', `confirming deletes that event (${JSON.stringify(del)})`)
    ok(new URL(p.url()).pathname === '/tournaments', 'and returns to the list')
    await close(p)
  }

  // ── 17. Home redesign (v0.0.8.6): hero, league numbers, ladder, round robin week, features ──
  // Expected numbers are worked out from the fixtures by hand (see fixtures.ts): 6 players; 12 matches finished,
  // two on each of the last 6 days, so 12 in the last week and a 6-day streak (alive from yesterday);
  // the newest week has 3 matches, all played, by 4 players.
  section('home: new look, visitor and player')
  const norm = t => t.replace(/\s+/g, ' ').trim()
  for (const width of [375, 1280]) {
    const T = `visitor @${width}`
    const p = await open('/', { width, anon: true, elo: true })
    await p.waitForSelector('[data-test="stat-strip"]', { timeout: 4000 }).catch(() => {})
    const h1 = norm(await p.locator('h1').innerText())
    ok(h1 === 'Track every rally. Own the court.', `${T}: tennis headline (${h1})`)
    ok(/tennis/i.test(await p.locator('.welcome .eyebrow').first().innerText()), `${T}: eyebrow names the sport`)
    ok(await p.locator('img.hero-art').getAttribute('alt') === 'A tennis court', `${T}: tennis court picture`)
    const art = await p.locator('img.hero-art').boundingBox()
    ok(art.x >= 0 && art.x + art.width <= width + 1 && art.height > 80, `${T}: the illustration sits inside the screen (${JSON.stringify(art)})`)
    await p.waitForFunction(() => { const i = document.querySelector('img.hero-art'); return i && i.complete }, null, { timeout: 5000 }).catch(() => {})
    const pic = await p.evaluate(() => { const i = document.querySelector('img.hero-art'); return { w: i.naturalWidth, h: i.naturalHeight, src: i.getAttribute('src') } })
    ok(pic.src === '/hero/tennis.jpg' && pic.w === 1228 && pic.h === 454, `${T}: the tennis picture loads at its real size (${JSON.stringify(pic)})`)
    const stat = id => p.locator(`[data-test="${id}"]`).innerText()
    ok(await stat('stat-players') === '6' && await stat('stat-matches') === '12' && await stat('stat-streak') === '6', `${T}: players 6, matches 12, day streak 6`)
    ok(/12 this week/.test(await stat('stat-week')), `${T}: 12 matches this week`)
    const rows = await p.$$eval('[data-test="ladder-card"] tbody tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim())))
    const flat = rows.map(r => [r[0], r[1].replace(/^[A-Z]{1,2}\s/, ''), r[2], r[3]].join('|'))
    ok(JSON.stringify(flat) === JSON.stringify(['1|Alexandra R.|1,180|▲ +30', '2|Bartholomew N.|1,120|▲ +120', '3|Cat|1,060|▼ -30', '4|Dmitri V.|1,000|–', '5|Eloise F.|940|–']), `${T}: ladder rows with the change since the last rating before this week (${JSON.stringify(flat)})`)
    // compare where the TEXT ends, not the cell boxes (cell boxes line up whatever the alignment is)
    const align = await p.evaluate(() => {
      const textRight = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right }
      const th = textRight(document.querySelector('[data-test="ladder-card"] th.num:last-child'))
      const td = [...document.querySelectorAll('[data-test="ladder-card"] tbody tr td:last-child')].map(textRight)
      return { th, td }
    })
    ok(align.td.every(r => Math.abs(r - align.th) < 2.5), `${T}: the Change heading lines up with its numbers (${JSON.stringify(align)})`)
    const season = norm(await p.locator('[data-test="season-summary"]').innerText())
    ok(/Autumn Season 2026 · Week 2/.test(season) && /4 players this week/.test(season) && /3 of 3 matches played/.test(season), `${T}: round robin week shows real numbers (${season})`)
    ok(await p.locator('[data-test="season-summary"] a.btn', { hasText: 'Open round robin' }).count() === 1, `${T}: and a button into the round robin`)
    ok(await p.locator('.steps li').count() === 4 && /More play\. Less work\./.test(await p.locator('[data-test="dusk"]').innerText()), `${T}: features row, and the tagline in the closing banner`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    if (width === 1280) {
      const pos = await p.evaluate(() => ['[data-test="ladder-card"]', '[data-test="season-summary"]'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().left)))
      ok(pos[1] > pos[0] + 300, `${T}: ladder and round robin week sit side by side (${pos})`)
    }
    await close(p)
  }
  {
    // a bye in the newest week is not a match: the week still reads 3 of 3 played by 4 players
    const p = await open('/', { width: 1280, anon: true, byeweek: true })
    await p.waitForSelector('[data-test="season-summary"]', { timeout: 4000 }).catch(() => {})
    const t = norm(await p.locator('[data-test="season-summary"]').innerText())
    ok(/3 of 3 matches played/.test(t) && /4 players this week/.test(t), `a bye is not counted as a match or a player (${t})`)
    await close(p)
  }
  {
    // a match that was never finished (the 'pending' switch adds one) must not count towards the totals
    const p = await open('/', { width: 1280, anon: true, pending: true })
    await p.waitForSelector('[data-test="stat-strip"]', { timeout: 4000 }).catch(() => {})
    ok(await p.locator('[data-test="stat-matches"]').innerText() === '12' && await p.locator('[data-test="stat-streak"]').innerText() === '6', 'an unfinished match is not counted (still 12 matches, 6-day streak)')
    await close(p)
  }
  {
    // no rating history in the data at all: everyone's change is measured from the starting 1000
    const p = await open('/', { width: 1280, anon: true })
    await p.waitForSelector('[data-test="ladder-card"] tbody tr', { timeout: 4000 }).catch(() => {})
    const ch = await p.$$eval('[data-test="ladder-card"] tbody tr td:last-child', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()))
    ok(JSON.stringify(ch) === JSON.stringify(['▲ +180', '▲ +120', '▲ +60', '–', '▼ -60']), `with no history, change is the rating minus 1000 (${JSON.stringify(ch)})`)
    await close(p)
  }
  {
    const p = await open('/', { width: 1280, anon: true, pingpong: true })
    ok(norm(await p.locator('h1').innerText()) === 'Every table has a story. Make yours count.', 'a table sport gets the table headline')
    ok(/^ping pong$/i.test(await p.locator('.welcome .eyebrow').first().innerText()), 'and its eyebrow names the sport')
    const tableText = await p.locator('body').innerText()
    ok(!/building|neighbo/i.test(tableText), `nothing on the table tennis page mentions a building or neighbors (${(tableText.match(/.{0,30}(building|neighbo).{0,30}/i) || [''])[0]})`)
    ok(/challenge other players, track your rating/i.test(await p.locator('.hero-sub').innerText()) && /^challenge players$/i.test(await p.locator('.steps li h3').first().innerText()), 'with the table wording in the pitch and the first feature')
    ok(await p.locator('img.hero-art').getAttribute('alt') === 'A ping pong table', 'and the table picture')
    await p.waitForFunction(() => { const i = document.querySelector('img.hero-art'); return i && i.complete }, null, { timeout: 5000 }).catch(() => {})
    const tpic = await p.evaluate(() => { const i = document.querySelector('img.hero-art'); return { w: i.naturalWidth, h: i.naturalHeight, src: i.getAttribute('src') } })
    ok(tpic.src === '/hero/table.jpg' && tpic.w === 1228 && tpic.h === 417, `the table picture loads at its real size (${JSON.stringify(tpic)})`)
    await close(p)
    const q = await open('/', { width: 375, anon: true, noleague: true })
    await q.waitForTimeout(500)
    ok(await q.locator('h1').count() === 1 && await q.locator('.welcome-cta a').count() === 2, 'with no league yet the pitch still shows')
    ok(await q.locator('[data-test="stat-strip"]').count() === 0 && await q.locator('[data-test="ladder-card"]').count() === 0 && await q.locator('[data-test="season-summary"]').count() === 0, 'and the numbers and cards are left out rather than shown empty')
    ok(q.errs.length === 0, `no page errors ${q.errs}`)
    await close(q)
  }
  for (const width of [375, 1280]) {
    const T = `player @${width}`
    const p = await open('/', { width, elo: true })
    await p.waitForSelector('[data-test="ladder-card"] tbody tr', { timeout: 4000 }).catch(() => {})
    ok(await p.locator('[data-test="stat-strip"]').count() === 1 && await p.locator('[data-test="stat-players"]').innerText() === '6', `${T}: the signed-in home shows the league numbers too`)
    ok(await p.locator('[data-test="ladder-card"] tbody tr').count() === 5, `${T}: and the top of the ladder`)
    ok(await p.locator('.welcome').count() === 0, `${T}: not the visitor page`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }

  // ── 18. Anyone can look at any league (v0.0.8.8): the switcher for visitors, and the Round Robin page ──
  section('visitors: switch league and sport without an account')
  const LEAGUE2 = '00000000-0000-0000-0000-0000000000a9'
  const savedLeague = pg => pg.evaluate(() => localStorage.getItem('rally.currentLeagueId'))
  const eyebrow = pg => pg.locator('.eyebrow').first().innerText().then(t => t.trim())
  const openMenu = async pg => { await pg.locator('.league-icon-btn').click(); await pg.waitForSelector('.league-menu', { timeout: 3000 }) }
  for (const width of [375, 1280]) {
    const T = `visitor @${width}`
    const p = await open('/leaderboard', { width, anon: true, twoleagues: true })
    await p.waitForFunction(() => document.querySelector('.eyebrow')?.textContent.trim().length > 0, null, { timeout: 4000 }).catch(() => {})
    ok(/riverside tennis club/i.test(await eyebrow(p)), `${T}: with no league remembered, the first league is shown (${await eyebrow(p)})`)
    ok(await savedLeague(p) === '00000000-0000-0000-0000-0000000000aa', `${T}: and it is remembered`)
    await openMenu(p)
    const rows = await p.$$eval('[data-test="league-list"] .league-menu-row', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()))
    ok(rows.length === 2 && /Riverside Tennis Club\s+Tennis/i.test(rows[0]) && /Building 2 Ping Pong\s+Ping Pong/i.test(rows[1]), `${T}: every league is listed with its sport (${JSON.stringify(rows)})`)
    ok(await p.locator('.league-join-btn').count() === 0, `${T}: a visitor sees no Join buttons`)
    ok(/anyone can look/i.test(await p.locator('[data-test="league-signin-hint"]').innerText()) && await p.locator('[data-test="league-signin-hint"] a[href="/login"]').count() === 1, `${T}: and is told to sign in to join, with a link`)
    ok(await p.locator('.league-menu-row.active').count() === 1 && /Riverside/.test(await p.locator('.league-menu-row.active').innerText()), `${T}: the league on show is marked`)
    ok(!/logged in/i.test(await p.locator('.league-menu').innerText()), `${T}: no "must be logged in" message`)
    const box = await p.locator('.league-menu').boundingBox()
    ok(box.x >= 0 && box.x + box.width <= width + 1, `${T}: the menu fits the screen (${JSON.stringify(box)})`)
    await p.locator(`[data-league="${LEAGUE2}"]`).click(); await p.waitForTimeout(300)
    ok(await p.locator('.league-menu').count() === 0, `${T}: choosing a league closes the menu`)
    ok(/building 2 ping pong/i.test(await eyebrow(p)), `${T}: the leaderboard now shows the other league (${await eyebrow(p)})`)
    ok((await p.locator('.league-icon-btn').innerText()).includes('🏓'), `${T}: the icon in the top bar is the chosen league's`)
    ok(await savedLeague(p) === LEAGUE2, `${T}: the choice is remembered`)
    await p.reload(); await p.waitForFunction(() => document.querySelector('.eyebrow')?.textContent.trim().length > 0, null, { timeout: 4000 }).catch(() => {})
    ok(/building 2 ping pong/i.test(await eyebrow(p)), `${T}: and survives a reload (${await eyebrow(p)})`)
    await p.goto(new URL('/', p.url()).href); await p.waitForSelector('h1', { timeout: 4000 })
    const h1 = (await p.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim()
    ok(h1 === 'Every table has a story. Make yours count.', `${T}: the home page follows the sport of the league (${h1})`)
    ok(await p.locator('img.hero-art').getAttribute('alt') === 'A ping pong table', `${T}: with that sport's picture`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }

  section('visitors: the Round Robin page is open to look at')
  for (const width of [375, 1280]) {
    const T = `round robin as visitor @${width}`
    const p = await open('/tournament', { width, anon: true })
    await p.waitForSelector('h1', { timeout: 4000 }).catch(() => {})
    ok(new URL(p.url()).pathname === '/tournament', `${T}: no redirect to sign in (${p.url()})`)
    const text = await p.locator('body').innerText()
    ok(/round robin/i.test(await p.locator('h1').first().innerText()), `${T}: the page shows`)
    ok(!/start a season|player accounts|finalize|start a week/i.test(text), `${T}: with none of the admin controls`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    const p = await open('/', { width: 375, anon: true })
    await p.waitForSelector('[data-test="season-summary"]', { timeout: 4000 }).catch(() => {})
    await p.locator('[data-test="season-summary"] a.btn', { hasText: 'Open round robin' }).click(); await p.waitForTimeout(500)
    ok(new URL(p.url()).pathname === '/tournament', `a visitor can follow "Open round robin" from the home page (${p.url()})`)
    await p.goto(new URL('/', p.url()).href); await p.waitForSelector('.tabbar', { timeout: 4000 })
    const tab = p.locator('.tabbar .tab[href="/tournament"]')
    ok(await tab.count() === 1, 'the Round Robin tab is in the bar for visitors')
    await tab.click(); await p.waitForTimeout(500)
    ok(new URL(p.url()).pathname === '/tournament', `and the tab opens the page instead of the sign-in screen (${p.url()})`)
    await close(p)
  }

  section('players: the same menu, with Join for leagues not yet joined')
  {
    const p = await open('/leaderboard', { width: 1280, twoleagues: true })
    await p.waitForFunction(() => document.querySelector('.eyebrow')?.textContent.trim().length > 0, null, { timeout: 4000 }).catch(() => {})
    await openMenu(p)
    const sections = await p.$$eval('.league-menu-label', ls => ls.map(l => l.textContent.trim()))
    ok(sections.includes('Your leagues') && sections.includes('Other leagues'), `a player sees "Your leagues" and "Other leagues" (${sections})`)
    ok(await p.locator('.league-join-btn').count() === 1 && await p.locator('[data-test="league-signin-hint"]').count() === 0, 'one Join button (for the league not joined) and no sign-in hint')
    ok(await p.locator('.league-menu-row', { hasText: 'Building 2' }).locator('.league-join-btn').count() === 1, 'and it is on the other league')
    await p.locator(`[data-league="${LEAGUE2}"]`).click(); await p.waitForTimeout(300)
    ok(/building 2 ping pong/i.test(await eyebrow(p)), `a player can look at a league without joining it (${await eyebrow(p)})`)
    ok((await p.locator('.league-icon-btn').innerText()).includes('🏓'), 'and the top bar icon follows it')
    ok(p.errs.length === 0, `no page errors ${p.errs}`)
    await close(p)
  }

  // ── 19. The closing banner is tied to the bottom of the page, and court wording is unchanged (v0.0.8.9) ──
  section('visitor home: the slogan band ends the page, no empty space below it; no building or neighbors wording')
  const bandGap = pg => pg.evaluate(() => {
    const d = document.querySelector('[data-test="dusk"]').getBoundingClientRect(), pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0
    const line = document.querySelector('.dusk-line em').getBoundingClientRect()
    return { gap: Math.round((document.documentElement.scrollHeight - pad) - (d.bottom + scrollY)), h: Math.round(d.height), inside: line.top >= d.top - 0.5 && line.bottom <= d.bottom + 0.5, wide: Math.round(d.width), iw: innerWidth, sw: document.documentElement.scrollWidth }
  })
  for (const [width, height] of [[375, 800], [320, 568], [1280, 800], [1280, 1500], [1280, 2600], [1920, 1200]]) {
    for (const sportFlags of [{}, { pingpong: true }]) {
      const T = `band @${width}x${height}${sportFlags.pingpong ? ' table' : ' tennis'}`
      const p = await open('/', { width, anon: true, elo: true, ...sportFlags })
      await p.setViewportSize({ width, height }); await p.waitForSelector('[data-test="dusk"]', { timeout: 4000 }); await p.waitForTimeout(400)
      const g = await bandGap(p)
      ok(Math.abs(g.gap) <= 1.5, `${T}: the page ends on the banner, no empty space under it (gap ${g.gap}px)`)
      ok(g.inside, `${T}: the slogan sits inside the banner`)
      ok(g.sw <= g.iw && g.wide >= g.iw - 1, `${T}: the banner spans the whole width and nothing scrolls sideways (${g.wide} of ${g.iw})`)
      // the page is about 1420px tall at these widths for table tennis and about 1900px for tennis (v0.0.9.2: the round robin card under the ladder),
      // so only a window taller than that has spare height to fill
      if (height >= 2600) ok(g.h > 160, `${T}: on a tall screen the banner takes the spare height (${g.h}px) instead of leaving a gap`)
      ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
      await close(p)
    }
  }
  {
    // a page with little on it no longer scrolls just because of a minimum height of a whole screen
    const p = await open('/login', { width: 1280, anon: true })
    await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(500)
    const fit = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }))
    ok(fit.sh <= fit.ih + 1, `the sign-in page does not scroll when it fits (${fit.sh} in ${fit.ih})`)
    await close(p)
  }
  {
    // tennis reads the same way: no building, no neighbors
    const p0 = await open('/', { width: 1280, anon: true })
    await p0.waitForSelector('.steps li', { timeout: 4000 })
    const tennisText = await p0.locator('body').innerText()
    ok(!/building|neighbo/i.test(tennisText), `nothing on the tennis home page mentions a building or neighbors (${(tennisText.match(/.{0,30}(building|neighbo).{0,30}/i) || [''])[0]})`)
    ok(/^challenge players$/i.test(await p0.locator('.steps li h3').first().innerText()), 'the first feature reads "Challenge players"')
    ok(/live ratings for everyone in your league\. challenge other players/i.test(await p0.locator('.hero-sub').innerText()), 'and the pitch reads "Live ratings for everyone in your league"')
    await close(p0)
  }

  // ── 18. The picture behind the signed-in greeting and the profile header (v0.0.9.1) ──────────────────────
  // Real picture sizes (read from the JPEG headers by the JS suite): tennis 1228x454, table 1228x417.
  section('signed-in home and profile: the picture banner, tennis and table, phone and desktop')
  for (const [name, flags, file, w, h, art] of [['tennis', {}, '/hero/tennis.jpg', 1228, 454, 'court'], ['table', { pingpong: true }, '/hero/table.jpg', 1228, 417, 'table']])
  for (const width of [375, 1280]) for (const [path, scene] of [['/', 'home-scene'], ['/profile', 'profile-scene']]) {
    const T = `${name} ${path === '/' ? 'home' : 'profile'} @${width}`
    const p = await open(path, { width, ...flags })
    await p.waitForSelector(`[data-test="${scene}"]`, { timeout: 5000 }).catch(() => {})
    await p.waitForFunction(() => { const i = document.querySelector('.scene-backdrop img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 5000 }).catch(() => {})
    const bd = await p.evaluate(() => { const b = document.querySelector('.scene-backdrop'), i = b?.querySelector('img'); return b ? { n: document.querySelectorAll('.scene-backdrop').length, aria: b.getAttribute('aria-hidden'), alt: i.getAttribute('alt'), src: i.getAttribute('src'), nw: i.naturalWidth, nh: i.naturalHeight, aw: +i.getAttribute('width'), ah: +i.getAttribute('height'), art: b.dataset.art } : null })
    ok(bd && bd.n === 1, `${T}: exactly one picture behind the header (${JSON.stringify(bd)})`)
    ok(bd && bd.src === file && bd.nw === w && bd.nh === h, `${T}: the ${name} picture loads at its real size (${JSON.stringify(bd)})`)
    ok(bd && bd.aw === bd.nw && bd.ah === bd.nh, `${T}: the size the page declares is the file's real size, so nothing jumps when it loads (${bd?.aw}x${bd?.ah} vs ${bd?.nw}x${bd?.nh})`)
    ok(bd && bd.art === art, `${T}: the picture follows the league's sport (${bd?.art})`)
    ok(bd && bd.aria === 'true' && bd.alt === '', `${T}: it is hidden from screen readers (aria-hidden ${bd?.aria}, alt "${bd?.alt}")`)
    const g = await p.evaluate(sel => { const e = document.querySelector(`[data-test="${sel}"]`).getBoundingClientRect(); return { x: Math.round(e.left), w: Math.round(e.width), h: Math.round(e.height), cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth } }, scene)
    ok(Math.abs(g.x) <= 1 && Math.abs(g.w - g.cw) <= 1, `${T}: the header runs the full width (${JSON.stringify(g)})`)
    ok(g.h >= (width < 600 ? 160 : 200) - 1, `${T}: the header is tall enough to show the picture (${g.h}px)`)
    ok(g.sw <= g.cw, `${T}: no sideways scroll`)
    // the backdrop is click-through, so make it take clicks first; then whatever is at a point proves what is on top there
    await p.addStyleTag({ content: '.scene-backdrop, .scene-backdrop * { pointer-events: auto !important }' })
    const top = await p.evaluate(sel => {
      const root = document.querySelector(`[data-test="${sel}"]`)
      const centre = el => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] }
      const probe = el => { const [x, y] = centre(el); const hit = document.elementFromPoint(x, y); return !!hit && el.contains(hit) }
      const out = { h1: probe(root.querySelector('h1')), eyebrow: probe(root.querySelector('.eyebrow')) }
      out.backdropIsHit = (() => { const b = root.querySelector('.scene-backdrop').getBoundingClientRect(); const hit = document.elementFromPoint(b.right - 4, b.top + 4); return !!hit && hit.closest('.scene-backdrop') !== null })()
      return out
    }, scene)
    ok(top.h1 && top.eyebrow, `${T}: the heading and the line above it sit on top of the picture (${JSON.stringify(top)})`)
    ok(top.backdropIsHit, `${T}: (check of the check) the picture really is hit at the bright right corner once made clickable`)
    if (path === '/profile') {
      const bt = await p.evaluate(() => {
        const root = document.querySelector('[data-test="profile-scene"]'), nameBottom = root.querySelector('h1').getBoundingClientRect().bottom
        return [...root.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { t: b.innerText.trim(), w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth, below: r.top >= nameBottom - 1, hit: !!hit && b.contains(hit) } })
      })
      ok(bt.length === 2 && bt.every(b => b.h >= 32 && b.w >= 60 && b.inside && b.hit), `${T}: the profile buttons can be tapped (${JSON.stringify(bt)})`)
      ok(bt.every(b => b.below), `${T}: the buttons sit under the name (${JSON.stringify(bt)})`)
      if (width >= 1000) {
        const aw = await p.evaluate(() => Math.round(document.querySelector('[data-test="profile-actions"]').getBoundingClientRect().width))
        ok(aw <= 34 * 16 + 1, `${T}: the buttons stay on the dark left of the picture (${aw}px wide)`)
      }
    }
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    // a signed-out visitor still gets the original hero (one picture, the hero one) and nothing from the banner
    const p = await open('/', { width: 1280, anon: true })
    await p.waitForSelector('img.hero-art', { timeout: 4000 }).catch(() => {})
    ok(await p.locator('.scene-backdrop').count() === 0 && await p.locator('img.hero-art').count() === 1, 'visitor home: the hero is unchanged and has no banner backdrop')
    await close(p)
  }

  // ── 19. The round robin standings under the ladder, tennis only (v0.0.9.2) ─────────────────────────────────
  // Fixture, by hand: rr_points 22, 19, 16, 13, 10, 7 and wins/losses 5-0, 4-1, 3-2, 2-3, 1-4, 0-5 for Alexandra R., Bartholomew N.,
  // Cat, Dmitri V., Eloise F., Finn. The card shows the top five. (Ratings are 1180 down to 940, so these numbers can only come from the season.)
  section('home: round robin standings under the ladder for tennis, not for table tennis')
  const WANT = [['1', 'Alexandra R.', '22', '5–0'], ['2', 'Bartholomew N.', '19', '4–1'], ['3', 'Cat', '16', '3–2'], ['4', 'Dmitri V.', '13', '2–3'], ['5', 'Eloise F.', '10', '1–4']]
  for (const who of ['player', 'visitor']) for (const width of [375, 1280]) {
    const T = `tennis ${who} home @${width}`
    const p = await open('/', { width, ...(who === 'visitor' ? { anon: true } : {}) })
    await p.waitForSelector('[data-test="rr-card"] tbody tr', { timeout: 5000 }).catch(() => {})
    const rr = await p.evaluate(() => {
      const c = document.querySelector('[data-test="rr-card"]'), l = document.querySelector('[data-test="ladder-card"]')
      if (!c || !l) return null
      const rect = e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width) } }
      const t = e => e.innerText.replace(/\s+/g, ' ').trim(), raw = e => e.textContent.replace(/\s+/g, ' ').trim()   // raw: as written, before CSS upper-cases it
      return { rows: [...c.querySelectorAll('tbody tr')].map(tr => [t(tr.querySelector('.rank')), t(tr.querySelector('.nm')), t(tr.querySelector('[data-test="rr-points"]')), t(tr.querySelector('.rec'))]),
        title: raw(c.querySelector('h2')), sub: raw(c.querySelector('.panel-sub')), heads: [...c.querySelectorAll('th')].map(raw), link: c.querySelector('a.panel-link')?.getAttribute('href'),
        cr: rect(c), lr: rect(l), ladderRows: l.querySelectorAll('tbody tr').length, ladderHeads: [...l.querySelectorAll('th')].map(raw),
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }
    })
    ok(!!rr, `${T}: both the ladder card and the round robin card are on the page`)
    if (rr) {
      ok(JSON.stringify(rr.rows) === JSON.stringify(WANT), `${T}: the top five of the standings, in order (${JSON.stringify(rr.rows)})`)
      ok(rr.title === 'Round robin standings' && rr.sub.startsWith('Autumn Season 2026'), `${T}: title and season (${rr.title} / ${rr.sub})`)
      ok(JSON.stringify(rr.heads) === JSON.stringify(['#', 'Player', 'Points', 'W–L']), `${T}: columns (${rr.heads})`)
      ok(rr.link === '/leaderboard', `${T}: View all goes to the Leaderboard (${rr.link})`)
      ok(rr.ladderRows === 5 && rr.ladderHeads.join('|') === '#|Player|Rating|Change', `${T}: the ladder is unchanged (${rr.ladderRows} rows, ${rr.ladderHeads})`)
      ok(rr.cr.top >= rr.lr.bottom, `${T}: the round robin card sits under the ladder (ladder ends ${rr.lr.bottom}, card starts ${rr.cr.top})`)
      ok(Math.abs(rr.cr.left - rr.lr.left) <= 1 && Math.abs(rr.cr.w - rr.lr.w) <= 1, `${T}: in the same column, same width (${JSON.stringify([rr.cr, rr.lr])})`)
      ok(rr.sw <= rr.cw, `${T}: no sideways scroll`)
    }
    ok(p.errs.length === 0, `${T}: no page errors ${p.errs}`)
    await close(p)
  }
  for (const who of ['player', 'visitor']) {
    const p = await open('/', { width: 1280, pingpong: true, ...(who === 'visitor' ? { anon: true } : {}) })
    await p.waitForSelector('[data-test="ladder-card"] tbody tr', { timeout: 5000 }).catch(() => {})
    ok(await p.locator('[data-test="ladder-card"]').count() === 1 && await p.locator('[data-test="rr-card"]').count() === 0, `table tennis ${who} home: the ladder alone, no round robin card`)
    ok(p.errs.length === 0, `table tennis ${who} home: no page errors ${p.errs}`)
    await close(p)
  }
  for (const who of ['player', 'visitor']) {
    const p = await open('/', { width: 375, norr: true, ...(who === 'visitor' ? { anon: true } : {}) })
    await p.waitForSelector('[data-test="rr-card"]', { timeout: 5000 }).catch(() => {})
    const e = await p.evaluate(() => ({ rows: document.querySelectorAll('[data-test="rr-card"] tbody tr').length, msg: document.querySelector('[data-test="rr-empty"]')?.textContent?.trim() }))
    ok(e.rows === 0 && e.msg === 'Standings appear once the first week of the season starts.', `tennis ${who} home, nobody enrolled yet: a short message, not an empty table (${JSON.stringify(e)})`)
    ok(p.errs.length === 0, `tennis ${who} home, nobody enrolled: no page errors ${p.errs}`)
    await close(p)
  }

  // ── 19. The bottom bar after signing in (v0.0.9.3) ───────────────────────────────────────────────────────
  section('bottom bar: back after signing in, even when the browser sends no focus-left event')
  for (const [label, sim] of [['a normal browser', false], ['a browser that sends no focus-left event when a focused box is removed', true]])
  for (const how of ['the Enter / Go key', 'tapping the Sign in button']) {
    const p = await open('/login', { anon: true, noRemovalFocusout: sim })
    ok(await p.locator('.tabbar').count() === 0, `${label}, ${how}: no bar on the sign-in page itself`)
    await p.fill('#login-email', 'a@b.co'); await p.fill('#login-password', 'secret123')
    if (how.startsWith('the Enter')) await p.press('#login-password', 'Enter'); else await p.locator('form button[type=submit]').first().tap()
    await p.waitForURL(/leaderboard/, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600)
    const st = await p.evaluate(() => ({ url: location.pathname, shown: !!document.querySelector('.tabbar') && getComputedStyle(document.querySelector('.tabbar')).display !== 'none', active: document.activeElement?.tagName }))
    ok(st.url === '/leaderboard', `${label}, ${how}: lands on the leaderboard (${st.url})`)
    ok(st.shown && (await p.locator('.tabbar').isVisible()), `${label}, ${how}: the bottom bar is showing straight after signing in (${JSON.stringify(st)})`)
    ok(JSON.stringify(await p.$$eval('.tabbar .tab', t => t.map(x => x.getAttribute('href')))) === '["/leaderboard","/matches","/tournament","/progress","/profile"]', `${label}, ${how}: and it is the signed-in bar (Progress and Profile, not Sign in)`)
    ok(p.errs.length === 0, `${label}, ${how}: no page errors ${p.errs}`)
    await close(p)
  }
  {
    // The same thing without a page change: a typing box that disappears while it has focus must not leave the bar hidden.
    for (const sim of [false, true]) {
      const p = await open('/leaderboard', { noRemovalFocusout: sim })
      const tag = sim ? 'no focus-left event' : 'normal'
      await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-typing'; i.type = 'text'; document.body.appendChild(i); i.focus() })
      await p.waitForTimeout(250)
      ok(!(await p.locator('.tabbar').isVisible()), `${tag}: the bar still hides while a typing box has focus`)
      await p.evaluate(() => document.getElementById('tmp-typing').remove()); await p.waitForTimeout(300)
      ok(await p.locator('.tabbar').isVisible(), `${tag}: the bar comes back when the focused typing box is removed`)
      // moving focus from one box to the next must not flash the bar
      await p.evaluate(() => { for (const id of ['t1', 't2']) { const i = document.createElement('input'); i.id = id; i.type = 'text'; document.body.appendChild(i) } document.getElementById('t1').focus() }); await p.waitForTimeout(250)
      await p.evaluate(() => document.getElementById('t2').focus()); await p.waitForTimeout(300)
      ok(!(await p.locator('.tabbar').isVisible()), `${tag}: the bar stays hidden when focus moves from one typing box to the next`)
      await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300)
      ok(await p.locator('.tabbar').isVisible(), `${tag}: and returns once nothing is focused`)
      await close(p)
    }
  }
} finally {
  await browser.close(); await server.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
