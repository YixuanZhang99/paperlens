// KB v2 验收驱动：逐项复验上一轮发现的问题是否修复。Run: electron scripts/ux-test-v2.mjs
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = join(root, 'e2e-shots')
fs.mkdirSync(shotsDir, { recursive: true })

process.on('unhandledRejection', (e) => console.log('V2_UNHANDLED', e && e.message))
process.on('uncaughtException', (e) => console.log('V2_UNCAUGHT', e && e.message))

app.setName('paperlens')
app.setPath('userData', join(app.getPath('appData'), 'paperlens'))
await import(join(root, 'out/main/index.js'))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let win
const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`)
const consoleErrors = []
const verdicts = []
const verdict = (id, pass, detail = '') => {
  verdicts.push([id, pass])
  console.log(`V2_${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`.trim())
}
const log = (k, v) => console.log('V2_INFO ' + k + ' :: ' + String(v).replace(/\n/g, ' ⏎ ').slice(0, 1500))

async function getWin() {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) return w
    await sleep(200)
  }
  throw new Error('no window appeared')
}
async function waitFor(name, body, timeoutMs, pollMs = 500) {
  const t0 = Date.now()
  for (;;) {
    const r = await js(body)
    if (r) return r
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting: ' + name)
    await sleep(pollMs)
  }
}
async function shot(name) {
  await sleep(350)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(join(shotsDir, name), img.toPNG())
  console.log('V2_SHOT ' + name)
}

const KB = `document.querySelector('[role="dialog"][aria-label="知识库"]')`
const SET_INPUT = `
  const __set = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  };`

async function openKb() {
  await js(`[...document.querySelectorAll('header button, button')].find(b => b.textContent.includes('知识库')).click(); return true`)
  await waitFor('kb open', `return !!${KB}`, 5000)
}
async function closeKb() {
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await waitFor('kb closed', `return !${KB}`, 5000)
}
// 提问并等待该轮完成：轮数 +1 且「提问」按钮恢复可用
async function askKb(q, tag) {
  const before = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
  await js(`${SET_INPUT} const inp=${KB}.querySelector('input[placeholder*="向整个论文库提问"]'); __set(inp, ${JSON.stringify(q)}); return true`)
  await js(`[...${KB}.querySelectorAll('button')].find(b => b.textContent.trim() === '提问').click(); return true`)
  await waitFor('answered ' + tag, `
    const d=${KB}; if(!d) return false
    const al=d.querySelector('[role="alert"]'); if (al) return true
    const turns=d.querySelectorAll('.kb-turn'); if (turns.length <= ${before}) return false
    const btn=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='提问')
    const a=turns[turns.length-1].querySelector('.kb-a')
    return btn && !btn.disabled && a && !a.textContent.includes('检索并思考中')`, 180000, 1000)
  const info = await js(`
    const d=${KB}
    const turns=[...d.querySelectorAll('.kb-turn')]
    const last=turns[turns.length-1]
    const a=last.querySelector('.kb-a')
    const al=d.querySelector('[role="alert"]')
    const chips=[...last.querySelectorAll('.kb-sources .chip')].filter(c=>!c.classList.contains('kb-save-note'))
    return JSON.stringify({
      nTurns: turns.length,
      answer: a ? a.textContent : '(no answer)',
      alert: al ? al.textContent : '',
      chips: chips.map(c=>c.textContent.trim()),
    })`)
  return JSON.parse(info)
}

app.whenReady().then(async () => {
  try {
    win = await getWin()
    win.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2) consoleErrors.push(msg.slice(0, 300))
    })
    console.log('V2_BOOT ok')
    await waitFor('library', `return document.querySelectorAll('nav .paper-item').length > 0`, 30000)

    // 干净起点：清掉上轮残留的对话/筛选持久化（不动笔记数据）
    await js(`localStorage.removeItem('pl.kb.turns'); localStorage.removeItem('pl.kb.keyword'); localStorage.removeItem('pl.kb.tag'); localStorage.removeItem('pl.kb.tab'); return true`)

    // ═══ 1. 编号一致性（P0 复验）═══
    await openKb()
    await sleep(1500) // 让后台增量索引秒过（已全部索引）
    const r1 = await askKb('mid-training 和 post-training 的区别是什么？', 'q1')
    await shot('v2-01-q1-done.png')
    log('q1-answer', r1.answer)
    log('q1-chips', r1.chips.join(' || ') || '(none)')
    if (r1.alert) log('q1-alert', r1.alert)
    {
      const cited = [...new Set([...r1.answer.matchAll(/\[来源(\d+)\]/g)].map(m => +m[1]))]
      const nChips = r1.chips.length
      const bad = cited.filter(n => n < 1 || n > nChips)
      log('q1-cited-set', JSON.stringify(cited) + ' vs chips=' + nChips)
      verdict('1-citation-consistency',
        cited.length > 0 && bad.length === 0 && !r1.alert,
        `cited=${JSON.stringify(cited)} chips=${nChips} bad=${JSON.stringify(bad)} (v2-01-q1-done.png)`)
    }

    // ═══ 2. 来源可溯源：chip 展开面板 + 打开论文 ═══
    const chip1Title = await js(`
      const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
      const c=[...last.querySelectorAll('.kb-sources .chip')].filter(x=>!x.classList.contains('kb-save-note'))[0]
      c.click(); return c.textContent.trim()`)
    log('t2-chip1', chip1Title)
    await sleep(500)
    const panel = await js(`
      const d=${KB}
      const p=d ? d.querySelector('.kb-source-panel') : null
      const quotes=p ? [...p.querySelectorAll('.kb-quote')] : []
      const openBtn=p ? [...p.querySelectorAll('button')].find(b=>b.textContent.includes('打开论文')) : null
      return JSON.stringify({ modalOpen: !!d, panel: !!p, nQuotes: quotes.length,
        quoteLen: quotes.reduce((s,q)=>s+q.textContent.length,0),
        quoteHead: quotes[0] ? quotes[0].textContent.slice(0,120) : '',
        hasOpenBtn: !!openBtn })`)
    const p2 = JSON.parse(panel)
    log('t2-panel', panel)
    await shot('v2-02-source-panel.png')
    verdict('2a-chip-expands-panel',
      p2.modalOpen && p2.panel && p2.nQuotes > 0 && p2.quoteLen > 50 && p2.hasOpenBtn,
      `modalOpen=${p2.modalOpen} quotes=${p2.nQuotes}/${p2.quoteLen}chars openBtn=${p2.hasOpenBtn} (v2-02-source-panel.png)`)
    // 点「打开论文」→ 模态关、论文被选中
    await js(`[...${KB}.querySelector('.kb-source-panel').querySelectorAll('button')].find(b=>b.textContent.includes('打开论文')).click(); return true`)
    await sleep(1200)
    const opened = await js(`
      const h = document.querySelector('section[aria-label="阅读"] h2')
      return JSON.stringify({ modalOpen: !!${KB}, title: h ? h.textContent.slice(0,90) : null })`)
    const o2 = JSON.parse(opened)
    log('t2-after-open-paper', opened)
    await shot('v2-03-open-paper.png')
    const chipPaper = chip1Title.replace(/^\[来源\d+\]\s*/, '')
    verdict('2b-open-paper-selects',
      !o2.modalOpen && !!o2.title && (o2.title.includes(chipPaper.slice(0, 15)) || chipPaper.includes(o2.title.slice(0, 15))),
      `modalClosed=${!o2.modalOpen} reader="${o2.title}" vs chip="${chipPaper.slice(0,40)}" (v2-03-open-paper.png)`)

    // ═══ 3. 多轮持久化 + 指代追问 ═══
    await openKb()
    const hist = await js(`
      const turns=[...${KB}.querySelectorAll('.kb-turn')]
      return JSON.stringify({ n: turns.length, q0: turns[0] ? turns[0].querySelector('.kb-q').textContent : null })`)
    const h3 = JSON.parse(hist)
    log('t3-history', hist)
    await shot('v2-04-reopen-history.png')
    verdict('3a-thread-persists', h3.n >= 1 && (h3.q0 || '').includes('mid-training'),
      `turns=${h3.n} q0="${h3.q0}" (v2-04-reopen-history.png)`)
    const r3 = await askKb('那它通常发生在训练流程的哪个阶段？', 'q2-followup')
    await shot('v2-05-followup-done.png')
    log('q2-answer', r3.answer)
    log('q2-chips', r3.chips.join(' || ') || '(none)')
    {
      const refOk = /mid[- ]?training|中期训练|训练中期/i.test(r3.answer)
      verdict('3b-followup-coref', refOk && !r3.alert,
        `answer mentions mid-training=${refOk} (v2-05-followup-done.png)`)
    }

    // ═══ 4. 存为笔记 ═══
    const notesBefore = await js(`return ${KB}.querySelectorAll('.note-card').length`)
    await js(`
      const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
      const b=last.querySelector('.kb-save-note'); b.click(); return true`)
    await waitFor('saved', `
      const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
      const b=last.querySelector('.kb-save-note')
      return b && b.textContent.includes('已存为笔记')`, 30000, 500)
    const saveBtnState = await js(`
      const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
      const b=last.querySelector('.kb-save-note')
      return JSON.stringify({ text: b.textContent.trim(), disabled: b.disabled })`)
    log('t4-save-btn', saveBtnState)
    // 笔记 Tab（默认即 notes）应出现新笔记
    await waitFor('note appears', `
      const cards=[...${KB}.querySelectorAll('.note-card')]
      return cards.some(c => c.textContent.includes('全库问答') && c.textContent.includes('哪个阶段'))`, 30000, 500)
    const noteInfo = await js(`
      const cards=[...${KB}.querySelectorAll('.note-card')]
      const c=cards.find(x => x.textContent.includes('全库问答') && x.textContent.includes('哪个阶段'))
      const meta=c.querySelector('.kb-note-meta')
      const spans=meta ? [...meta.querySelectorAll('span')].map(s=>s.textContent) : []
      return JSON.stringify({ total: cards.length, metaSpans: spans,
        bodyHead: c.querySelector('.kb-note-body').textContent.slice(0,100) })`)
    const n4 = JSON.parse(noteInfo)
    log('t4-note', noteInfo)
    await shot('v2-06-note-saved.png')
    const sb = JSON.parse(saveBtnState)
    verdict('4-save-as-note',
      sb.text.includes('已存为笔记') && sb.disabled && n4.metaSpans.length >= 2 &&
      n4.metaSpans[0].length > 3 && /\d{4}|\d+\/\d+/.test(n4.metaSpans[1]) && n4.bodyHead.includes('全库问答'),
      `btn="${sb.text}" meta=${JSON.stringify(n4.metaSpans).slice(0,120)} notes ${notesBefore}→${n4.total} (v2-06-note-saved.png)`)

    // ═══ 5. 删除笔记（两步确认 + 3 秒复位）═══
    const findDelBtn = `
      const cards=[...${KB}.querySelectorAll('.note-card')]
      const c=cards.find(x => x.textContent.includes('全库问答') && x.textContent.includes('哪个阶段'))
      const b=c ? [...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')) : null`
    await js(`${findDelBtn} b.click(); return true`)
    await sleep(300)
    const confirmState = await js(`${findDelBtn} return b ? b.textContent.trim() : '(gone)'`)
    log('t5-after-1st-click', confirmState)
    await shot('v2-07-confirm-delete.png')
    await js(`${findDelBtn} b.click(); return true`)
    await waitFor('note deleted', `
      const cards=[...${KB}.querySelectorAll('.note-card')]
      return !cards.some(c => c.textContent.includes('全库问答') && c.textContent.includes('哪个阶段'))`, 15000, 500)
    const afterDel = await js(`return ${KB}.querySelectorAll('.note-card').length`)
    log('t5-notes-after-delete', afterDel)
    await shot('v2-08-after-delete.png')
    verdict('5a-two-step-delete', confirmState.includes('确认删除'),
      `1st click → "${confirmState}", 2nd click → note gone, notes=${afterDel} (v2-07/v2-08)`)
    // 3 秒复位：对另一条笔记点一次后等 3.5s
    const resetTest = await js(`
      const c=${KB}.querySelector('.note-card')
      if (!c) return JSON.stringify({ skipped: true })
      const b=[...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除'))
      b.click()
      return JSON.stringify({ skipped: false, after1st: b.textContent.trim() })`)
    const rt = JSON.parse(resetTest)
    await sleep(3500)
    const afterWait = await js(`
      const c=${KB}.querySelector('.note-card')
      const b=c ? [...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')) : null
      return b ? b.textContent.trim() : '(gone)'`)
    log('t5-reset', JSON.stringify({ ...rt, afterWait }))
    await shot('v2-09-delete-reset.png')
    verdict('5b-confirm-resets-3s',
      !rt.skipped && rt.after1st.includes('确认删除') && afterWait === '删除',
      `1st="${rt.after1st}" after3.5s="${afterWait}" (v2-09-delete-reset.png)`)

    // ═══ 6. 无命中优雅降级 ═══
    const r6 = await askKb('哪篇论文讨论了量子计算？', 'q3-quantum')
    await shot('v2-10-nohit.png')
    log('q3-answer', r6.answer)
    log('q3-chips', r6.chips.join(' || ') || '(none)')
    log('q3-alert', r6.alert || '(none)')
    {
      const noAlert = !r6.alert
      const inThread = r6.answer.length > 10
      verdict('6-nohit-graceful', noAlert && inThread,
        `alert=${noAlert ? 'none' : r6.alert.slice(0,60)} answerInThread=${inThread} (v2-10-nohit.png)`)
    }

    // ═══ 7. z-index：PDF 工具条不穿透模态 ═══
    await closeKb()
    await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
    await sleep(800)
    await js(`const b=[...document.querySelectorAll('button')].find(x => x.textContent.includes('全文 PDF')); if(b) b.click(); return true`)
    try { await waitFor('pdf canvas', `return document.querySelectorAll('section[aria-label="阅读"] canvas').length > 0`, 30000, 1000) } catch (e) { log('t7-pdf', e.message) }
    await sleep(1200)
    await openKb()
    await shot('v2-11-kb-over-pdf.png')
    const zInfo = await js(`
      const tb=document.querySelector('.pdf-toolbar')
      const bd=document.querySelector('.modal-backdrop')
      return JSON.stringify({
        toolbarZ: tb ? getComputedStyle(tb).zIndex : null,
        backdropZ: bd ? getComputedStyle(bd).zIndex : null })`)
    const z7 = JSON.parse(zInfo)
    log('t7-zindex', zInfo)
    verdict('7-zindex', Number(z7.backdropZ) > Number(z7.toolbarZ),
      `toolbar z=${z7.toolbarZ} < backdrop z=${z7.backdropZ}，目检 v2-11-kb-over-pdf.png`)

    // ═══ 8. 清空对话 ═══
    await js(`[...${KB}.querySelectorAll('button')].find(b => b.textContent.trim() === '清空对话').click(); return true`)
    await sleep(400)
    const cleared = await js(`
      return JSON.stringify({
        turns: ${KB}.querySelectorAll('.kb-turn').length,
        clearBtn: ![...${KB}.querySelectorAll('button')].some(b=>b.textContent.trim()==='清空对话'),
        ls: localStorage.getItem('pl.kb.turns') })`)
    const c8 = JSON.parse(cleared)
    log('t8-after-clear', cleared)
    await shot('v2-12-cleared.png')
    await closeKb()
    await openKb()
    await sleep(400)
    const reopened = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    log('t8-after-reopen', reopened)
    await shot('v2-13-reopen-empty.png')
    verdict('8-clear-thread', c8.turns === 0 && c8.ls === null && reopened === 0,
      `cleared turns=${c8.turns} ls=${c8.ls} reopen turns=${reopened} (v2-12/v2-13)`)
    await closeKb()

    log('console-errors', consoleErrors.length ? consoleErrors.join(' ||| ') : '(none)')
    const passed = verdicts.filter(v => v[1]).length
    console.log(`V2_SUMMARY ${passed}/${verdicts.length} passed`)
    console.log('V2_DONE')
  } catch (e) {
    console.log('V2_FATAL ' + (e && e.stack || e))
    try { await shot('v2-99-failure.png') } catch {}
  }
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
  app.exit(0)
})
