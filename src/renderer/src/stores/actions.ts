import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type {
  MergeOutcome,
  PullOutcome,
  RemoteInfo,
  RebaseOutcome,
  RebaseStep,
  SequencerKind,
  SequencerOutcome,
  SequencerStep,
  StashApplyOutcome,
  TodoEntry
} from '@shared/ipc'
import { useHistory } from './history'
import { useRepo } from './repo'

interface ActionState {
  /** In-flight action name, for disabling buttons. */
  busy: string | null
  error: string | null
  /** Last non-error outcome worth telling the user about. */
  notice: string | null
  /** Remotes of the active repository, for the push/fetch targets. */
  remotes: RemoteInfo[]

  clear: () => void
  checkout: (root: string, branch: string) => Promise<boolean>
  merge: (root: string, ref: string, noFastForward: boolean) => Promise<MergeOutcome | null>
  commit: (root: string, message: string, amend?: boolean) => Promise<boolean>
  abort: (root: string, operation: string) => Promise<boolean>
  fetch: (root: string, prune: boolean) => Promise<boolean>
  pull: (root: string, rebase: boolean) => Promise<PullOutcome | null>
  push: (root: string, options: PushArgs) => Promise<boolean>
  pushTags: (root: string, remote: string, tag?: string) => Promise<boolean>
  loadRemotes: (root: string) => Promise<void>
  createBranch: (root: string, options: NewBranchArgs) => Promise<boolean>
  stash: (root: string, message: string, includeUntracked: boolean) => Promise<boolean>
  stashApply: (root: string, ref: string, pop: boolean) => Promise<StashApplyOutcome | null>
  stashDrop: (root: string, ref: string) => Promise<boolean>
  rebase: (root: string, onto: string) => Promise<RebaseOutcome | null>
  rebaseStep: (root: string, step: RebaseStep) => Promise<RebaseOutcome | null>
  sequencer: (
    root: string,
    kind: SequencerKind,
    hashes: string[],
    mainline?: number
  ) => Promise<SequencerOutcome | null>
  sequencerStep: (
    root: string,
    kind: SequencerKind,
    step: SequencerStep
  ) => Promise<SequencerOutcome | null>
  createTag: (root: string, options: NewTagArgs) => Promise<boolean>
  deleteTag: (root: string, name: string) => Promise<boolean>
  deleteBranch: (root: string, name: string, force: boolean) => Promise<boolean>
  runTodo: (root: string, base: string, entries: TodoEntry[]) => Promise<RebaseOutcome | null>
}

export interface NewTagArgs {
  name: string
  /** Commit to tag; defaults to HEAD. */
  target?: string
  /** Given a message, the tag is annotated. */
  message?: string
}

export interface NewBranchArgs {
  name: string
  /** Ref to branch from; defaults to HEAD. */
  startPoint?: string
  checkout?: boolean
}

export interface PushArgs {
  remote: string
  setUpstream?: boolean
  includeTags?: boolean
  forceWithLease?: boolean
}

/**
 * Anything that changes the repository.
 *
 * Every action reloads status, history and refs afterwards rather than
 * patching local state: a merge or a checkout moves HEAD, refs, the index and
 * the worktree at once, and guessing at the result is how a git GUI ends up
 * showing something the repository does not actually contain.
 */
async function reload(root: string): Promise<void> {
  await Promise.all([useRepo.getState().refresh(), useHistory.getState().load(root)])
}

