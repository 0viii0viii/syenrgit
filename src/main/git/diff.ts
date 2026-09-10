import { git } from './exec.js'
import type { DiffHunk, FileDiff } from '@shared/git.js'

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
/** Combined-diff hunk header, emitted for unmerged paths: `@@@ -a,b -c,d +e,f @@@`. */
const COMBINED_HUNK_RE = /^@{3,} /

/**
 * Parse a single-file unified diff. We ask git for one file at a time so the
 * renderer can lazily load diffs as the user selects rows, rather than paying
 * for a whole-repo diff on every status refresh.
 */
export function parseUnifiedDiff(raw: string, path: string): FileDiff {
  const diff: FileDiff = {
    path,
    binary: false,
    combined: false,
    hunks: [],
    additions: 0,
    deletions: 0
  }
  if (!raw.trim()) return diff

  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      diff.binary = true
      return diff
    }

    if (COMBINED_HUNK_RE.test(line)) {
      // An unmerged path. Bail out rather than silently returning zero hunks —
      // the UI must send this file to the merge editor.
      diff.combined = true
      return diff
    }

    const m = HUNK_RE.exec(line)
    if (m) {
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        lines: []
      }
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      diff.hunks.push(hunk)
      continue
    }

    // Everything before the first @@ is the file header.
    if (!hunk) {
      const rename = /^rename from (.*)$/.exec(line)
      if (rename?.[1] !== undefined) diff.origPath = rename[1]
      continue
    }

    const marker = line[0]
    const content = line.slice(1)

    if (marker === '+') {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, content })
      diff.additions++
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'delete', oldLine: oldLine++, newLine: null, content })
      diff.deletions++
    } else if (marker === ' ') {
      hunk.lines.push({
        kind: 'context',
        oldLine: oldLine++,
        newLine: newLine++,
        content
      })
    } else if (marker === '\\') {
      // "\ No newline at end of file" — metadata, consumes no line number.
      hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, content: line })
    }
    // A bare empty string is the trailing split artefact; ignore it.
  }

  return diff
}

export interface DiffRequest {
  cwd: string
  path: string
  /**
   * Previous path for a rename. Required: git detects a rename only when BOTH
   * sides are inside the pathspec, so limiting to the new path alone makes the
   * file look like a wholesale addition.
   */
  origPath?: string
  /** Diff the index against HEAD instead of the worktree against the index. */
  staged?: boolean
  /** Lines of context; git's default is 3. */
  contextLines?: number
}

export async function getFileDiff(req: DiffRequest): Promise<FileDiff> {
  const args = [
    'diff',
    ...(req.staged ? ['--cached'] : []),
    `--unified=${req.contextLines ?? 3}`,
    '--no-color',
    '--find-renames',
    // Without this, `git diff` on an untracked file returns nothing at all.
    '--no-ext-diff',
    '--',
    ...(req.origPath ? [req.origPath] : []),
    req.path
  ]
  const raw = await git(args, { cwd: req.cwd })
  return parseUnifiedDiff(raw, req.path)
}

/** Diff for a file that git does not track yet — compare against /dev/null. */
export async function getUntrackedDiff(cwd: string, path: string): Promise<FileDiff> {
  const raw = await git(
    ['diff', '--no-index', '--unified=3', '--no-color', '--', '/dev/null', path],
    { cwd, okExitCodes: [1] }
  )
  return parseUnifiedDiff(raw, path)
}

export interface CommitDiffRequest {
  cwd: string
  hash: string
  path: string
  origPath?: string
  contextLines?: number
}

/**
 * Diff of a single file as introduced by one commit.
 *
 * `diff-tree` rather than `git show` so the flags below apply cleanly:
 *  --root          a root commit has no parent and would otherwise diff to nothing
 *  -m --first-parent   a merge commit is shown against its first parent
 *  --find-renames  paired with passing both sides of a rename in the pathspec
 */
export async function getCommitFileDiff(req: CommitDiffRequest): Promise<FileDiff> {
  const raw = await git(
    [
      'diff-tree',
      '-p',
      '--root',
      '-m',
      '--first-parent',
      '--no-commit-id',
      '--find-renames',
      '--no-color',
      '--no-ext-diff',
      `--unified=${req.contextLines ?? 3}`,
      req.hash,
      '--',
      ...(req.origPath ? [req.origPath] : []),
      req.path
    ],
    { cwd: req.cwd }
  )
  return parseUnifiedDiff(raw, req.path)
}
