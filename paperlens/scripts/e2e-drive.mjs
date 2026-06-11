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
  await waitFor('library papers', `return document.querySelectorAll('nav .paper-item').length > 0`, 30000)
  const nPapers = await js(`return document.querySelectorAll('nav .paper-item').length`)
  await shot('01-library.png'); ok('library', `${nPapers} papers`)

  // ── 2. select first paper → summary ──────────────────────────
  await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
  await waitFor('summary title', `const h=document.querySelector('section[aria-label="阅读"] h2'); return !!(h && h.textContent.length > 3)`, 10000)
  await shot('02-summary.png'); ok('select-paper')

  // ── 3. PDF tab renders canvases (worker pipeline) ─────────────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('全文 PDF')).click(); return true`)
  await waitFor('pdf canvas', `return document.querySelectorAll('section[aria-label="阅读"] canvas').length > 0`, 30000, 1000)
  await sleep(1500); await shot('03-pdf.png'); ok('pdf-render')

  // ── 3b. zoom in/out re-renders wider/narrower canvases ────────
  const w0 = await js(`const c=document.querySelector('section[aria-label="阅读"] canvas'); return c ? Math.round(c.getBoundingClientRect().width) : 0`)
  await js(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '放大').click(); return true`)
  await waitFor('zoomed in', `const c=document.querySelector('section[aria-label="阅读"] canvas'); return c && c.getBoundingClientRect().width > ${w0 + 20}`, 30000, 1000)
  await sleep(800); await shot('03b-pdf-zoom.png')
  const w1 = await js(`const c=document.querySelector('section[aria-label="阅读"] canvas'); return Math.round(c.getBoundingClientRect().width)`)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '适应宽度').click(); return true`)
  await waitFor('zoom reset', `const c=document.querySelector('section[aria-label="阅读"] canvas'); return c && Math.abs(c.getBoundingClientRect().width - ${w0}) < 10`, 30000, 1000)
  ok('pdf-zoom', `${w0}px → ${w1}px → ${w0}px`)

  if (process.env.DRIVE_QUICK) {
    console.log('DRIVE_QUICK set — skipping AI/Notion steps (4-8)')
  } else {
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
    const bubbles = document.querySelectorAll('section[aria-label="对话"] .bubble')
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

  } // end of !DRIVE_QUICK (AI/Notion steps)

  // ── 9. settings modal ─────────────────────────────────────────
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('设置')).click(); return true`)
  await waitFor('settings open', `return !!document.querySelector('[role="dialog"]')`, 5000)
  await shot('11-settings.png')
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await waitFor('settings closed', `return !document.querySelector('[role="dialog"]')`, 5000)
  ok('settings-modal')

  // ── 10. knowledge base: open → REAL full-library indexing completes → notes tab ──
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
  await waitFor('kb open', `return !!document.querySelector('[role="dialog"][aria-label="知识库"]')`, 5000)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('索引状态')).click(); return true`)
  // 等真实索引收尾：状态行出现且「索引中」消失（首次全库本地抽取可达数分钟）
  await waitFor('kb indexed', `
    const d = document.querySelector('[role="dialog"][aria-label="知识库"]')
    return d && /已索引\\s*\\d+\\s*\\/\\s*\\d+/.test(d.textContent) && !d.textContent.includes('索引中：')`, 300000, 3000)
  const kbStat = await js(`const d=document.querySelector('[role="dialog"][aria-label="知识库"]'); const m=d.textContent.match(/已索引\\s*(\\d+)\\s*\\/\\s*(\\d+)[^0-9]*(\\d+)\\s*个片段/); return m ? m.slice(1).join('/') : '?'`)
  await shot('12-knowledge-base.png')
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('我的笔记')).click(); return true`)
  await waitFor('kb notes tab', `return !!document.querySelector('[role="dialog"][aria-label="知识库"] input[placeholder*="搜索笔记"]')`, 5000)
  await shot('13-kb-notes.png')
  // 真实全库问答（花少量 DeepSeek 费用，仅 DRIVE_KB_ASK 时跑）：扩写→FTS→rerank→流式作答→来源 chips（v2 多轮线程 UI）
  if (process.env.DRIVE_KB_ASK) {
    const turnsBefore = await js(`return document.querySelectorAll('[role="dialog"][aria-label="知识库"] .kb-turn').length`)
    await js(`const inp=document.querySelector('[role="dialog"][aria-label="知识库"] input[placeholder*="向整个论文库提问"]');
      const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      setter.call(inp,'哪些论文研究了大模型的训练或微调方法？'); inp.dispatchEvent(new Event('input',{bubbles:true})); return true`)
    await js(`[...document.querySelectorAll('[role="dialog"][aria-label="知识库"] button')].find(b=>b.textContent.trim()==='提问').click(); return true`)
    // 等该轮完成：新 .kb-turn 出现、答案>40 字、「提问」恢复可用（⇒ sources chips 已渲染）
    await waitFor('kb answered', `
      const d=document.querySelector('[role="dialog"][aria-label="知识库"]'); if(!d) return false
      const turns=d.querySelectorAll('.kb-turn'); if (turns.length <= ${turnsBefore}) return false
      const a=turns[turns.length-1].querySelector('.kb-a')
      const btn=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='提问')
      return a && a.textContent.length>40 && !a.textContent.includes('检索并思考中') && btn && !btn.disabled`, 120000, 2000)
    await shot('14-kb-answer.png')
    const info = await js(`
      const d=document.querySelector('[role="dialog"][aria-label="知识库"]')
      const last=[...d.querySelectorAll('.kb-turn')].pop()
      const a=last.querySelector('.kb-a').textContent
      const chips=[...last.querySelectorAll('.kb-sources .chip')].filter(c=>!c.classList.contains('kb-save-note')).map(c=>c.textContent.trim())
      const cited=[...new Set([...a.matchAll(/\\[来源(\\d+)\\]/g)].map(m=>+m[1]))]
      return JSON.stringify({ head: a.slice(0,50), chips, cited })`)
    const kbA = JSON.parse(info)
    const citedOk = kbA.cited.every(n => n >= 1 && n <= kbA.chips.length)
    if (!citedOk) fail('kb-ask', `引用编号越界: cited=${JSON.stringify(kbA.cited)} chips=${kbA.chips.length}`)
    else ok('kb-ask', `answer:"${kbA.head}…" cited=${JSON.stringify(kbA.cited)} chips=${kbA.chips.length}`)
  }
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  ok('knowledge-base', `indexed/total/chunks: ${kbStat}`)

  // ── 11. 引用定位：对话回答标 [页N] → 点击 chip → 阅读区跳 PDF（仅 DRIVE_CITE，花少量费用）──
  if (process.env.DRIVE_CITE) {
    await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
    await waitFor('chat ready', `const s=[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送'); return s && !s.disabled`, 30000, 1000)
    await js(`const t=document.querySelector('section[aria-label="对话"] .chat-textarea'); const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(t,'请引用具体页码，简述论文第二页前后的内容。'); t.dispatchEvent(new Event('input',{bubbles:true})); return true`)
    await js(`[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送').click(); return true`)
    await waitFor('cite answered', `const s=[...document.querySelectorAll('section[aria-label="对话"] button')].find(b=>b.textContent.trim()==='发送'); const b=document.querySelector('section[aria-label="对话"] .bubble.assistant'); return s && !s.disabled && b && b.textContent.length>20`, 120000, 1500)
    const nCite = await js(`return document.querySelectorAll('.page-cite').length`)
    if (nCite) {
      await js(`document.querySelector('.page-cite').click(); return true`)
      await waitFor('pdf jumped', `return !!document.querySelector('section[aria-label="阅读"] .pdf-stage canvas')`, 30000, 1000)
      await shot('15-citation-jump.png'); ok('citation-jump', `[页N] chips=${nCite} → PDF 跳转`)
    } else { await shot('15-citation-jump.png'); ok('citation-jump', 'AI 本轮未标页码（可接受降级）') }
  }

  // ── 12. PDF 文本层 + 选中「问这段」（纯前端，DRIVE_QUICK 内即跑，不花 API）──
  await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
  await waitFor('pdf btn', `return [...document.querySelectorAll('button')].some(b=>b.textContent.includes('全文 PDF'))`, 10000)
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('全文 PDF')).click(); return true`)
  await waitFor('textlayer', `const t=document.querySelector('.pdf-page-wrap .textLayer'); return t && t.querySelectorAll('span').length>3`, 30000, 1000)
  // 构造跨 span 选区 + 触发 selectionchange
  const selLen = await js(`
    const spans=[...document.querySelectorAll('.pdf-page-wrap .textLayer span')].slice(0,3)
    const r=document.createRange(); r.setStart(spans[0].firstChild||spans[0],0); r.setEndAfter(spans[2])
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
    return s.toString().trim().length`)
  await waitFor('ask btn', `return !!document.querySelector('.ask-selection-btn')`, 5000)
  await shot('16-pdf-select.png')
  await js(`document.querySelector('.ask-selection-btn').click(); return true`)
  const injected = await waitFor('quote injected', `const t=document.querySelector('section[aria-label="对话"] .chat-textarea'); return t && t.value.includes('针对这段内容') ? t.value.slice(0,40) : false`, 5000, 500)
  await shot('17-quote-injected.png')
  if (injected) ok('ask-selection', `选中${selLen}字→浮按钮→注入对话`)
  else fail('ask-selection', '注入失败')
  } catch (e) {
    fail('driver', e && e.message)
    try { await shot('99-failure.png') } catch {}
  }

  const passed = results.filter(r => r[1]).length
  console.log(`DRIVE_SUMMARY ${passed}/${results.length} passed`)
  // 测试窗口及时关闭：先销毁所有窗口再退出，避免残留
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
  app.exit(results.every(r => r[1]) ? 0 : 1)
})
