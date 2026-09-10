/**
 * Domain types shared between the main process (git execution) and the
 * renderer. Keep this file free of any Node or DOM imports.
 */

/** Single-letter codes as reported by `git status --porcelain=v2`. */
export type GitStatusCode = 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '.'

export type FileState =
  | 'unmodified'
  | 'modified'
  | 'typechanged'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'

export interface FileEntry {
  /** Repo-relative POSIX path. */
  path: string
  /** Previous path for renames/copies. */
  origPath?: string
  /** Change between HEAD and the index. */
  indexState: FileState
  /** Change between the index and the worktree. */
  worktreeState: FileState
  /** True when the entry is in an unmerged (conflicted) state. */
  conflicted: boolean
  /** Similarity score 0-100 for renames/copies. */
  similarity?: number
  /** Submodule marker from porcelain v2, e.g. "SC.." — undefined for files. */
  submodule?: string
}

/** Which side of a conflict a hunk or resolution refers to. */
export type ConflictSide = 'base' | 'ours' | 'theirs'

/** In-progress multi-step operation, from the presence of files in .git. */
/**
 * Interactive and non-interactive rebases are not distinguished: since git
 * 2.26 the merge backend is the default and writes `rebase-merge/interactive`
 * for both, so the marker no longer means what its name says.
 */
export type RepoOperation =
  'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

export interface BranchInfo {
  /** Short name, e.g. "main". Null when HEAD is detached. */
  name: string | null
  /** Full commit id of HEAD, or null in an unborn repo. */
  head: string | null
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
}

export interface RepoStatus {
  root: string
  branch: BranchInfo
  operation: RepoOperation
  files: FileEntry[]
}

export interface DiffLine {
  kind: 'context' | 'add' | 'delete' | 'meta'
  /** Line number on the "before" side, null for additions. */
  oldLine: number | null
  /** Line number on the "after" side, null for deletions. */
  newLine: number | null
  content: string
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  origPath?: string
  /** True when git reported the blob as binary. */
  binary: boolean
  /**
   * True when git emitted a combined diff (`@@@ ... @@@`), which it does for
   * unmerged paths. Combined diffs are not renderable as a two-sided view —
   * the caller must route the file to the merge editor instead.
   */
  combined: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

/**
 * The three index stages of a conflicted file, read via `git show :1:/:2:/:3:`.
 * Any side may be null (e.g. add/add conflicts have no base).
 */
export interface ConflictStages {
  path: string
  base: string | null
  ours: string | null
  theirs: string | null
  /** Ref names for labelling the merge UI, e.g. "HEAD" and "feature/x". */
  oursLabel: string
  theirsLabel: string
}

/** A ref pointing at a commit, as decoded from `git log %D`. */
export interface RefBadge {
  kind: 'head' | 'local' | 'remote' | 'tag'
  /** Short name: "main", "origin/main", "v1.2.0". */
  name: string
  /** True when HEAD points here (`HEAD -> main`). */
  isHead: boolean
}

export interface CommitSummary {
  hash: string
  shortHash: string
  parents: string[]
  subject: string
  authorName: string
  authorEmail: string
  /** Unix seconds. */
  authorDate: number
  refs: RefBadge[]
}

export interface CommitDetail extends CommitSummary {
  body: string
  committerName: string
  committerEmail: string
  committerDate: number
  files: FileEntry[]
  additions: number
  deletions: number
}

/**
 * One line segment in the commit graph, spanning the vertical band between a
 * row and the row below it. Lane indices are stable columns, never compacted,
 * so a line is straight whenever fromLane === toLane.
 */
export interface GraphEdge {
  fromLane: number
  toLane: number
  /** Index into the graph lane palette; caller applies modulo. */
  color: number
}

export interface GraphRow {
  hash: string
  /** Column the commit node sits in. */
  lane: number
  color: number
  isMerge: boolean
  /** Segments drawn between this row and the next. */
  edges: GraphEdge[]
  /** Lanes occupied at this row — drives the graph column width. */
  width: number
}

export interface BranchRef {
  /** Full ref name, e.g. "refs/heads/main". */
  refName: string
  /** Short name, e.g. "main" or "origin/main". */
  name: string
  hash: string
  isHead: boolean
  upstream?: string
  ahead: number
  behind: number
  /** Unix seconds of the tip commit. */
  date: number
  subject: string
}

export interface TagRef {
  /** Full ref name, e.g. "refs/tags/v1.2.0". */
  refName: string
  name: string
  hash: string
  date: number
}

export interface StashEntry {
  /** e.g. "stash@{0}" */
  ref: string
  index: number
  message: string
  date: number
}

export interface RefList {
  local: BranchRef[]
  remote: BranchRef[]
  tags: TagRef[]
  stashes: StashEntry[]
}

/**
 * How a chunk of the file merged.
 *
 * Only 'conflict' needs the user. The other four are decided, but they are
 * still reported so the editor can show *what* was auto-merged — silently
 * folding one side's change into "context" is how people lose work in a
 * merge tool.
 */
export type MergeChunkType =
  | 'unchanged' // all three sides agree
  | 'ours' // only our side changed
  | 'theirs' // only their side changed
  | 'both-same' // both sides made the identical change
  | 'conflict' // both sides changed, differently

export interface MergeChunk {
  /** Stable index into the document's chunk list. */
  id: number
  type: MergeChunkType
  base: string[]
  ours: string[]
  theirs: string[]
}

/**
 * File-level shape of the conflict. A content merge is the common case; the
 * others cannot be resolved line-by-line and need a whole-file decision.
 */
export type MergeKind =
  | 'content'
  | 'add-add' // both sides added the path; there is no base
  | 'deleted-by-us' // we deleted, they modified
  | 'deleted-by-them' // they deleted, we modified
  | 'binary'

export interface MergeDocument {
  path: string
  kind: MergeKind
  oursLabel: string
  theirsLabel: string
  chunks: MergeChunk[]
  conflictCount: number
}
