import type { RendererApi } from '@shared/ipc.js'

declare global {
  interface Window {
    api: RendererApi
    platform: { os: NodeJS.Platform; isMac: boolean }
  }
}

export {}
