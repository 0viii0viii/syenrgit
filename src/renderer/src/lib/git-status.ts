import type { FileEntry, FileState } from '@shared/git'

/**
 * Presentation metadata for a file state. The `color` values are Tailwind
 * utilities backed by the git domain tokens, so a retheme never touches this
 * mapping — only tokens/git.css.
 */
interface StateMeta {
  /** Single-letter badge, matching git's own porcelain vocabulary. */
  letter: string
  label: string
  color: string
}

const STATE_META: Record<FileState, StateMeta> = {
  unmodified: { letter: ' ', label: 'Unmodified', color: 'text-content-tertiary' },
  modified: { letter: 'M', label: 'Modified', color: 'text-status-modified' },
  typechanged: { letter: 'T', label: 'Type changed', color: 'text-status-modified' },
  added: { letter: 'A', label: 'Added', color: 'text-status-added' },
  deleted: { letter: 'D', label: 'Deleted', color: 'text-status-deleted' },
  renamed: { letter: 'R', label: 'Renamed', color: 'text-status-renamed' },
  copied: { letter: 'C', label: 'Copied', color: 'text-status-copied' },
  untracked: { letter: '?', label: 'Untracked', color: 'text-status-untracked' },
  ignored: { letter: '!', label: 'Ignored', color: 'text-status-ignored' },
  conflicted: { letter: 'U', label: 'Conflicted', color: 'text-status-conflicted' }
}

export function stateMeta(state: FileState): StateMeta {
  return STATE_META[state]
}

/** The state a single-column file row should display. */
export function primaryState(entry: FileEntry): FileState {
  if (entry.conflicted) return 'conflicted'
  return entry.worktreeState !== 'unmodified' ? entry.worktreeState : entry.indexState
}

export function isStaged(entry: FileEntry): boolean {
  return !entry.conflicted && entry.indexState !== 'unmodified'
}

export function isUnstaged(entry: FileEntry): boolean {
  return entry.conflicted || entry.worktreeState !== 'unmodified'
}

/** Split a repo-relative path into directory and basename for two-tone rendering. */
export function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/')
  if (idx === -1) return { dir: '', name: path }
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) }
}
