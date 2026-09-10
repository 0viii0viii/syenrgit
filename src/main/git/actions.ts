import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, gitLine, GitError } from './exec.js'
import { gitDir } from './repo.js'

export interface CheckoutResult {
  branch: string
}

/**
 * Switch branches.
 *
 * `switch` rather than `checkout`: it refuses to silently detach HEAD on a
 * path-like argument, which `checkout` will happily do with a branch name that
 * collides with a file.
 */
export async function checkoutBranch(cwd: string, branch: string): Promise<CheckoutResult> {
  await git(['switch', '--', branch], { cwd })
  return { branch }
}

export interface CreateBranchOptions {
  cwd: string
  name: string
  /** Ref to branch from; defaults to HEAD. */
  startPoint?: string
  /** Switch to the new branch after creating it. */
  checkout?: boolean
}

/**
 * Create a branch.
 *
 * `switch --create` when checking out, `branch` when not: the second form
 * leaves the working tree alone, which is what makes "branch from that commit
 * without leaving what I am doing" possible.
 */
export async function createBranch(options: CreateBranchOptions): Promise<CheckoutResult> {
  const { cwd, name, startPoint, checkout = true } = options
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('A branch name is required')

  const args = checkout
    ? ['switch', '--create', trimmed, ...(startPoint ? [startPoint] : [])]
    : ['branch', trimmed, ...(startPoint ? [startPoint] : [])]

  await git(args, { cwd })
  return { branch: trimmed }
}

/**
 * Validate a branch name the way git does, so the dialog can refuse a bad name
 * before it becomes an error message.
 */
export async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') return false
  try {
    await git(['check-ref-format', '--branch', trimmed], { cwd })
    return true
  } catch {
    return false
  }
}

export interface MergeOptions {
  cwd: string
  /** Ref to merge into the current branch. */
  ref: string
  /** Always create a merge commit, even when a fast-forward is possible. */
  noFastForward?: boolean
}

export type MergeOutcome =
  | { status: 'merged'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }

/**
 * Merge a ref into the current branch.
 *
 * Conflicts are a normal outcome, not a failure: git exits non-zero and leaves
 * the merge in progress for the user to resolve. Only a refusal to start —
 * dirty worktree, unknown ref, unrelated histories — is an error.
 */
export async function mergeRef(options: MergeOptions): Promise<MergeOutcome> {
  const { cwd, ref, noFastForward } = options

  const args = ['merge', '--no-edit', ...(noFastForward ? ['--no-ff'] : []), ref]

  let output: string
  try {
    output = await git(args, { cwd })
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    // A conflicted merge leaves MERGE_HEAD behind; anything else is a real
    // failure that never started a merge at all.
    if (await isMerging(cwd)) {
      return { status: 'conflicts', message: err.stderr.trim() || err.message }
    }
    throw err
  }

  if (/Already up to date/i.test(output)) {
    return { status: 'up-to-date', message: output.trim() }
  }
  return { status: 'merged', message: output.trim() }
}

