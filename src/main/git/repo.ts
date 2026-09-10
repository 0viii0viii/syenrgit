import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, gitLine, GitError } from './exec.js'
import type { RepoOperation } from '@shared/git.js'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Resolve the repository root for any path inside a working tree. */
export async function discoverRepo(startPath: string): Promise<string | null> {
  try {
    const root = await gitLine(['rev-parse', '--show-toplevel'], { cwd: startPath })
    return root || null
  } catch (err) {
    if (err instanceof GitError) return null
    throw err
  }
}

/** Absolute path to the .git directory (handles worktrees and submodules). */
export async function gitDir(cwd: string): Promise<string> {
  return gitLine(['rev-parse', '--absolute-git-dir'], { cwd })
}

/**
 * Detect an in-progress operation from marker files in .git, mirroring what
 * git's own prompt scripts do. This drives which action bar the UI shows
 * ("Continue rebase" vs "Commit merge").
 */
export async function detectOperation(cwd: string): Promise<RepoOperation> {
  let dir: string
  try {
    dir = await gitDir(cwd)
  } catch {
    return 'none'
  }

  // Both rebase backends leave a directory behind; neither says reliably
  // whether the rebase was interactive, so neither is asked.
  if (await exists(join(dir, 'rebase-merge'))) return 'rebase'
  if (await exists(join(dir, 'rebase-apply'))) return 'rebase'
  if (await exists(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (await exists(join(dir, 'REVERT_HEAD'))) return 'revert'
  if (await exists(join(dir, 'MERGE_HEAD'))) return 'merge'
  if (await exists(join(dir, 'BISECT_LOG'))) return 'bisect'
  return 'none'
}

/**
 * Human-readable labels for the two sides of a conflict.
 *
 * During a rebase the sides are swapped relative to a merge: "ours" is the
 * upstream being replayed onto, "theirs" is the commit being replayed. Getting
 * this backwards in a merge UI causes users to pick the wrong side, so the
 * labels are derived from the actual operation rather than hardcoded.
 */
export async function conflictLabels(
  cwd: string
): Promise<{ ours: string; theirs: string }> {
  const dir = await gitDir(cwd)
  const op = await detectOperation(cwd)

  const readTrimmed = async (p: string): Promise<string | null> => {
    try {
      return (await readFile(p, 'utf8')).trim()
    } catch {
      return null
    }
  }

  if (op === 'rebase') {
    const onto = await readTrimmed(join(dir, 'rebase-merge', 'onto'))
    const head = await readTrimmed(join(dir, 'rebase-merge', 'head-name'))
    return {
      ours: onto ? `${onto.slice(0, 7)} (upstream)` : 'upstream',
      theirs: head?.replace('refs/heads/', '') ?? 'your commit'
    }
  }

  const mergeMsg = await readTrimmed(join(dir, 'MERGE_MSG'))
  const incoming = mergeMsg?.match(/Merge (?:remote-tracking )?branch '([^']+)'/)?.[1]

  let current = 'HEAD'
  try {
    current = await gitLine(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  } catch {
    /* unborn branch */
  }

  return { ours: current, theirs: incoming ?? 'incoming' }
}

/** True if the path is inside a repository with a working tree. */
export async function isRepo(path: string): Promise<boolean> {
  try {
    const out = await gitLine(['rev-parse', '--is-inside-work-tree'], { cwd: path })
    return out === 'true'
  } catch {
    return false
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const name = await gitLine(['symbolic-ref', '--short', 'HEAD'], { cwd })
    return name || null
  } catch {
    return null // detached HEAD
  }
}

export async function listBranches(cwd: string): Promise<string[]> {
  const raw = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd
  })
  return raw.split('\n').filter(Boolean)
}
