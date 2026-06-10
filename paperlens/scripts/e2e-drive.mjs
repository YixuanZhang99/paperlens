// Interactive E2E driver: boots the REAL built app (real container/ipc/preload/renderer,
// real seeded credentials) and drives the UI feature by feature, capturing a screenshot
// at every step to e2e-shots/. Prints DRIVE_* lines; exits 0 only if all steps pass.
// Run: npm run build && electron scripts/e2e-drive.mjs
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = join(root, 'e2e-shots')
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const ok = (name, extra = '') => { results.push([name, true]); console.log(`DRIVE_PASS ${name} ${extra}`.trim()) }
const fail = (name, extra = '') => { results.push([name, false]); console.log(`DRIVE_FAIL ${name} ${extra}`.trim()) }

// NOTE: Electron gates the `ready` event on the ESM entry module finishing its
// top-level evaluation. So we must NOT top-level-await anything that depends on
// ready (window creation) — everything runs inside app.whenReady().then(main).
process.on('unhandledRejection', (e) => console.log('DRIVE_UNHANDLED', e && e.message))
process.on('uncaughtException', (e) => console.log('DRIVE_UNCAUGHT', e && e.message))

// When electron is launched with a bare script path it does NOT read package.json,
// so app name defaults to "Electron" and userData points at .../Electron — where the
// app's config.enc does NOT live. Pin both to the real app identity BEFORE booting.
app.setName('paperlens')
app.setPath('userData', join(app.getPath('appData'), 'paperlens'))

// boot the real app (its whenReady handler registers ipc + creates the window;
// the module's top level has no awaits, so this import resolves pre-ready)
await import(join(root, 'out/main/index.js'))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let win
const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)

async function getWin() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) return w
    await sleep(200)
  }
  throw new Error('no window appeared')
}