export async function isMerging(cwd: string): Promise<boolean> {
  try {
    const dir = await gitDir(cwd)
    await readFile(join(dir, 'MERGE_HEAD'), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * The message git prepared for an in-progress merge, used to prefill the
 * commit box so the user does not retype what git already wrote.
 */
export async function mergeMessage(cwd: string): Promise<string | null> {
  try {
    const dir = await gitDir(cwd)
    const raw = await readFile(join(dir, 'MERGE_MSG'), 'utf8')
    // Strip the commented "Conflicts:" block git appends; it is guidance for
    // an editor session, not part of the message.
    return raw
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim()
  } catch {
    return null
  }
}

export interface CommitOptions {
  cwd: string
  message: string
  /** Replace the previous commit instead of adding one. */
  amend?: boolean
}

export interface CommitResult {
  hash: string
  shortHash: string
}

/**
 * Create a commit.
 *
 * Hooks are deliberately left enabled — running the user's pre-commit and
 * commit-msg hooks exactly as the command line would is the whole reason this
 * app shells out to git instead of linking a library.
 */
export async function createCommit(options: CommitOptions): Promise<CommitResult> {
  const { cwd, message, amend } = options
  const trimmed = message.trim()
  if (trimmed === '') throw new Error('A commit message is required')

  await git(['commit', ...(amend ? ['--amend'] : []), '-m', trimmed], { cwd })
  const hash = await gitLine(['rev-parse', 'HEAD'], { cwd })
  return { hash, shortHash: hash.slice(0, 7) }
}

/** Abandon an in-progress merge and restore the pre-merge worktree. */
export async function abortMerge(cwd: string): Promise<void> {
  await git(['merge', '--abort'], { cwd })
}

/** Abandon an in-progress rebase, cherry-pick or revert. */
export async function abortOperation(cwd: string, operation: string): Promise<void> {
  switch (operation) {
    case 'merge':
      await git(['merge', '--abort'], { cwd })
      return
    case 'rebase':
      await git(['rebase', '--abort'], { cwd })
      return
    case 'cherry-pick':
      await git(['cherry-pick', '--abort'], { cwd })
      return
    case 'revert':
      await git(['revert', '--abort'], { cwd })
      return
    default:
      throw new Error(`Nothing to abort for "${operation}"`)
  }
}

export interface CreateTagOptions {
  cwd: string
  name: string
  /** Commit to tag; defaults to HEAD. */
  target?: string
  /**
   * Annotated tags carry a tagger, a date and a message, and are what
   * `git describe` and most release tooling expect. A lightweight tag is just
   * a ref, so it is only created when no message is given.
   */
  message?: string
}

export async function createTag(options: CreateTagOptions): Promise<string> {
  const { cwd, name, target, message } = options
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('A tag name is required')

  const annotated = Boolean(message?.trim())
  const args = [
    'tag',
    ...(annotated ? ['--annotate', '--message', message!.trim()] : []),
    trimmed,
    ...(target ? [target] : [])
  ]
  await git(args, { cwd })
  return `Created ${annotated ? 'annotated ' : ''}tag ${trimmed}`
}

export async function deleteTag(cwd: string, name: string): Promise<string> {
  await git(['tag', '--delete', name], { cwd })
  return `Deleted tag ${name}`
}

/** True when a name is legal for `git tag`. */
export async function isValidTagName(cwd: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') return false
  try {
    await git(['check-ref-format', `refs/tags/${trimmed}`], { cwd })
    return true
  } catch {
    return false
  }
}

export interface DeleteBranchOptions {
  cwd: string
  name: string
  /** Delete even when the branch is not merged anywhere. */
  force?: boolean
}

/**
 * Delete a local branch.
 *
 * The unforced form refuses to drop commits that exist nowhere else, which is
 * the whole safety of the operation — so the caller distinguishes "refused
 * because unmerged" from a real failure and can offer the forced form.
 */
export async function deleteBranch(options: DeleteBranchOptions): Promise<string> {
  const { cwd, name, force } = options
  try {
    await git(['branch', '--delete', ...(force ? ['--force'] : []), name], { cwd })
  } catch (err) {
    if (err instanceof GitError) {
      // Decided by asking whether the branch is contained anywhere else, not
      // by matching git's sentence — its wording is not a contract.
      if (!force && !(await isBranchMerged(cwd, name))) {
        throw new Error(
          `${name} has commits that exist nowhere else. Delete it anyway to discard them.`,
          { cause: err }
        )
      }
      throw new Error(err.stderr.trim() || err.message, { cause: err })
    }
    throw err
  }
  return `Deleted branch ${name}`
}

/**
 * True when the branch's tip is contained in some other ref, so deleting it
 * would not orphan any commit.
 *
 * `--contains`, not `--merged`: the latter answers the opposite question —
 * which refs are merged *into* this one.
 */
export async function isBranchMerged(cwd: string, name: string): Promise<boolean> {
  const raw = await git(
    [
      'for-each-ref',
      '--format=%(refname)',
      `--contains=refs/heads/${name}`,
      'refs/heads',
      'refs/remotes'
    ],
    { cwd }
  ).catch(() => '')

  // A branch always contains itself; any other ref means the commits survive.
  return raw
    .split('\n')
    .filter(Boolean)
    .some((ref) => ref !== `refs/heads/${name}`)
}

/** The message of the commit at HEAD, for prefilling an amend. */
export async function headCommitMessage(cwd: string): Promise<string | null> {
  try {
    return (await git(['log', '-1', '--format=%B'], { cwd })).trim()
  } catch {
    // An unborn branch has no HEAD to amend.
    return null
  }
}
