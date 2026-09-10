import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type { FileDiff, RepoStatus } from '@shared/git'
import { useHistory } from './history'
import { useMerge } from './merge'

export type PaneSelection = { path: string; staged: boolean } | null
export type WorkspaceTab = 'changes' | 'history'

interface RepoState {
  root: string | null
  status: RepoStatus | null
  selection: PaneSelection
  diff: FileDiff | null
  loading: boolean
  error: string | null
  tab: WorkspaceTab

  setTab: (tab: WorkspaceTab) => void
  openRepo: () => Promise<void>
  setRoot: (root: string) => Promise<void>
  refresh: () => Promise<void>
  select: (selection: PaneSelection) => Promise<void>
  stage: (paths: string[]) => Promise<void>
  unstage: (paths: string[]) => Promise<void>
}

export const useRepo = create<RepoState>((set, get) => ({
  root: null,
  status: null,
  selection: null,
  diff: null,
  loading: false,
  error: null,
  tab: 'changes',

  setTab: (tab) => set({ tab }),

  openRepo: async () => {
    const root = await window.api.openRepoDialog()
    if (!root) return
    await get().setRoot(root)
  },

  setRoot: async (root) => {
    set({ root, status: null, selection: null, diff: null, error: null })
    useHistory.getState().reset()
    useMerge.getState().close()
    await window.api.watchRepo(root)
    await Promise.all([get().refresh(), useHistory.getState().load(root)])
  },

  refresh: async () => {
    const { root, selection } = get()
    if (!root) return
    set({ loading: true })
    try {
      const status = await window.api.status(root)
      set({ status, error: null })
      // Keep the open diff in sync with whatever just changed on disk.
      if (selection) await get().select(selection)
    } catch (err) {
      set({ error: describeError(err) })
    } finally {
      set({ loading: false })
    }
  },

  select: async (selection) => {
    const { root, status } = get()
    set({ selection })
    if (!root || !selection) {
      set({ diff: null })
      useMerge.getState().close()
      return
    }
    const entry = status?.files.find((f) => f.path === selection.path)

    // A conflicted path has no two-sided diff to show — git emits a combined
    // diff for it — so it routes to the merge editor instead.
    if (entry?.conflicted) {
      set({ diff: null })
      await useMerge.getState().open(root, selection.path)
      return
    }
    useMerge.getState().close()
    try {
      const diff = await window.api.fileDiff({
        cwd: root,
        path: selection.path,
        staged: selection.staged,
        ...(entry?.origPath ? { origPath: entry.origPath } : {}),
        untracked: entry?.worktreeState === 'untracked'
      })
      set({ diff, error: null })
    } catch (err) {
      set({ diff: null, error: describeError(err) })
    }
  },

  stage: async (paths) => {
    const { root } = get()
    if (!root) return
    await window.api.stage({ cwd: root, paths })
    await get().refresh()
  },

  unstage: async (paths) => {
    const { root } = get()
    if (!root) return
    await window.api.unstage({ cwd: root, paths })
    await get().refresh()
  }
}))
