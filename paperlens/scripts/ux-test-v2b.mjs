// KB v2 验收续跑：补验 2b/5/6/7/8（上半场已 PASS 1/2a/3a/3b/4）。Run: electron scripts/ux-test-v2b.mjs
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = join(root, 'e2e-shots')
fs.mkdirSync(shotsDir, { recursive: true })

app.setName('paperlens')
app.setPath('userData', join(app.getPath('appData'), 'paperlens'))
await import(join(root, 'out/main/index.js'))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let win
const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`).catch(e => { console.log('V2B_JSERR ' + (e && e.message)); return null })
const verdicts = []
const verdict = (id, pass, detail = '') => { verdicts.push([id, pass]); console.log(`V2B_${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`.trim()) }
const log = (k, v) => console.log('V2B_INFO ' + k + ' :: ' + String(v).replace(/\n/g, ' ⏎ ').slice(0, 1200))

async function getWin() {
  for (let i = 0; i < 100; i++) { const w = BrowserWindow.getAllWindows()[0]; if (w) return w; await sleep(200) }
  throw new Error('no window')
}
async function waitFor(name, body, timeoutMs, pollMs = 500) {
  const t0 = Date.now()
  for (;;) {
    const r = await js(body)
    if (r) return r
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout: ' + name)
    await sleep(pollMs)
  }
}
async function shot(name) { await sleep(350); fs.writeFileSync(join(shotsDir, name), (await win.webContents.capturePage()).toPNG()); console.log('V2B_SHOT ' + name) }

const KB = `document.querySelector('[role="dialog"][aria-label="知识库"]')`
async function openKb() {
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
  await waitFor('kb open', `return !!${KB}`, 5000)
}
async function closeKb() {
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await waitFor('kb closed', `return !${KB}`, 5000)
}

app.whenReady().then(async () => {
  try {
    win = await getWin()
    console.log('V2B_BOOT ok')
    await waitFor('library', `return document.querySelectorAll('nav .paper-item').length > 0`, 30000)

    // ═══ 2b. 打开论文：缓存命中应即时选中 ═══
    await openKb()
    await sleep(800)
    const nTurns = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    log('turns-persisted', nTurns)
    if (Number(nTurns) > 0) {
      await js(`
        const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
        const c=[...last.querySelectorAll('.kb-sources .chip')].filter(x=>!x.classList.contains('kb-save-note'))[0]
        if (c) c.click(); return true`)
      await sleep(400)
      const chipTitle = await js(`
        const last=[...${KB}.querySelectorAll('.kb-turn')].pop()
        const c=[...last.querySelectorAll('.kb-sources .chip')].filter(x=>!x.classList.contains('kb-save-note'))[0]
        return c ? c.textContent.replace(/^\\[来源\\d+\\]\\s*/, '').trim() : ''`)
      const t0 = Date.now()
      await js(`const p=${KB}.querySelector('.kb-source-panel'); if(p){const b=[...p.querySelectorAll('button')].find(x=>x.textContent.includes('打开论文')); if(b) b.click()} return true`)
      let opened = null
      try {
        opened = await waitFor('paper opened', `
          const h = document.querySelector('section[aria-label="阅读"] h2')
          return h && h.textContent.length > 5 ? h.textContent : false`, 8000, 200)
      } catch {}
      const ms = Date.now() - t0
      await shot('v2b-01-open-paper.png')
      log('open-paper', `${ms}ms → "${String(opened).slice(0, 60)}" vs chip "${String(chipTitle).slice(0, 40)}"`)
      const match = opened && chipTitle && (String(opened).includes(String(chipTitle).slice(0, 12)) || String(chipTitle).includes(String(opened).slice(0, 12)))
      verdict('2b-open-paper-fast', !!match && ms < 3000, `${ms}ms match=${!!match} (v2b-01-open-paper.png)`)
    } else {
      verdict('2b-open-paper-fast', false, '无持久化轮次可测（意外）')
    }

    // ═══ 5. 删除笔记：两步确认 + 3 秒复位 ═══
    await openKb()
    await js(`const b=[...${KB}.querySelectorAll('.reader-tabs button')].find(x=>x.textContent.includes('我的笔记')); if (b && !b.disabled) b.click(); return true`)
    await waitFor('notes tab', `return !!${KB}.querySelector('input[placeholder*="搜索笔记"]')`, 5000)
    const hasKbNote = await js(`return [...${KB}.querySelectorAll('.note-card')].some(c => c.textContent.includes('全库问答'))`)
    log('t5-has-qa-note', hasKbNote)
    const FIND = `
      const cards=[...${KB}.querySelectorAll('.note-card')]
      const c=cards.find(x => x.textContent.includes('全库问答'))
      const b=c ? [...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')) : null;`
    const before5 = await js(`return ${KB}.querySelectorAll('.note-card').length`)
    await js(`${FIND} if(b) b.click(); return !!b`)
    await sleep(300)
    const confirmTxt = await js(`${FIND} return b ? b.textContent.trim() : '(gone)'`)
    log('t5-1st-click', confirmTxt)
    await shot('v2b-02-confirm-delete.png')
    await js(`${FIND} if(b) b.click(); return !!b`)
    await waitFor('note deleted', `return ![...${KB}.querySelectorAll('.note-card')].some(c => c.textContent.includes('全库问答'))`, 15000, 500)
    const after5 = await js(`return ${KB}.querySelectorAll('.note-card').length`)
    await shot('v2b-03-after-delete.png')
    verdict('5a-two-step-delete', String(confirmTxt).includes('确认删除') && Number(after5) === Number(before5) - 1,
      `"${confirmTxt}" → 删除成功 ${before5}→${after5} (v2b-02/03)`)
    // 3 秒复位（注意：组件对 document click 也会复位，所以等待期间不要做任何 js 点击——executeJavaScript 不触发 click，安全）
    const rt = await js(`
      const c=${KB}.querySelector('.note-card')
      if (!c) return JSON.stringify({ skipped: true })
      const b=[...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除'))
      b.click()
      return JSON.stringify({ skipped: false, after1st: b.textContent.trim() })`)
    const rtv = JSON.parse(rt)
    await sleep(3500)
    const afterWait = await js(`
      const c=${KB}.querySelector('.note-card')
      const b=c ? [...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')) : null
      return b ? b.textContent.trim() : '(gone)'`)
    log('t5-reset', JSON.stringify({ ...rtv, afterWait }))
    verdict('5b-confirm-resets-3s', !rtv.skipped && rtv.after1st.includes('确认删除') && afterWait === '删除',
      `1st="${rtv.after1st}" after3.5s="${afterWait}"`)

    // ═══ 6. 无命中优雅降级（1 次真实问答）═══
    const SET_INPUT = `
      const __set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};`
    const before6 = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    await js(`${SET_INPUT} __set(${KB}.querySelector('input[placeholder*="向整个论文库提问"]'), '哪篇论文讨论了量子计算？'); return true`)
    await js(`[...${KB}.querySelectorAll('button')].find(b => b.textContent.trim() === '提问').click(); return true`)
    await waitFor('q answered', `
      const d=${KB}; if(!d) return false
      if (d.querySelector('[role="alert"]')) return true
      const turns=d.querySelectorAll('.kb-turn')
      if (turns.length <= ${before6}) return false
      const a=turns[turns.length-1].querySelector('.kb-a')
      return a && a.textContent.length > 5 && !a.textContent.includes('检索并思考中')`, 120000, 1000)
    const r6 = await js(`
      const d=${KB}
      const al=d.querySelector('[role="alert"]')
      const turns=[...d.querySelectorAll('.kb-turn')]
      const a=turns.length ? turns[turns.length-1].querySelector('.kb-a').textContent : ''
      return JSON.stringify({ alert: al ? al.textContent.slice(0,80) : '', answer: a.slice(0,150) })`)
    const r6v = JSON.parse(r6)
    log('t6-nohit', r6)
    await shot('v2b-04-nohit.png')
    verdict('6-nohit-graceful', !r6v.alert && r6v.answer.length > 10, `alert="${r6v.alert || 'none'}" (v2b-04-nohit.png)`)

    // ═══ 7. z-index ═══
    await closeKb()
    await js(`document.querySelectorAll('nav .paper-item')[0].click(); return true`)
    await sleep(800)
    await js(`const b=[...document.querySelectorAll('button')].find(x => x.textContent.includes('全文 PDF')); if(b) b.click(); return true`)
    try { await waitFor('pdf canvas', `return document.querySelectorAll('section[aria-label="阅读"] canvas').length > 0`, 30000, 1000) } catch (e) { log('t7-pdf', e.message) }
    await sleep(1000)
    await openKb()
    await shot('v2b-05-kb-over-pdf.png')
    const z7 = JSON.parse(await js(`
      const tb=document.querySelector('.pdf-toolbar'); const bd=document.querySelector('.modal-backdrop')
      return JSON.stringify({ t: tb?getComputedStyle(tb).zIndex:null, b: bd?getComputedStyle(bd).zIndex:null })`))
    verdict('7-zindex', Number(z7.b) > Number(z7.t), `toolbar=${z7.t} backdrop=${z7.b}，目检 v2b-05`)

    // ═══ 8. 清空对话 ═══
    await js(`const b=[...${KB}.querySelectorAll('button')].find(x => x.textContent.trim() === '清空对话'); if(b) b.click(); return true`)
    await sleep(400)
    const c8 = JSON.parse(await js(`return JSON.stringify({ turns: ${KB}.querySelectorAll('.kb-turn').length, ls: localStorage.getItem('pl.kb.turns') })`))
    await closeKb(); await openKb(); await sleep(400)
    const reopened = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    await shot('v2b-06-cleared.png')
    verdict('8-clear-thread', c8.turns === 0 && c8.ls === null && Number(reopened) === 0,
      `turns=${c8.turns} ls=${c8.ls} reopen=${reopened} (v2b-06-cleared.png)`)
    await closeKb()

    const passed = verdicts.filter(v => v[1]).length
    console.log(`V2B_SUMMARY ${passed}/${verdicts.length} passed`)
  } catch (e) {
    console.log('V2B_FATAL ' + (e && e.stack || e))
    try { await shot('v2b-99-failure.png') } catch {}
  }
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
  app.exit(0)
})
