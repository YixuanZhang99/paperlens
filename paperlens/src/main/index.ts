import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createContainer } from './container'
import { registerIpc } from './ipc'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc(createContainer())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
