import { watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { IPC_EVENT } from '@shared/ipc.js'
import type { ChangeScope } from '@shared/ipc.js'
import { gitCommonDir, gitDir } from './git/repo.js'
import { samePath } from '@shared/paths.js'

/**
 * Paths whose churn must never trigger a status refresh. `.git/index.lock` in
 * particular fires on every git command we ourselves run — reacting to it
 * produces an infinite refresh loop.
 */
const IGNORED_SEGMENTS = new Set(['node_modules', '.DS_Store', 'dist', 'out', '.next'])
const IGNORED_GIT_FILES = [
  'index.lock',
  'COMMIT_EDITMSG',
  'FETCH_HEAD',
  'ORIG_HEAD',
  'objects',
  'logs'
]

const DEBOUNCE_MS = 150

interface RepoWatch {
  watchers: FSWatcher[]
  timer: NodeJS.Timeout | null
  /** Highest-priority scope seen during the current debounce window. */
  pendingScope: ChangeScope | null
}

/**
 * One entry per open repository tab. Background repos stay watched so their
 * cached state can be invalidated instead of being silently stale when the
 * user switches back to them.
 */
const watched = new Map<string, RepoWatch>()

function shouldIgnore(filename: string | null, isGitDir: boolean): boolean {
  if (!filename) return false
  if (isGitDir) {
    return IGNORED_GIT_FILES.some((f) => filename === f || filename.startsWith(`${f}${sep}`))
  }
  return filename.split(sep).some((seg) => IGNORED_SEGMENTS.has(seg))
}

export async function startWatching(
  root: string,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (watched.has(root)) return

  const entry: RepoWatch = { watchers: [], timer: null, pendingScope: null }
  watched.set(root, entry)

  const notify = (scope: ChangeScope): void => {
    // A .git change subsumes a worktree change within the same window: it
    // triggers a superset of the reloads.
    if (scope === 'git' || entry.pendingScope === null) entry.pendingScope = scope
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const scopeToSend = entry.pendingScope ?? 'worktree'
      entry.pendingScope = null
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_EVENT.repoChanged, { root, scope: scopeToSend })
      }
    }, DEBOUNCE_MS)
  }

  const attach = (path: string, isGitDir: boolean): void => {
    try {
      const w = watch(path, { recursive: true }, (_type, filename) => {
        if (shouldIgnore(filename, isGitDir)) return
        notify(isGitDir ? 'git' : 'worktree')
      })
      w.on('error', () => {
        /* watch limits / transient unlink — degrade to manual refresh */
      })
      entry.watchers.push(w)
    } catch {
      /* directory may not exist (e.g. bare repo); ignore */
    }
  }

  // The working tree tells us about file edits; .git tells us about index,
  // HEAD and ref changes made by any other tool (CLI, IDE, another GUI).
  attach(root, false)

  try {
    // Per-worktree state: HEAD, the index, in-progress operation markers.
    const dir = await gitDir(root)
    attach(dir, true)

    // Branches and tags are shared between worktrees and live in the common
    // directory. In a linked worktree that is somewhere else entirely, so
    // watching only `dir` would miss every commit made from a sibling.
    const common = await gitCommonDir(root)
    attach(join(common, 'refs'), true)
    // Compared as paths, not strings: gitDir comes from git with forward
    // slashes while gitCommonDir is resolved through realpath, so on Windows
    // an ordinary repository would otherwise be watched twice.
    if (!samePath(common, dir)) attach(common, true)
  } catch {
    /* not a repo */
  }
}

/** Stop watching one repository, or every repository when root is omitted. */
export function stopWatching(root?: string): void {
  const roots = root === undefined ? [...watched.keys()] : [root]
  for (const key of roots) {
    const entry = watched.get(key)
    if (!entry) continue
    if (entry.timer) clearTimeout(entry.timer)
    for (const w of entry.watchers) {
      try {
        w.close()
      } catch {
        /* already closed */
      }
    }
    watched.delete(key)
  }
}
