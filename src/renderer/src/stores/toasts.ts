import { create } from 'zustand'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: ToastKind, text: string) => void
  dismiss: (id: number) => void
}

/**
 * The most toasts kept on screen at once.
 *
 * Past a handful the stack is covering the app it is reporting on, and the
 * oldest message is the one you have had the most chance to read.
 */
const MAX_VISIBLE = 4

let nextId = 0

export const useToasts = create<ToastState>((set) => ({
  toasts: [],

  push: (kind, text) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++nextId, kind, text }].slice(-MAX_VISIBLE) })),

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
