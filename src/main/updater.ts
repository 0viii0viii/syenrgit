import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC_EVENT } from '@shared/ipc.js'
import type { UpdateState } from '@shared/ipc.js'

// electron-updater ships CommonJS; the named export is not reachable from ESM.
const { autoUpdater } = electronUpdater

const execFileAsync = promisify(execFile)

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
 * Whether Squirrel.Mac would accept an update over this bundle.
 *
 * It refuses anything whose signature it cannot verify, and an unsigned build
 * carries only an ad-hoc linker signature. The failure happens at install time,
 * long after a 130 MB download has completed, and is invisible to the user —
 * so it is detected up front instead.
 *
 * Windows has no equivalent problem: electron-updater skips signature
 * verification when app-update.yml carries no publisherName.
 */
async function macSignatureUsable(): Promise<boolean> {
  try {
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', app.getAppPath()])
    return true
  } catch {
    return false
  }
}

/**
 * Whether this build can update itself.
 *
 * A dev run has no `app-update.yml`, and macOS additionally refuses to swap a
 * bundle running outside /Applications. Saying so up front beats a download
 * that goes nowhere.
 */
async function updatability(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!app.isPackaged) return { ok: false, reason: 'Updates are disabled in development' }

  if (process.platform === 'darwin') {
    if (app.isInApplicationsFolder?.() === false) {
      return { ok: false, reason: 'Move the app to /Applications to receive updates' }
    }
    if (!(await macSignatureUsable())) {
      return {
        ok: false,
        reason: 'This build is unsigned, so macOS will not install updates over it'
      }
    }
  }
  return { ok: true }
}

export async function initUpdater(windowGetter: () => BrowserWindow | null): Promise<void> {
  getWindow = windowGetter

  const usable = await updatability()
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
