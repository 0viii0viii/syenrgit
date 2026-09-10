import { git, gitLine, GitError } from './exec.js'
import { listConflicts } from './conflict.js'

/**
 * Cherry-pick and revert are git's "sequencer" operations: both replay commits
 * one at a time, both stop on a conflict, and both are driven afterwards with
 * --continue / --skip / --abort. They share this module for that reason.
 */
export type SequencerKind = 'cherry-pick' | 'revert'

export type SequencerOutcome =
  | { status: 'done'; message: string }
  | { status: 'conflicts'; message: string }
  | { status: 'empty'; message: string }

export interface SequencerOptions {
  cwd: string
  kind: SequencerKind
  /** Commits to replay, oldest first. */
  hashes: string[]
  /**
   * Which parent to treat as the mainline when the commit is a merge. Git
   * refuses to replay a merge without being told, since "the change" a merge
   * introduces depends on which side you read it from.
   */
  mainline?: number
}

const VERB: Record<SequencerKind, string> = {
  'cherry-pick': 'Cherry-picked',
  revert: 'Reverted'
}

async function inProgress(cwd: string, kind: SequencerKind): Promise<boolean> {
  const ref = kind === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD'
  const found = await gitLine(['rev-parse', '--verify', '--quiet', ref], { cwd }).catch(() => '')
  return found !== ''
}

/** True when the commit has more than one parent. */
export async function isMergeCommit(cwd: string, hash: string): Promise<boolean> {
  const parents = await gitLine(['rev-list', '--parents', '-n1', hash], { cwd })
  return parents.trim().split(/\s+/).length > 2
}

export async function runSequencer(options: SequencerOptions): Promise<SequencerOutcome> {
  const { cwd, kind, hashes, mainline } = options
  if (hashes.length === 0) throw new Error('No commits selected')

  const args = [
    kind,
    ...(mainline !== undefined ? ['--mainline', String(mainline)] : []),
    // Without this a commit whose change is already present aborts the whole
    // run with a lecture; skipping it is what the user meant.
    '--no-edit',
    ...hashes
  ]

  try {
    const output = await git(args, { cwd })
    if (/nothing to commit|no changes/i.test(output)) {
      return { status: 'empty', message: 'Nothing to apply — the change is already present' }
    }
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (await inProgress(cwd, kind)) {
      const conflicts = await listConflicts(cwd)
      return {
        status: 'conflicts',
        message:
          conflicts.length > 0
            ? `${kind} stopped on a conflict — resolve it, then continue`
            : `${kind} stopped`
      }
    }
    throw err
  }

  const count = hashes.length
  return {
    status: 'done',
    message: `${VERB[kind]} ${count} commit${count === 1 ? '' : 's'}`
  }
}

export type SequencerStep = 'continue' | 'skip' | 'abort'

export async function sequencerStep(
  cwd: string,
  kind: SequencerKind,
  step: SequencerStep
): Promise<SequencerOutcome> {
  try {
    await git([kind, `--${step}`], { cwd })
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (await inProgress(cwd, kind)) {
      return { status: 'conflicts', message: `${kind} stopped on another conflict` }
    }
    throw err
  }

  if (await inProgress(cwd, kind)) {
    return { status: 'conflicts', message: `${kind} stopped on another conflict` }
  }
  return {
    status: 'done',
    message: step === 'abort' ? `${kind} aborted` : `${kind} finished`
  }
}
