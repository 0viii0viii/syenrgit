import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC_EVENT } from '@shared/ipc.js'
import type { UpdateState } from '@shared/ipc.js'

// electron-updater ships CommonJS; the named export is not reachable from ESM.
const { autoUpdater } = electronUpdater

/** How often to look for a new release after the first check. */
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Give the window time to render before spending bandwidth on a check. */
const FIRST_CHECK_DELAY_MS = 8_000

let state: UpdateState = { status: 'idle' }
let timer: NodeJS.Timeout | null = null
let getWindow: () => BrowserWindow | null = () => null

function publish(next: UpdateState): void {
  state = next
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.updateChanged, next)
}

export function currentUpdateState(): UpdateState {
  return state
}

/**
 * Whether this build can update itself.
 *
 * A dev run has no `app-update.yml`, and on macOS Squirrel refuses to swap an
 * app bundle running from outside /Applications — an update would download and
 * then fail at install. Saying so up front beats a download that goes nowhere.
 */
function updatability(): { ok: true } | { ok: false; reason: string } {
  if (!app.isPackaged) return { ok: false, reason: 'Updates are disabled in development' }
  if (process.platform === 'darwin' && app.isInApplicationsFolder?.() === false) {
    return { ok: false, reason: 'Move the app to /Applications to receive updates' }
  }
  return { ok: true }
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  const usable = updatability()
  if (!usable.ok) {
    publish({ status: 'unsupported', reason: usable.reason })
    return
  }

  // Download in the background, but let the user choose when to restart.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => publish({ status: 'idle' }))
  autoUpdater.on('update-available', (info) =>
    publish({ status: 'downloading', version: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (progress) =>
    publish({
      status: 'downloading',
      version: state.status === 'downloading' ? state.version : '',
      percent: Math.round(progress.percent)
    })
  )
  autoUpdater.on('update-downloaded', (info) =>
    publish({ status: 'ready', version: info.version })
  )
  autoUpdater.on('error', (err) => {
    // A failed check must not be fatal: the app works fine without updating,
    // and a transient network error should not surface as a crash.
    publish({ status: 'error', message: err.message })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      publish({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  }

  setTimeout(check, FIRST_CHECK_DELAY_MS)
  timer = setInterval(check, POLL_INTERVAL_MS)
}

/** Manual check, for a "check now" affordance. */
export function checkForUpdatesNow(): void {
  if (state.status === 'unsupported') return
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    publish({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}

/** Quit and install a downloaded update. */
export function installUpdate(): void {
  if (state.status !== 'ready') return
  // isSilent=false so the Windows installer shows progress; isForceRunAfter
  // brings the app back once it finishes.
  autoUpdater.quitAndInstall(false, true)
}

export function stopUpdater(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
