import { git, GitError } from './exec.js'
import { listConflicts } from './conflict.js'

export interface StashPushOptions {
  cwd: string
  message?: string
  /** Stash untracked files too; they are left behind otherwise. */
  includeUntracked?: boolean
  /** Keep the index staged after stashing. */
  keepIndex?: boolean
}

export type StashPushOutcome =
  | { status: 'stashed'; message: string }
  | { status: 'nothing-to-stash'; message: string }

export async function stashPush(options: StashPushOptions): Promise<StashPushOutcome> {
  const { cwd, message, includeUntracked, keepIndex } = options
  const args = [
    'stash',
    'push',
    ...(includeUntracked ? ['--include-untracked'] : []),
    ...(keepIndex ? ['--keep-index'] : []),
    ...(message?.trim() ? ['--message', message.trim()] : [])
  ]

  const output = await git(args, { cwd })
  // git says so rather than failing, and it is not an error worth a red banner.
  if (/No local changes to save/i.test(output)) {
    return { status: 'nothing-to-stash', message: 'Nothing to stash' }
  }
  return { status: 'stashed', message: message?.trim() ? `Stashed: ${message.trim()}` : 'Stashed changes' }
}

export type StashApplyOutcome =
  | { status: 'applied'; message: string }
  | { status: 'conflicts'; message: string }

export interface StashApplyOptions {
  cwd: string
  /** e.g. "stash@{0}". */
  ref: string
  /** Drop the stash after applying it. */
  pop?: boolean
}

/**
 * Apply a stash.
 *
 * A conflicting apply is an outcome, not a failure: git leaves the conflicts
 * in the index for the user to resolve. Note that it leaves no MERGE_HEAD
 * behind either, so the repository reports no operation in progress even
 * though there are unmerged paths — conflicted state is detected from the
 * paths themselves.
 *
 * `pop` is deliberately not used when conflicts are possible: git keeps the
 * stash on a conflicting pop anyway, and being explicit means the drop only
 * happens once the apply actually succeeded.
 */
export async function stashApply(options: StashApplyOptions): Promise<StashApplyOutcome> {
  const { cwd, ref, pop } = options

  try {
    await git(['stash', 'apply', ref], { cwd })
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    const conflicts = await listConflicts(cwd)
    if (conflicts.length > 0) {
      return {
        status: 'conflicts',
        message: `${ref} applied with conflicts — the stash was kept`
      }
    }
    throw err
  }

  if (pop) {
    await git(['stash', 'drop', ref], { cwd })
    return { status: 'applied', message: `Popped ${ref}` }
  }
  return { status: 'applied', message: `Applied ${ref}` }
}

export async function stashDrop(cwd: string, ref: string): Promise<string> {
  await git(['stash', 'drop', ref], { cwd })
  return `Dropped ${ref}`
}
