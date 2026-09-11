import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type {
  CommitAuthor,
  CommitDetail,
  CommitSummary,
  FileDiff,
  GraphRow,
  RefList
} from '@shared/git'
import type { CommitSearch } from '@shared/ipc'

interface HistoryState {
  commits: CommitSummary[]
  graph: GraphRow[]
  graphWidth: number
  /** False when the list is a search result rather than contiguous history. */
  contiguous: boolean
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
  /**
   * Active commit search. Empty fields are omitted before the walk, so an
   * all-empty search is the same as no search at all.
   */
  search: CommitSearch
  /** True while a search is narrowing the list, for the empty state to explain. */
  searching: boolean
  /** Everyone who has authored a commit here, for the author filter. */
  authors: CommitAuthor[]
  /** Which repository `authors` describes, so it is fetched once, not per refresh. */
  authorsRoot: string | null

  load: (root: string) => Promise<void>
  loadAuthors: (root: string) => Promise<void>
  setSearch: (root: string, search: CommitSearch) => Promise<void>
  clearSearch: (root: string) => Promise<void>
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
  contiguous: true,
  refs: null,
  selected: null,
  detail: null,
  selectedFile: null,
  fileDiff: null,
  loading: false,
  error: null,
  filter: [],
  exclusive: false,
  search: {},
  searching: false,
  authors: [],
  authorsRoot: null
} satisfies Omit<
  HistoryState,
  | 'load'
  | 'selectCommit'
  | 'selectFile'
  | 'reset'
  | 'setFilter'
  | 'setExclusive'
  | 'setSearch'
  | 'clearSearch'
  | 'toggleRef'
  | 'loadAuthors'
>

export const useHistory = create<HistoryState>((set, get) => ({
  ...EMPTY,

  load: async (root) => {
    set({ loading: true })
    const { filter, exclusive, search } = get()
    // Blank fields would narrow the walk to nothing rather than being ignored.
    const active: CommitSearch = {}
    if (search.message?.trim()) active.message = search.message.trim()
    if (search.author?.trim()) active.author = search.author.trim()
    if (search.hash?.trim()) active.hash = search.hash.trim()
    const searching = Object.keys(active).length > 0

    try {
      const [page, refs] = await Promise.all([
        window.api.log({
          cwd: root,
          limit: 500,
          ...(filter.length > 0 ? { revisions: filter, exclusive } : {}),
          ...(searching ? { search: active } : {})
        }),
        window.api.refs(root)
      ])
      set({
        commits: page.commits,
        graph: page.graph,
        graphWidth: page.graphWidth,
        contiguous: page.contiguous,
        refs,
        searching,
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

  /**
   * Walking history to populate a dropdown is work the user did not ask for,
   * so it happens once per repository rather than on every refresh. A new
   * contributor therefore only appears after a tab switch, which is a fair
   * trade for not re-walking on every commit.
   */
  loadAuthors: async (root) => {
    if (get().authorsRoot === root) return
    // Claim the root before walking, not after: it both collapses concurrent
    // calls for the same repository and lets a slow walk notice that another
    // repository was opened while it was running, so a stale list cannot land
    // on top of a newer one with nothing left to trigger a refetch.
    set({ authorsRoot: root, authors: [] })
    try {
      const authors = await window.api.commitAuthors(root)
      if (get().authorsRoot !== root) return
      set({ authors })
    } catch {
      // A missing author list costs the dropdown its contents and nothing
      // else — `author:` typed into the box still works.
      if (get().authorsRoot === root) set({ authors: [] })
    }
  },

  setSearch: async (root, search) => {
    set({ search })
    await get().load(root)
  },

  clearSearch: async (root) => {
    set({ search: {}, searching: false })
    await get().load(root)
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
