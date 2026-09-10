import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, GitError } from './exec.js'
import { gitDir } from './repo.js'
import { listConflicts } from './conflict.js'

export type RebaseOutcome =
  | { status: 'rebased'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }
  | { status: 'stopped'; message: string }

export interface RebaseOptions {
  cwd: string
  /** Ref to replay the current branch onto. */
  onto: string
}

/**
 * Whether a rebase is actually running.
 *
 * The `rebase-merge` / `rebase-apply` directories are the only reliable
 * signal. `REBASE_HEAD` is not: it survives a *successful* rebase that
 * contained a squash or fixup, so testing it reports a finished rebase as
 * still in progress.
 */
export async function isRebaseInProgress(cwd: string): Promise<boolean> {
  try {
    const dir = await gitDir(cwd)
    for (const marker of ['rebase-merge', 'rebase-apply']) {
      try {
        await readFile(join(dir, marker, 'head-name'), 'utf8')
        return true
      } catch {
        /* try the next marker */
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * How far along a stopped rebase is, for the toolbar.
 *
 * git tracks this in `rebase-merge/msgnum` and `end`, which are the same
 * numbers it prints as "1/3" on the command line.
 */
export interface RebaseProgress {
  current: number
  total: number
}

export async function rebaseProgress(cwd: string): Promise<RebaseProgress | null> {
  try {
    const dir = await gitDir(cwd)
    const read = async (name: string): Promise<number> =>
      Number((await readFile(join(dir, 'rebase-merge', name), 'utf8')).trim())
    const current = await read('msgnum')
    const total = await read('end')
    if (!Number.isFinite(current) || !Number.isFinite(total)) return null
    return { current, total }
  } catch {
    return null
  }
}

/**
 * Replay the current branch onto another ref.
 *
 * Conflicts stop the rebase partway through and leave it in progress, which is
 * an outcome the user acts on rather than a failure. Only a refusal to start —
 * dirty worktree, unknown ref — is an error, told apart by whether a rebase is
 * in progress afterwards.
 */
export async function rebaseOnto(options: RebaseOptions): Promise<RebaseOutcome> {
  const { cwd, onto } = options
  try {
    const output = await git(['rebase', onto], { cwd })
    if (/is up to date|up to date with/i.test(output)) {
      return { status: 'up-to-date', message: output.trim() }
    }
    return { status: 'rebased', message: `Rebased onto ${onto}` }
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (await isRebaseInProgress(cwd)) {
      const conflicts = await listConflicts(cwd)
      return conflicts.length > 0
        ? { status: 'conflicts', message: `Rebase stopped on a conflict` }
        : { status: 'stopped', message: 'Rebase stopped' }
    }
    throw err
  }
}

export type RebaseStep = 'continue' | 'skip' | 'abort'

/**
 * Advance a stopped rebase.
 *
 * `--continue` needs the resolution staged, and it re-stops on the next
 * conflict, so the same three outcomes apply as when starting.
 */
export async function rebaseStep(cwd: string, step: RebaseStep): Promise<RebaseOutcome> {
  try {
    // `git rebase --continue` would open an editor for the commit message;
    // core.editor=true in exec.ts makes that a no-op.
    await git(['rebase', `--${step}`], { cwd })
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (await isRebaseInProgress(cwd)) {
      const conflicts = await listConflicts(cwd)
      return conflicts.length > 0
        ? { status: 'conflicts', message: 'Rebase stopped on another conflict' }
        : { status: 'stopped', message: err.stderr.trim() || 'Rebase stopped' }
    }
    throw err
  }

  if (await isRebaseInProgress(cwd)) {
    const conflicts = await listConflicts(cwd)
    return conflicts.length > 0
      ? { status: 'conflicts', message: 'Rebase stopped on another conflict' }
      : { status: 'stopped', message: 'Rebase paused' }
  }

  return {
    status: 'rebased',
    message: step === 'abort' ? 'Rebase aborted' : 'Rebase finished'
  }
}
