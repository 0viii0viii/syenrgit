import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type { CommitDetail, CommitSummary, FileDiff, GraphRow, RefList } from '@shared/git'

interface HistoryState {
  commits: CommitSummary[]
  graph: GraphRow[]
  graphWidth: number
  refs: RefList | null
  /** Hash of the selected commit. */
  selected: string | null
  detail: CommitDetail | null
  /** Path selected inside the commit detail's file list. */
  selectedFile: string | null
  fileDiff: FileDiff | null
  loading: boolean
  error: string | null
  /**
   * Full ref names the graph is limited to. Empty means every branch, tag and
   * remote — git's own default view of the repository.
   */
  filter: string[]
  /**
   * Show only commits unique to the filtered refs, rather than everything
   * reachable from them. Meaningless with no filter, and ignored there.
   */
  exclusive: boolean

  load: (root: string) => Promise<void>
  setFilter: (root: string, refs: string[]) => Promise<void>
  setExclusive: (root: string, exclusive: boolean) => Promise<void>
  /** Plain click solos a ref; additive toggles it in or out of the set. */
  toggleRef: (root: string, refName: string, additive: boolean) => Promise<void>
  selectCommit: (root: string, hash: string) => Promise<void>
  selectFile: (root: string, path: string) => Promise<void>
  reset: () => void
}

const EMPTY = {
  commits: [],
  graph: [],
  graphWidth: 0,
  refs: null,
  selected: null,
  detail: null,
  selectedFile: null,
  fileDiff: null,
  loading: false,
  error: null,
  filter: [],
  exclusive: false
} satisfies Omit<
  HistoryState,
  | 'load'
  | 'selectCommit'
  | 'selectFile'
  | 'reset'
  | 'setFilter'
  | 'setExclusive'
  | 'toggleRef'
>

export const useHistory = create<HistoryState>((set, get) => ({
  ...EMPTY,

  load: async (root) => {
    set({ loading: true })
    const { filter, exclusive } = get()
    try {
      const [page, refs] = await Promise.all([
        window.api.log({
          cwd: root,
          limit: 500,
          ...(filter.length > 0 ? { revisions: filter, exclusive } : {})
        }),
        window.api.refs(root)
      ])
      set({
        commits: page.commits,
        graph: page.graph,
        graphWidth: page.graphWidth,
        refs,
        error: null
      })

      // Keep the open commit selected across refreshes when it still exists.
      const { selected } = get()
      if (selected && page.commits.some((c) => c.hash === selected)) {
        await get().selectCommit(root, selected)
      } else if (selected) {
        set({ selected: null, detail: null, selectedFile: null, fileDiff: null })
      }
    } catch (err) {
      // A filtered ref can vanish while it is still selected — the branch gets
      // deleted, the tag removed, the remote pruned. Falling back to the full
      // graph beats leaving a stale list sitting behind an error.
      if (filter.length > 0) {
        set({ filter: [], exclusive: false, loading: false })
        await get().load(root)
        return
      }
      set({ error: describeError(err) })
    } finally {
      set({ loading: false })
    }
  },

  setFilter: async (root, refs) => {
    // Dropping the last ref returns to the whole graph, where "only on these"
    // has nothing to mean — leaving it armed would silently change what the
    // next filter shows.
    set({ filter: refs, ...(refs.length === 0 ? { exclusive: false } : {}) })
    await get().load(root)
  },

  setExclusive: async (root, exclusive) => {
    set({ exclusive })
    await get().load(root)
  },

  toggleRef: async (root, refName, additive) => {
    const { filter } = get()
    let next: string[]
    if (additive) {
      next = filter.includes(refName)
        ? filter.filter((r) => r !== refName)
        : [...filter, refName]
    } else {
      // Clicking the ref the graph is already soloed to returns to all refs,
      // so the filter can always be undone from the same place it was set.
      next = filter.length === 1 && filter[0] === refName ? [] : [refName]
    }
    await get().setFilter(root, next)
  },

  selectCommit: async (root, hash) => {
    set({ selected: hash, selectedFile: null, fileDiff: null })
    try {
      const detail = await window.api.commitDetail(root, hash)
      set({ detail, error: null })
    } catch (err) {
      set({ detail: null, error: describeError(err) })
    }
  },

  selectFile: async (root, path) => {
    const { selected, detail } = get()
    if (!selected) return
    set({ selectedFile: path })
    const entry = detail?.files.find((f) => f.path === path)
    try {
      const fileDiff = await window.api.commitDiff({
        cwd: root,
        hash: selected,
        path,
        ...(entry?.origPath ? { origPath: entry.origPath } : {})
      })
      set({ fileDiff, error: null })
    } catch (err) {
      set({ fileDiff: null, error: describeError(err) })
    }
  },

  reset: () => set({ ...EMPTY })
}))
