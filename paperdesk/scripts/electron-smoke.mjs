// Electron boot smoke: launches a hidden window with the REAL built preload
// (out/preload/index.mjs) + REAL built renderer (out/renderer/index.html), then
// asserts window.api is exposed with all expected methods and that an IPC
// round-trip (preload.invoke -> ipcMain.handle) actually works. This is exactly
// the runtime wiring that unit tests can't cover (it would have caught the
// preload .js/.mjs path bug: window.api would be undefined).
import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = [
  'getConfig','setConfig','listPapers','getPaperText','getPaperPdf',
  'sendChat','streamChat','addNote','listNotes','syncNote',
]
const done = (code, obj) => { console.log('SMOKE_RESULT ' + JSON.stringify(obj)); app.exit(code) }
const timer = setTimeout(() => done(3, { ok: false, reason: 'timeout' }), 30000)

// stub handler so the preload->ipcMain round-trip can be observed end-to-end
ipcMain.handle('config:get', () => ({ marker: 'from-main', deepseekModel: 'deepseek-chat' }))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1000, height: 700,
    webPreferences: { preload: join(root, 'out/preload/index.mjs'), sandbox: false },
  })
  win.webContents.on('render-process-gone', (_e, d) => { clearTimeout(timer); done(4, { ok: false, reason: 'renderer-gone', detail: d }) })
  try {
    await win.loadFile(join(root, 'out/renderer/index.html'))
    const r = await win.webContents.executeJavaScript(`(async () => {
      const api = window.api
      if (!api) return { ok:false, reason:'window.api is undefined (preload did not load / wrong path)' }
      const methods = Object.keys(api).sort()
      let roundTrip = null, rtErr = null
      try { roundTrip = await api.getConfig() } catch (e) { rtErr = String(e && e.message || e) }
      return { ok:true, methods, roundTrip, rtErr }
    })()`)
    clearTimeout(timer)
    const missing = EXPECTED.filter(m => !(r.methods || []).includes(m))
    const rtOk = r.roundTrip && r.roundTrip.marker === 'from-main'
    done(r.ok && missing.length === 0 && rtOk ? 0 : 1, { ...r, missing, rtOk })
  } catch (e) {
    clearTimeout(timer); done(2, { ok: false, reason: 'load-error', detail: String(e && e.message || e) })
  }
})
app.on('window-all-closed', () => app.quit())
