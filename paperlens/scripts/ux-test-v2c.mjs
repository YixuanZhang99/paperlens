// 补验 5b（确认态 3 秒复位）与 8（清空对话）——修正上版脚本的读时机/断言。无 AI 调用。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
app.setName('paperlens')
app.setPath('userData', join(app.getPath('appData'), 'paperlens'))
await import(join(root, 'out/main/index.js'))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let win
const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`).catch(e => { console.log('V2C_JSERR ' + (e && e.message)); return null })
async function getWin() { for (let i = 0; i < 100; i++) { const w = BrowserWindow.getAllWindows()[0]; if (w) return w; await sleep(200) } throw new Error('no window') }
async function waitFor(name, body, timeoutMs, pollMs = 400) {
  const t0 = Date.now()
  for (;;) { const r = await js(body); if (r) return r; if (Date.now() - t0 > timeoutMs) throw new Error('timeout: ' + name); await sleep(pollMs) }
}
const shot = async (name) => { await sleep(300); fs.writeFileSync(join(root, 'e2e-shots', name), (await win.webContents.capturePage()).toPNG()); console.log('V2C_SHOT ' + name) }
const KB = `document.querySelector('[role="dialog"][aria-label="知识库"]')`

app.whenReady().then(async () => {
  try {
    win = await getWin()
    await waitFor('library', `return document.querySelectorAll('nav .paper-item').length > 0`, 30000)
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
    await waitFor('kb open', `return !!${KB}`, 5000)
    await js(`const b=[...${KB}.querySelectorAll('.reader-tabs button')].find(x=>x.textContent.includes('我的笔记')); if (b && !b.disabled) b.click(); return true`)
    await waitFor('notes tab', `return !!${KB}.querySelector('input[placeholder*="搜索笔记"]')`, 5000)

    // 5b：点一次删除 → 单独 eval 读确认态 → 等 3.5s → 读复位态
    await js(`const c=${KB}.querySelector('.note-card'); const b=[...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')); b.click(); return true`)
    await sleep(300)
    const t1 = await js(`const c=${KB}.querySelector('.note-card'); const b=[...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')); return b.textContent.trim()`)
    await shot('v2c-01-confirm-state.png')
    await sleep(3400)
    const t2 = await js(`const c=${KB}.querySelector('.note-card'); const b=[...c.querySelectorAll('button')].find(x=>x.textContent.includes('删除')); return b.textContent.trim()`)
    const p5 = t1 === '确认删除？' && t2 === '删除'
    console.log(`V2C_${p5 ? 'PASS' : 'FAIL'} 5b-confirm-resets-3s 1st="${t1}" after3.5s="${t2}" (v2c-01)`)

    // 8：清空对话 → turns=0 且 localStorage 为 null 或 '[]' → 重开仍 0
    const hasTurns = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    if (Number(hasTurns) === 0) {
      // 上轮已清空——构造一轮假对话注入 localStorage 再重开模态验证清空路径
      await js(`localStorage.setItem('pl.kb.turns', JSON.stringify([{q:'测试问题',a:'测试答案',sources:[]}])); return true`)
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true`)
      await waitFor('kb closed', `return !${KB}`, 5000)
      await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
      await waitFor('kb reopen', `return ${KB} && ${KB}.querySelectorAll('.kb-turn').length === 1`, 5000)
    }
    await js(`const b=[...${KB}.querySelectorAll('button')].find(x => x.textContent.trim() === '清空对话'); if(b) b.click(); return true`)
    await sleep(400)
    const c8 = JSON.parse(await js(`return JSON.stringify({ turns: ${KB}.querySelectorAll('.kb-turn').length, ls: localStorage.getItem('pl.kb.turns') })`))
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true`)
    await waitFor('kb closed2', `return !${KB}`, 5000)
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('知识库')).click(); return true`)
    await waitFor('kb reopen2', `return !!${KB}`, 5000)
    await sleep(400)
    const reopened = await js(`return ${KB}.querySelectorAll('.kb-turn').length`)
    await shot('v2c-02-cleared.png')
    const lsOk = c8.ls === null || c8.ls === '[]'
    const p8 = c8.turns === 0 && lsOk && Number(reopened) === 0
    console.log(`V2C_${p8 ? 'PASS' : 'FAIL'} 8-clear-thread turns=${c8.turns} ls=${JSON.stringify(c8.ls)} reopen=${reopened} (v2c-02)`)
    console.log('V2C_SUMMARY done')
  } catch (e) {
    console.log('V2C_FATAL ' + (e && e.stack || e))
  }
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
  app.exit(0)
})
