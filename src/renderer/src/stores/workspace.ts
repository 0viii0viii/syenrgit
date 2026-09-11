import { create } from 'zustand'
import type { CommitDetail, CommitSummary, FileDiff, GraphRow, RefList, RepoStatus } from '@shared/git'
import { useHistory } from './history'
import { useMerge } from './merge'
import { useRepo, type PaneSelection, type WorkspacePane } from './repo'

export interface RepoTab {
  root: string
  /** Last path segment of the root — what the tab shows. */
  name: string
}

/**
 * Everything a tab needs to come back exactly as the user left it.
 *
 * Kept here rather than by making every store repo-keyed: the stores stay
 * single-repo and simple, and this is the only place that knows tabs exist.
 */
interface Snapshot {
  status: RepoStatus | null
  selection: PaneSelection
  diff: FileDiff | null
  focus: WorkspacePane
  commits: CommitSummary[]
  graph: GraphRow[]
  graphWidth: number
  refs: RefList | null
  selected: string | null
  detail: CommitDetail | null
  selectedFile: string | null
  fileDiff: FileDiff | null
  filter: string[]
  exclusive: boolean
  search: import('@shared/ipc').CommitSearch
}

// Deliberately still 'forgit': renaming the key would silently drop the open
// tabs of anyone who used an earlier build.
const STORAGE_KEY = 'forgit.openRepos'

function loadPersisted(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function persist(tabs: RepoTab[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.map((t) => t.root)))
  } catch {
    /* private mode or storage disabled — tabs just do not survive a restart */
  }
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

interface WorkspaceState {
  tabs: RepoTab[]
  activeRoot: string | null
  /** Roots whose snapshot is stale because the repo changed while inactive. */
  stale: Set<string>

  restore: () => Promise<void>
  openDialog: () => Promise<void>
  add: (root: string, options?: { activate?: boolean }) => Promise<void>
  activate: (root: string) => Promise<void>
  close: (root: string) => Promise<void>
  markStale: (root: string) => void
}

function capture(): Snapshot {
  const repo = useRepo.getState()
  const history = useHistory.getState()
  return {
    status: repo.status,
    selection: repo.selection,
    diff: repo.diff,
    focus: repo.focus,
    commits: history.commits,
    graph: history.graph,
    graphWidth: history.graphWidth,
    refs: history.refs,
    selected: history.selected,
    detail: history.detail,
    selectedFile: history.selectedFile,
    fileDiff: history.fileDiff,
    filter: history.filter,
    exclusive: history.exclusive,
    search: history.search
  }
}

function apply(root: string, snapshot: Snapshot): void {
  useRepo.setState({
    root,
    status: snapshot.status,
    selection: snapshot.selection,
    diff: snapshot.diff,
    focus: snapshot.focus,
    error: null
  })
  useHistory.setState({
    commits: snapshot.commits,
    graph: snapshot.graph,
    graphWidth: snapshot.graphWidth,
    refs: snapshot.refs,
    selected: snapshot.selected,
    detail: snapshot.detail,
    selectedFile: snapshot.selectedFile,
    fileDiff: snapshot.fileDiff,
    filter: snapshot.filter,
    exclusive: snapshot.exclusive,
    search: snapshot.search,
    error: null
  })
}

const snapshots = new Map<string, Snapshot>()

/** Guards the one-shot session restore against StrictMode's double mount. */
let restoring = false

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeRoot: null,
  stale: new Set(),

  restore: async () => {
    // React runs mount effects twice under StrictMode, and the dedupe inside
    // add() happens after an await, so without this both passes get through.
    if (restoring) return
    restoring = true

    const roots = loadPersisted()
    const opened: string[] = []
    for (const root of roots) {
      try {
        // A remembered path may have been moved, deleted, or live on a volume
        // that is not mounted yet. One unreachable path must not stop the
        // remaining tabs from coming back.
        const resolved = await window.api.discoverRepo(root)
        if (resolved) {
          await get().add(resolved, { activate: false })
          opened.push(resolved)
        }
      } catch {
        /* skip this tab */
      }
    }
    // Load one repository, not all of them: the others load when first opened.
    const last = opened[opened.length - 1]
    if (last) await get().activate(last)
  },

  openDialog: async () => {
    const root = await window.api.openRepoDialog()
    if (root) await get().add(root)
  },

  add: async (root, options) => {
    const { tabs } = get()
    if (tabs.some((t) => t.root === root)) {
      await get().activate(root)
      return
    }
    const next = [...tabs, { root, name: basename(root) }]
    set({ tabs: next })
    persist(next)

    // Background tabs stay watched so their snapshot can be invalidated rather
    // than going quietly stale. Start the watch but do not block activation on
    // it: attaching recursive watchers spawns git and can take long enough
    // that the new tab visibly appears inactive before selecting itself.
    const watching = window.api.watchRepo(root).catch(() => undefined)
    if (options?.activate !== false) await get().activate(root)
    await watching
  },

  activate: async (root) => {
    const { activeRoot, stale } = get()
    if (activeRoot === root && !stale.has(root)) return

    if (activeRoot && activeRoot !== root) snapshots.set(activeRoot, capture())
    useMerge.getState().close()

    const cached = snapshots.get(root)
    if (cached && !stale.has(root)) {
      apply(root, cached)
      set({ activeRoot: root })
      return
    }

    snapshots.delete(root)
    if (stale.has(root)) {
      const next = new Set(stale)
      next.delete(root)
      set({ stale: next })
    }

    set({ activeRoot: root })
    // `focus` is per-repository state that snapshots restore, so a repository
    // being opened for the first time starts at the default rather than
    // inheriting whatever the previously active repository happened to show.
    useRepo.setState({
      root,
      status: null,
      selection: null,
      diff: null,
      focus: 'changes',
      error: null
    })
    useHistory.getState().reset()
    await Promise.all([useRepo.getState().refresh(), useHistory.getState().load(root)])
  },

  close: async (root) => {
    const { tabs, activeRoot } = get()
    const index = tabs.findIndex((t) => t.root === root)
    if (index === -1) return

    const next = tabs.filter((t) => t.root !== root)
    snapshots.delete(root)
    set({ tabs: next })
    persist(next)
    await window.api.unwatchRepo(root)

    if (activeRoot !== root) return

    // Fall through to the neighbour on the right, as a browser does.
    const successor = next[Math.min(index, next.length - 1)]
    if (successor) {
      set({ activeRoot: null })
      await get().activate(successor.root)
    } else {
      set({ activeRoot: null })
      useRepo.setState({ root: null, status: null, selection: null, diff: null })
      useHistory.getState().reset()
      useMerge.getState().close()
    }
  },

  markStale: (root) =>
    set((s) => {
      if (s.stale.has(root)) return s
      const next = new Set(s.stale)
      next.add(root)
      return { stale: next }
    })
}))