export const useActions = create<ActionState>((set) => ({
  busy: null,
  error: null,
  notice: null,
  remotes: [],

  clear: () => set({ error: null, notice: null }),

  checkout: async (root, branch) => {
    set({ busy: 'checkout', error: null, notice: null })
    try {
      await window.api.checkout(root, branch)
      await reload(root)
      set({ notice: `Switched to ${branch}` })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  merge: async (root, ref, noFastForward) => {
    set({ busy: 'merge', error: null, notice: null })
    try {
      const outcome = await window.api.merge({ cwd: root, ref, noFastForward })
      await reload(root)
      set({
        notice:
          outcome.status === 'conflicts'
            ? `${ref} merged with conflicts — resolve them below`
            : outcome.status === 'up-to-date'
              ? `Already up to date with ${ref}`
              : `Merged ${ref}`
      })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  commit: async (root, message, amend) => {
    set({ busy: 'commit', error: null, notice: null })
    try {
      const created = await window.api.commit({ cwd: root, message, ...(amend ? { amend } : {}) })
      await reload(root)
      set({ notice: amend ? `Amended ${created.shortHash}` : `Committed ${created.shortHash}` })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  stash: async (root, message, includeUntracked) => {
    set({ busy: 'stash', error: null, notice: null })
    try {
      const outcome = await window.api.stashPush({ cwd: root, message, includeUntracked })
      await reload(root)
      set({ notice: outcome.message })
      return outcome.status === 'stashed'
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  stashApply: async (root, ref, pop) => {
    set({ busy: 'stashApply', error: null, notice: null })
    try {
      const outcome = await window.api.stashApply({ cwd: root, ref, pop })
      await reload(root)
      set({ notice: outcome.message })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  stashDrop: async (root, ref) => {
    set({ busy: 'stashDrop', error: null, notice: null })
    try {
      const message = await window.api.stashDrop(root, ref)
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  rebase: async (root, onto) => {
    set({ busy: 'rebase', error: null, notice: null })
    try {
      const outcome = await window.api.rebase({ cwd: root, onto })
      await reload(root)
      set({
        notice:
          outcome.status === 'conflicts'
            ? 'Rebase stopped on a conflict — resolve it, then continue'
            : outcome.status === 'up-to-date'
              ? `Already up to date with ${onto}`
              : outcome.message
      })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  rebaseStep: async (root, step) => {
    set({ busy: `rebase:${step}`, error: null, notice: null })
    try {
      const outcome = await window.api.rebaseStep(root, step)
      await reload(root)
      set({ notice: outcome.message })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  sequencer: async (root, kind, hashes, mainline) => {
    set({ busy: kind, error: null, notice: null })
    try {
      const outcome = await window.api.sequencer({
        cwd: root,
        kind,
        hashes,
        ...(mainline !== undefined ? { mainline } : {})
      })
      await reload(root)
      set({ notice: outcome.message })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  sequencerStep: async (root, kind, step) => {
    set({ busy: `${kind}:${step}`, error: null, notice: null })
    try {
      const outcome = await window.api.sequencerStep(root, kind, step)
      await reload(root)
      set({ notice: outcome.message })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  runTodo: async (root, base, entries) => {
    set({ busy: 'runTodo', error: null, notice: null })
    try {
      const outcome = await window.api.runTodo({ cwd: root, base, entries })
      await reload(root)
      set({ notice: outcome.message })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  createTag: async (root, options) => {
    set({ busy: 'createTag', error: null, notice: null })
    try {
      const message = await window.api.createTag({ cwd: root, ...options })
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  deleteTag: async (root, name) => {
    set({ busy: 'deleteTag', error: null, notice: null })
    try {
      const message = await window.api.deleteTag(root, name)
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  deleteBranch: async (root, name, force) => {
    set({ busy: 'deleteBranch', error: null, notice: null })
    try {
      const message = await window.api.deleteBranch({ cwd: root, name, force })
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  createBranch: async (root, options) => {
    set({ busy: 'createBranch', error: null, notice: null })
    try {
      await window.api.createBranch({ cwd: root, ...options })
      await reload(root)
      set({
        notice:
          options.checkout === false
            ? `Created ${options.name}`
            : `Created and switched to ${options.name}`
      })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  loadRemotes: async (root) => {
    try {
      set({ remotes: await window.api.remotes(root) })
    } catch {
      set({ remotes: [] })
    }
  },

  fetch: async (root, prune) => {
    set({ busy: 'fetch', error: null, notice: null })
    try {
      const message = await window.api.fetch({ cwd: root, prune })
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  pull: async (root, rebase) => {
    set({ busy: 'pull', error: null, notice: null })
    try {
      const outcome = await window.api.pull({ cwd: root, rebase })
      await reload(root)
      set({
        notice:
          outcome.status === 'conflicts'
            ? 'Pulled with conflicts — resolve them below'
            : outcome.status === 'up-to-date'
              ? 'Already up to date'
              : rebase
                ? 'Pulled and rebased'
                : 'Pulled'
      })
      return outcome
    } catch (err) {
      set({ error: describeError(err) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  push: async (root, options) => {
    set({ busy: 'push', error: null, notice: null })
    try {
      const message = await window.api.push({ cwd: root, ...options })
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  pushTags: async (root, remote, tag) => {
    set({ busy: 'pushTags', error: null, notice: null })
    try {
      const message = await window.api.pushTags({
        cwd: root,
        remote,
        ...(tag !== undefined ? { tag } : {})
      })
      await reload(root)
      set({ notice: message })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  },

  abort: async (root, operation) => {
    set({ busy: 'abort', error: null, notice: null })
    try {
      await window.api.abort(root, operation)
      await reload(root)
      set({ notice: `${operation} aborted` })
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: null })
    }
  }
}))
