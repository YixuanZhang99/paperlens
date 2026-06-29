import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { createContainer } from './container'
import { registerIpc } from './ipc'

// 全屏时菜单栏/标题栏会从顶部滑下，盖住应用自身的顶栏按钮。
// 这里按主显示器算出菜单栏高度，再加标题栏高度，作为全屏顶部安全留白。
function fullscreenInset(): number {
  try {
    const d = screen.getPrimaryDisplay()
    const menuBar = Math.max(0, Math.round(d.workArea.y - d.bounds.y))
    return menuBar + 28 // 28 ≈ 标题栏滑下高度
  } catch {
    return 52
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  const sendFs = () => {
    if (win.isDestroyed()) return
    win.webContents.send('window:fullscreen', win.isFullScreen() ? fullscreenInset() : 0)
  }
  win.on('enter-full-screen', sendFs)
  win.on('leave-full-screen', sendFs)
  win.webContents.on('did-finish-load', sendFs)
}

app.whenReady().then(() => {
  registerIpc(createContainer())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