async function waitFor(name, predicateBody, timeoutMs, pollMs = 500) {
  const t0 = Date.now()
  for (;;) {
    const r = await js(predicateBody)
    if (r) return r
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting: ${name}`)
    await sleep(pollMs)
  }
}

async function shot(name) {
  await sleep(300) // let React paint settle so we don't capture the previous frame
  const img = await win.webContents.capturePage()
  fs.writeFileSync(join(shotsDir, name), img.toPNG())
  console.log(`DRIVE_SHOT ${name}`)
}

// React-safe input setter
const SET_INPUT = `
  const __set = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  };`

app.whenReady().then(async () => {
  // the app's own whenReady handler (registered first) has already created the window
  try {
    win = await getWin()
    console.log('DRIVE_BOOT window acquired')
  } catch (e) {
    console.log('DRIVE_FAIL boot ' + (e && e.message)); app.exit(1); return
  }
  try {
  // ── 1. library loads real papers ──────────────────────────────
  await waitFor('library papers', `return document.querySelectorAll('nav li').length > 0`, 30000)
  const nPapers = await js(`return document.querySelectorAll('nav li').length`)
  await shot('01-library.png'); ok('library', `${nPapers} papers`)

  // ── 2. select first paper → summary ──────────────────────────
  await js(`document.querySelectorAll('nav li')[0].click(); return true`)
  await waitFor('summary title', `const h=document.querySelector('section[aria-label="阅读"] h2'); return !!(h && h.textContent.length > 3)`, 10000)
  await shot('02-summary.png'); ok('select-paper')

  // ── 3. PDF tab renders canvases (worker pipeline) ─────────────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('全文 PDF')).click(); return true`)
  await waitFor('pdf canvas', `return document.querySelectorAll('section[aria-label="阅读"] canvas').length > 0`, 30000, 1000)
  await sleep(1500); await shot('03-pdf.png'); ok('pdf-render')

  // ── 4. back to summary → ✨ AI 精读 (the user-reported failure) ─
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '摘要').click(); return true`)
  await sleep(300)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('AI 精读')).click(); return true`)
  await waitFor('deepread streaming', `const d=[...document.querySelectorAll('section[aria-label="阅读"] div')].find(x=>x.textContent.includes('正在精读')||getComputedStyle(x).borderStyle==='dashed'); return !!(d && d.textContent.length > 30)`, 60000, 1000)
  await shot('04-deepread-streaming.png')
  await waitFor('deepread done', `
    const alert = document.querySelector('section[aria-label="阅读"] [role="alert"]')
    if (alert && alert.textContent.includes('失败')) return 'FAILED:' + alert.textContent
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('AI 精读'))
    const notes = document.querySelectorAll('section[aria-label="阅读"] ul li').length
    return (btn && !btn.disabled && notes > 0) ? 'done' : false`, 240000, 2000)
  const dr = await js(`const a=document.querySelector('section[aria-label="阅读"] [role="alert"]'); return a ? a.textContent : ''`)
  if (dr && dr.includes('失败')) { await shot('05-deepread-done.png'); fail('deepread', dr) }
  else {
    const noteHead = await js(`const li=document.querySelector('section[aria-label="阅读"] ul li'); return li ? li.textContent.slice(0,60) : ''`)
    await shot('05-deepread-done.png'); ok('deepread', `note: ${noteHead}…`)
  }

  // ── 5. quick-prompt chip chat (streaming) ─────────────────────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '核心贡献').click(); return true`)
  await waitFor('chat reply', `
    const send = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送')
    const bubbles = document.querySelectorAll('section[aria-label="对话"] span')
    const last = bubbles[bubbles.length - 1]
    return (send && !send.disabled && last && last.textContent.length > 20) ? true : false`, 120000, 1000)
  await shot('06-chat.png'); ok('quick-prompt-chat')

  // ── 6. 存为笔记 (autoTag) → tags chips appear ──────────────────
  const notesBefore = await js(`return document.querySelectorAll('section[aria-label="阅读"] ul li').length`)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('存为笔记')).click(); return true`)
  await waitFor('note saved+refreshed', `return document.querySelectorAll('section[aria-label="阅读"] ul li').length > ${notesBefore}`, 60000, 1000)
  await shot('07-note-tags.png')
  const tagInfo = await js(`
    const lis = [...document.querySelectorAll('section[aria-label="阅读"] ul li')]
    const chips = lis.flatMap(li => [...li.querySelectorAll('span')].map(s => s.textContent)).filter(t => t && t.length <= 14)
    return chips.slice(0, 8).join(',')`)
  ok('save-note-autotag', `tags seen: ${tagInfo}`)

  // ── 7. 深思 (reasoner) short question ─────────────────────────
  await js(`[...document.querySelectorAll('input[type="checkbox"]')].slice(-1)[0].click(); return true`)
  await js(`${SET_INPUT} const inp=document.querySelector('input[placeholder*="输入问题"]'); __set(inp, '一句话总结这篇论文'); return true`)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送').click(); return true`)
  await waitFor('reasoning visible', `
    const grey = [...document.querySelectorAll('section[aria-label="对话"] div')].filter(d => getComputedStyle(d).borderLeftStyle === 'solid' && d.textContent.length > 10)
    return grey.length > 0`, 120000, 1000)
  await shot('08-deepthink-reasoning.png')
  await waitFor('deepthink done', `
    const send = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送')
    return send && !send.disabled`, 240000, 2000)
  await shot('09-deepthink-done.png'); ok('deepthink')

  // ── 8. Notion sync the deep-read note ─────────────────────────
  const syncBtn = await js(`const b=[...document.querySelectorAll('button')].find(x => x.textContent.includes('同步到 Notion')); if(b){b.click(); return true} return false`)
  if (syncBtn) {
    await waitFor('notion synced', `return document.body.textContent.includes('已同步 Notion')`, 60000, 1000)
    await shot('10-notion-synced.png'); ok('notion-sync')
  } else { fail('notion-sync', 'no sync button found') }

  // ── 9. settings modal ─────────────────────────────────────────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('设置')).click(); return true`)
  await waitFor('settings open', `return !!document.querySelector('[role="dialog"]')`, 5000)
  await shot('11-settings.png')
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await waitFor('settings closed', `return !document.querySelector('[role="dialog"]')`, 5000)
  ok('settings-modal')
  } catch (e) {
    fail('driver', e && e.message)
    try { await shot('99-failure.png') } catch {}
  }

  const passed = results.filter(r => r[1]).length
  console.log(`DRIVE_SUMMARY ${passed}/${results.length} passed`)
  app.exit(results.every(r => r[1]) ? 0 : 1)
})
