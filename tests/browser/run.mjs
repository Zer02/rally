// Browser tests: the real app, in a real (headless) Chromium, with the database
// swapped for fake data (tests/browser/harness). Needs Playwright, which is not
// a project dependency:   npm i --no-save playwright && npx playwright install chromium
// (or point CHROME_PATH at an installed Chrome/Chromium).   run:  npm run test:browser
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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

async function open(path, { width = 375, anon = false, noladder = false, pending = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 700 })
  await ctx.addInitScript(f => {
    localStorage.setItem('rally.currentLeague', '00000000-0000-0000-0000-0000000000aa')
    for (const [k, v] of Object.entries(f)) v ? localStorage.setItem(k, '1') : localStorage.removeItem(k)
  }, { anon, noladder, pending })
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

  // ── 3. "How points work" key matches the first-to-6 rules ───────────
  section('how-points-work key')
  for (const width of [375, 1280]) {
    p = await open('/leaderboard', { width }); await p.locator('.points-key summary').click(); await p.waitForTimeout(200)
    const rowsTxt = await p.$$eval('.points-key-table tbody tr', trs => trs.map(t => [...t.children].map(c => c.textContent.trim())))
    const want = [['Win', '4', '16'], ['Lose 3–6 to 5–6', '3', '12'], ['Lose 2–6', '2', '8'], ['Lose 1–6', '1', '4'], ['Lose 0–6', '0', '0']]
    ok(JSON.stringify(rowsTxt) === JSON.stringify(want), `@${width}: key rows ${JSON.stringify(rowsTxt)}`)
    const notes = await p.locator('.points-key-notes').innerText()
    ok(/first to 6 games/.test(notes) && /0–6 loss earns nothing/.test(notes), `@${width}: notes say first to 6 / 0–6 earns nothing`)
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `@${width}: key does not overflow`)
    await close(p)
  }

  // ── 4. Progress page states the XP rule ─────────────────────────────
  section('progress page XP line')
  p = await open('/progress'); const prog = await p.locator('body').innerText()
  ok(/win earns 16 XP/.test(prog) && /4 XP for each\s+game you won \(up to 12\)/.test(prog.replace(/\n/g, ' ')), 'progress explains 16 XP for a win, 4 per game won up to 12'); await close(p)

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
  await p.locator('select').first().focus(); await p.waitForTimeout(250); ok(!(await p.locator('.tabbar').isVisible()), 'hidden while a dropdown has focus')
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(400); ok(await p.locator('.tabbar').isVisible(), 'back after blur'); await close(p)
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

  // ── 8. Score entry: the boxes and the Report button follow the first-to-6 rule ──
  section('score entry: up to 6, only a finished score can be sent')
  for (const width of [375, 1280]) {
    p = await open('/tournament', { width, pending: true }); const T = `score entry @${width}`
    const boxes = await p.locator('.score-input').count()
    ok(boxes === 2, `${T}: two score boxes for the pending match (found ${boxes})`)
    if (boxes === 2) {
      ok((await p.locator('.score-input').first().getAttribute('max')) === '6', `${T}: score box max is 6`)
      const [a, b] = [p.locator('.score-input').nth(0), p.locator('.score-input').nth(1)]
      const btn = p.locator('.match-score-inputs button, .match-score-inputs .btn').first()
      for (const [x, y, legal] of [[6, 4, true], [4, 6, true], [6, 0, true], [0, 6, true], [6, 5, true], [5, 6, true], [4, 4, false], [6, 6, false], [7, 2, false], [4, 2, false], [2, 4, false], [5, 5, false], [3, 0, false]]) {
        await a.fill(String(x)); await b.fill(String(y))
        ok((await btn.isEnabled()) === legal, `${T}: ${x}-${y} ${legal ? 'can' : 'cannot'} be submitted`)
      }
      await a.fill('4'); await b.fill('2'); await p.waitForTimeout(150)
      const hint = (await p.locator('.score-hint').allInnerTexts()).join(' ')
      ok(/first to 6/i.test(hint), `${T}: the hint for 4-2 says first to 6 (got "${hint}")`)
      await a.fill('6'); await b.fill('3'); await btn.click(); await p.waitForTimeout(300)
      const calls = await p.evaluate(() => window.__rpc || [])
      ok(calls.some(c => c.name === 'report_tournament_match' && c.args.p_match_id === 'tmP' && c.args.p_score_a === 6 && c.args.p_score_b === 3), `${T}: 6-3 is sent to the database for the right match (${JSON.stringify(calls.map(c => c.name))})`)
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${T}: no sideways scroll`)
      ok(p.errs.length === 0, `${T}: no page errors ${p.errs.join(';')}`)
    }
    await close(p)
  }
} finally {
  await browser.close(); await server.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
