import { create } from 'zustand'
import type { ThemeSetting, ThemeState } from '@shared/ipc'

interface ThemeStore extends ThemeState {
  load: () => Promise<void>
  set: (setting: ThemeSetting) => Promise<void>
}

/**
 * The class the token layers key on. Applied to the root element rather than
 * body so a portalled popover — which Radix renders outside the app tree —
 * still sees it.
 */
function paint(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  // Tells the engine which scrollbars and form controls to draw.
  document.documentElement.style.colorScheme = resolved
}

export const useTheme = create<ThemeStore>((set) => ({
  setting: 'light',
  resolved: 'light',

  load: async () => {
    const state = await window.api.theme()
    paint(state.resolved)
    set(state)
    // The main process pushes when the OS flips under the 'system' setting.
    window.api.onThemeChanged((next) => {
      paint(next.resolved)
      set(next)
    })
  },

  set: async (setting) => {
    const state = await window.api.setTheme(setting)
    paint(state.resolved)
    set(state)
  }
}))
