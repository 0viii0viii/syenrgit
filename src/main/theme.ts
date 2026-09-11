import { app, nativeTheme } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ThemeSetting } from '@shared/ipc.js'

/**
 * The theme lives in the main process so the window can be painted correctly
 * before the renderer has run. Restoring it in the renderer means a flash of
 * the wrong theme on every launch.
 */
const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

let current: ThemeSetting = 'light'

export function currentTheme(): ThemeSetting {
  return current
}

/** What the setting resolves to right now, following the OS when told to. */
export function resolvedTheme(): 'light' | 'dark' {
  if (current === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return current
}

export async function loadTheme(): Promise<ThemeSetting> {
  try {
    const raw = await readFile(SETTINGS_FILE(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const value = (parsed as { theme?: unknown }).theme
    if (value === 'light' || value === 'dark' || value === 'system') current = value
  } catch {
    // No settings yet, or unreadable: light is the default and a bad file is
    // not worth refusing to start over.
  }
  apply()
  return current
}

export async function setTheme(next: ThemeSetting): Promise<void> {
  current = next
  apply()
  try {
    const file = SETTINGS_FILE()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ theme: next }, null, 2), 'utf8')
  } catch {
    // Persisting is a convenience; failing to write must not break the switch.
  }
}

/**
 * Tell Electron itself, not just the page.
 *
 * `nativeTheme.themeSource` drives the window frame, the native scrollbars and
 * any OS dialog the app opens — all of which would otherwise stay on the
 * system theme while the page followed the setting.
 */
function apply(): void {
  nativeTheme.themeSource = current
}

/** Fires when the OS flips while the setting is 'system'. */
export function onSystemThemeChange(listener: () => void): () => void {
  const handler = (): void => {
    if (current === 'system') listener()
  }
  nativeTheme.on('updated', handler)
  return () => {
    nativeTheme.off('updated', handler)
  }
}
