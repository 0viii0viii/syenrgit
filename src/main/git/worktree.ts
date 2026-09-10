import { git, GitError } from './exec.js'

/**
 * A checkout of the repository. The first entry is always the main working
 * tree — the one holding the real `.git` directory, which cannot be removed.
 */
export interface Worktree {
  path: string
  /** Full ref name of the checked-out branch, or null when detached. */
  branch: string | null
  /** Short branch name, or the abbreviated hash when detached. */
  label: string
  head: string
  detached: boolean
  /** True for the main working tree, which can never be removed. */
  isMain: boolean
  /** Locked worktrees are skipped by prune; the reason may be empty. */
  locked: { reason: string } | null
  /** Git believes the directory is gone. */
  prunable: boolean
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Records are blank-line separated, and every attribute after `worktree` is
 * optional — a branch line is absent when detached, `locked` carries an
 * optional reason on the same line.
 */
export function parseWorktrees(raw: string): Worktree[] {
  const out: Worktree[] = []
  let current: Partial<Worktree> & { path?: string } = {}

  const flush = (): void => {
    if (current.path === undefined) return
    const branch = current.branch ?? null
    out.push({
      path: current.path,
      branch,
      label: branch
        ? branch.replace(/^refs\/heads\//, '')
        : (current.head ?? '').slice(0, 7),
      head: current.head ?? '',
      detached: current.detached ?? false,
      // The main worktree is always listed first; nothing in the output marks
      // it, so position is the only signal git gives.
      isMain: out.length === 0,
      locked: current.locked ?? null,
      prunable: current.prunable ?? false
    })
    current = {}
  }

  for (const line of raw.split('\n')) {
    if (line === '') {
      flush()
      continue
    }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)

    switch (key) {
      case 'worktree':
        flush()
        current.path = value
        break
      case 'HEAD':
        current.head = value
        break
      case 'branch':
        current.branch = value
        break
      case 'detached':
        current.detached = true
        break
      case 'locked':
        current.locked = { reason: value }
        break
      case 'prunable':
        current.prunable = true
        break
    }
  }
  flush()
  return out
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  return parseWorktrees(await git(['worktree', 'list', '--porcelain'], { cwd }))
}

export interface AddWorktreeOptions {
  cwd: string
  /** Directory to create. Relative paths resolve against the repository. */
  path: string
  /**
   * Existing branch to check out, or the start point for a new one.
   * Omitted with `newBranch` means branch from HEAD.
   */
  ref?: string
  /** Create this branch in the new worktree instead of checking out `ref`. */
  newBranch?: string
  /** Check out a commit without a branch. */
  detach?: boolean
}

/**
 * `git worktree add` checks out a *branch* only when given its short name.
 * Handed a full ref like `refs/heads/x` it treats the argument as a commit-ish
 * and silently detaches HEAD instead — the worktree works, but it is not on
 * the branch the user picked.
 */
function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

/**
 * Create a worktree.
 *
 * A branch can only be checked out in one worktree at a time, and git's
 * refusal names the directory that already holds it — which is the useful part
 * of the message, so it is passed through rather than replaced.
 */
export async function addWorktree(options: AddWorktreeOptions): Promise<string> {
  const { cwd, path, ref, newBranch, detach } = options
  if (path.trim() === '') throw new Error('A directory is required')

  const start = ref === undefined ? undefined : detach ? ref : shortBranchName(ref)

  // Checked against the worktree list rather than by matching git's refusal:
  // the wording changed between 2.39 ("is already checked out at") and 2.55
  // ("is already used by worktree at"), and a message this app depends on
  // should not be one git is free to rephrase.
  const wanted = newBranch ?? (detach ? undefined : start)
  if (wanted !== undefined) {
    const held = (await listWorktrees(cwd)).find(
      (w) => w.branch !== null && shortBranchName(w.branch) === wanted
    )
    if (held) {
      throw new Error(
        `${wanted} is already checked out in ${held.path}. ` +
          'A branch can only be in one worktree at a time.'
      )
    }
  }

  const args = [
    'worktree',
    'add',
    ...(newBranch ? ['-b', newBranch] : []),
    ...(detach ? ['--detach'] : []),
    path.trim(),
    ...(start ? [start] : [])
  ]

  try {
    await git(args, { cwd })
  } catch (err) {
    if (err instanceof GitError) {
      // Git's own text is the most useful thing left to say; the one case
      // worth rewriting was handled before the attempt.
      throw new Error(err.stderr.trim() || err.message, { cause: err })
    }
    throw err
  }

  return newBranch
    ? `Created ${newBranch} in a new worktree`
    : `Added a worktree for ${start ?? 'HEAD'}`
}

export interface RemoveWorktreeOptions {
  cwd: string
  path: string
  /** Remove even when the worktree has uncommitted changes. */
  force?: boolean
}

/**
 * Remove a worktree and its directory.
 *
 * Without `force` git refuses when the directory holds uncommitted work, which
 * is the whole safety of the operation — so the refusal is surfaced as its own
 * message rather than a generic failure.
 */
export async function removeWorktree(options: RemoveWorktreeOptions): Promise<string> {
  const { cwd, path, force } = options

  // Both refusals are decided from the worktree list rather than from git's
  // prose. Its wording is not a contract — "is already checked out at" became
  // "is already used by worktree at" between 2.39 and 2.55 — and a message
  // this app branches on should not be one git is free to rephrase.
  const entry = (await listWorktrees(cwd)).find((w) => w.path === path)
  if (entry?.isMain) throw new Error('The main working tree cannot be removed.')

  try {
    await git(['worktree', 'remove', ...(force ? ['--force'] : []), path], { cwd })
  } catch (err) {
    if (err instanceof GitError) {
      // Git refuses when the directory holds uncommitted work. Rather than
      // matching that sentence, ask the worktree itself.
      if (!force && (await hasUncommittedChanges(path))) {
        throw new Error(
          'That worktree has uncommitted changes. Remove it anyway to discard them.',
          { cause: err }
        )
      }
      throw new Error(err.stderr.trim() || err.message, { cause: err })
    }
    throw err
  }
  return 'Worktree removed'
}

/** True when a worktree holds changes that removing it would throw away. */
async function hasUncommittedChanges(path: string): Promise<boolean> {
  const raw = await git(['status', '--porcelain', '--untracked-files=all'], {
    cwd: path
  }).catch(() => '')
  return raw.trim() !== ''
}

/** Forget worktrees whose directories are gone. */
export async function pruneWorktrees(cwd: string): Promise<string> {
  await git(['worktree', 'prune'], { cwd })
  return 'Pruned missing worktrees'
}

export async function lockWorktree(cwd: string, path: string, reason: string): Promise<string> {
  await git(
    ['worktree', 'lock', ...(reason.trim() ? ['--reason', reason.trim()] : []), path],
    { cwd }
  )
  return 'Worktree locked'
}

export async function unlockWorktree(cwd: string, path: string): Promise<string> {
  await git(['worktree', 'unlock', path], { cwd })
  return 'Worktree unlocked'
}
