import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow } from './window.js'
import { registerIpcHandlers } from './ipc/index.js'
import { stopWatching } from './watcher.js'
import { initUpdater, stopUpdater } from './updater.js'
import { currentTheme, loadTheme, onSystemThemeChange, resolvedTheme } from './theme.js'
import { IPC_EVENT } from '@shared/ipc.js'

let mainWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('dev.syenrgit.app')

  // Before any window exists, so the first paint is already the right theme.
  await loadTheme()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(() => mainWindow)

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  void initUpdater(() => mainWindow)

  // Only fires while the setting is 'system'; pinned themes ignore the OS.
  onSystemThemeChange(() => {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.themeChanged, {
        setting: currentTheme(),
        resolved: resolvedTheme()
      })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    }
  })
})

app.on('window-all-closed', () => {
  stopWatching()
  stopUpdater()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopWatching()
  stopUpdater()
})
