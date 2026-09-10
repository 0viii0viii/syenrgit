import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type { MergeDocument } from '@shared/git'
import { assembleMerge, isFullyResolved, type Resolution } from '@shared/merge'

interface MergeState {
  path: string | null
  doc: MergeDocument | null
  resolutions: Record<number, Resolution>
  loading: boolean
  saving: boolean
  error: string | null

  open: (root: string, path: string) => Promise<void>
  close: () => void
  setResolution: (chunkId: number, resolution: Resolution) => void
  clearResolution: (chunkId: number) => void
  takeAll: (side: 'ours' | 'theirs') => void
  save: (root: string) => Promise<boolean>
  /** Resolve a whole-file conflict by keeping one side outright. */
  takeSide: (root: string, side: 'ours' | 'theirs') => Promise<boolean>
}

export const useMerge = create<MergeState>((set, get) => ({
  path: null,
  doc: null,
  resolutions: {},
  loading: false,
  saving: false,
  error: null,

  open: async (root, path) => {
    set({ path, loading: true, doc: null, resolutions: {}, error: null })
    try {
      const doc = await window.api.mergeDocument(root, path)
      set({ doc, error: null })
    } catch (err) {
      set({ doc: null, error: describeError(err) })
    } finally {
      set({ loading: false })
    }
  },

  close: () => set({ path: null, doc: null, resolutions: {}, error: null }),

  setResolution: (chunkId, resolution) =>
    set((s) => ({ resolutions: { ...s.resolutions, [chunkId]: resolution } })),

  clearResolution: (chunkId) =>
    set((s) => {
      const next = { ...s.resolutions }
      delete next[chunkId]
      return { resolutions: next }
    }),

  takeAll: (side) =>
    set((s) => {
      if (!s.doc) return s
      const next = { ...s.resolutions }
      for (const chunk of s.doc.chunks) {
        if (chunk.type === 'conflict') next[chunk.id] = { kind: side }
      }
      return { resolutions: next }
    }),

  takeSide: async (root, side) => {
    const { path } = get()
    if (!path) return false
    set({ saving: true })
    try {
      await window.api.takeSide({ cwd: root, path, side })
      set({ error: null })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ saving: false })
    }
  },

  save: async (root) => {
    const { doc, resolutions, path } = get()
    if (!doc || !path) return false
    if (!isFullyResolved(doc.chunks, resolutions)) {
      set({ error: 'Some conflicts are still undecided' })
      return false
    }
    const content = assembleMerge(doc.chunks, resolutions)
    if (content === null) return false

    set({ saving: true })
    try {
      // Writing the file and staging it is what actually marks the path
      // resolved — it collapses the three index stages down to stage 0.
      await window.api.resolveConflict({ cwd: root, path, content })
      set({ error: null })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ saving: false })
    }
  }
}))
