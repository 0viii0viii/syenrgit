import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc.js'
import type {
  CommitDiffRequest,
  CommitRequest,
  CreateBranchRequest,
  FetchRequest,
  MergeRequest,
  PullRequest,
  PushRequest,
  PushTagsRequest,
  CreateTagRequest,
  AddWorktreeRequest,
  PatchRequest,
  PatchSelection,
  RemoveWorktreeRequest,
  DeleteBranchRequest,
  RebaseRequest,
  RebaseStep,
  RunTodoRequest,
  SequencerKind,
  SequencerRequest,
  SequencerStep,
  StashApplyRequest,
  StashPushRequest,
  DiffFileRequest,
  LogPageRequest,
  ResolveRequest,
  StageRequest,
  TakeSideRequest
} from '@shared/ipc.js'
import { git, GitError } from '../git/exec.js'
import { discoverRepo } from '../git/repo.js'
import { getStatus } from '../git/status.js'
import { getCommitFileDiff, getFileDiff, getUntrackedDiff } from '../git/diff.js'
import { getCommitDetail, getLog } from '../git/log.js'
import { buildGraph, graphWidth, isContiguousHistory } from '../git/graph.js'
import { listRefs } from '../git/refs.js'
import { getMergeDocument } from '../git/merge.js'
import { stashApply, stashDrop, stashPush } from '../git/stash.js'
import { rebaseOnto, rebaseProgress, rebaseStep } from '../git/rebase.js'
import { isMergeCommit, runSequencer, sequencerStep } from '../git/sequencer.js'
import { buildTodo, runInteractiveRebase } from '../git/interactive.js'
import {
  fetchRemote,
  listRemotes,
  pullCurrent,
  pushBranch,
  pushTags
} from '../git/remote.js'
import {
  abortOperation,
  checkoutBranch,
  createBranch,
  createCommit,
  createTag,
  deleteBranch,
  headCommitMessage,
  deleteTag,
  isBranchMerged,
  isValidBranchName,
  isValidTagName,
  mergeMessage,
  mergeRef
} from '../git/actions.js'
import {
  getConflictStages,
  listConflicts,
  resolveConflict,
  takeSide
} from '../git/conflict.js'
import { startWatching, stopWatching } from '../watcher.js'
import { checkForUpdatesNow, currentUpdateState, installUpdate } from '../updater.js'
import {
  addWorktree,
  listWorktrees,
  lockWorktree,
  pruneWorktrees,
  removeWorktree,
  unlockWorktree
} from '../git/worktree.js'
import {
  discardFile,
  discardPartial,
  readPatch,
  stagePartial,
  unstagePartial,
  type Selection
} from '../git/patch.js'

/**
 * Wrap a handler so GitError surfaces to the renderer as a clean message.
 * Electron serialises thrown errors by stringifying them, which would
 * otherwise leak the full argv (including any `-c` config we injected).
 */
function handle<T extends unknown[], R>(
  channel: string,
  fn: (...args: T) => Promise<R>
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as T))
    } catch (err) {
      if (err instanceof GitError) {
        // Re-throw the message only: Electron serialises errors by
        // stringifying them, and GitError carries the full argv.
        throw new Error(err.message, { cause: err })
      }
      throw err
    }
  })
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  handle(IPC.dialogOpenRepo, async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Open Repository'
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    if (result.canceled || result.filePaths.length === 0) return null
    return discoverRepo(result.filePaths[0]!)
  })

  /** The renderer sends a plain object; the git layer wants a Map of Sets. */
  const toSelection = (selection: PatchSelection): Selection => ({
    hunks: new Map(
      Object.entries(selection).map(([index, picked]) => [
        Number(index),
        picked === 'all' ? ('all' as const) : new Set(picked)
      ])
    )
  })

  handle(IPC.patchRead, async (cwd: string, path: string, stagedSide: boolean) => {
    const patch = await readPatch(cwd, path, stagedSide ? 'index' : 'worktree')
    if (!patch) return null
    return {
      path,
      hunks: patch.hunks.map((h) => ({
        header: h.header,
        oldStart: h.oldStart,
        newStart: h.newStart,
        lines: h.lines
      }))
    }
  })
  handle(IPC.patchStage, (req: PatchRequest) =>
    stagePartial({ cwd: req.cwd, path: req.path, selection: toSelection(req.selection) })
  )
  handle(IPC.patchUnstage, (req: PatchRequest) =>
    unstagePartial({ cwd: req.cwd, path: req.path, selection: toSelection(req.selection) })
  )
  handle(IPC.patchDiscard, (req: PatchRequest) =>
    discardPartial({ cwd: req.cwd, path: req.path, selection: toSelection(req.selection) })
  )
  handle(IPC.discardFile, (cwd: string, path: string) => discardFile(cwd, path))

  handle(IPC.worktreeList, (cwd: string) => listWorktrees(cwd))
  handle(IPC.worktreeAdd, (req: AddWorktreeRequest) =>
    addWorktree({
      cwd: req.cwd,
      path: req.path,
      ...(req.ref !== undefined ? { ref: req.ref } : {}),
      ...(req.newBranch !== undefined ? { newBranch: req.newBranch } : {}),
      ...(req.detach !== undefined ? { detach: req.detach } : {})
    })
  )
  handle(IPC.worktreeRemove, (req: RemoveWorktreeRequest) =>
    removeWorktree({
      cwd: req.cwd,
      path: req.path,
      ...(req.force !== undefined ? { force: req.force } : {})
    })
  )
  handle(IPC.worktreePrune, (cwd: string) => pruneWorktrees(cwd))
  handle(IPC.worktreeLock, (cwd: string, path: string, reason: string) =>
    lockWorktree(cwd, path, reason)
  )
  handle(IPC.worktreeUnlock, (cwd: string, path: string) => unlockWorktree(cwd, path))

  handle(IPC.updateState, async () => currentUpdateState())
  handle(IPC.updateCheck, async () => {
    checkForUpdatesNow()
  })
  handle(IPC.updateInstall, async () => {
    installUpdate()
  })

  handle(IPC.repoDiscover, (path: string) => discoverRepo(path))
  handle(IPC.repoStatus, (cwd: string) => getStatus(cwd))

  handle(IPC.repoWatchStart, async (cwd: string) => {
    await startWatching(cwd, () => getWindow())
  })
  handle(IPC.repoWatchStop, async (root: string) => {
    stopWatching(root)
  })

  handle(IPC.diffFile, (req: DiffFileRequest) =>
    req.untracked
      ? getUntrackedDiff(req.cwd, req.path)
      : getFileDiff({
          cwd: req.cwd,
          path: req.path,
          staged: req.staged,
          ...(req.origPath !== undefined ? { origPath: req.origPath } : {}),
          ...(req.contextLines !== undefined ? { contextLines: req.contextLines } : {})
        })
  )

  handle(IPC.conflictStages, (cwd: string, path: string) => getConflictStages(cwd, path))
  handle(IPC.conflictList, (cwd: string) => listConflicts(cwd))
  handle(IPC.mergeDocument, (cwd: string, path: string) => getMergeDocument(cwd, path))
  handle(IPC.conflictResolve, (req: ResolveRequest) =>
    resolveConflict(req.cwd, req.path, req.content)
  )
  handle(IPC.conflictTakeSide, (req: TakeSideRequest) =>
    takeSide(req.cwd, req.path, req.side)
  )

  handle(IPC.stageFiles, async (req: StageRequest) => {
    if (req.paths.length === 0) return
    await git(['add', '--', ...req.paths], { cwd: req.cwd })
  })

  handle(IPC.logList, async (req: LogPageRequest) => {
    const commits = await getLog({
      cwd: req.cwd,
      ...(req.limit !== undefined ? { limit: req.limit } : {}),
      ...(req.skip !== undefined ? { skip: req.skip } : {}),
      ...(req.revisions !== undefined ? { revisions: req.revisions } : {}),
      ...(req.exclusive !== undefined ? { exclusive: req.exclusive } : {}),
      ...(req.paths !== undefined ? { paths: req.paths } : {}),
      ...(req.search !== undefined ? { search: req.search } : {})
    })
    // The graph is only built when it would mean something. For a search
    // result the lanes are fiction, and expensive fiction: 200 commits
    // matching an author in a 600-commit repository produced 200 lanes and
    // 19,900 edges, one SVG path each — enough to take the renderer down,
    // and it grows quadratically with the number of matches.
    const contiguous = isContiguousHistory(commits)
    const graph = contiguous ? buildGraph(commits) : []
    return { commits, graph, graphWidth: contiguous ? graphWidth(graph) : 0, contiguous }
  })

  handle(IPC.commitDetail, (cwd: string, hash: string) => getCommitDetail(cwd, hash))

  handle(IPC.commitDiff, (req: CommitDiffRequest) =>
    getCommitFileDiff({
      cwd: req.cwd,
      hash: req.hash,
      path: req.path,
      ...(req.origPath !== undefined ? { origPath: req.origPath } : {})
    })
  )

  handle(IPC.refsList, (cwd: string) => listRefs(cwd))

  handle(IPC.actionCheckout, async (cwd: string, branch: string) => {
    await checkoutBranch(cwd, branch)
  })
  handle(IPC.actionCreateBranch, async (req: CreateBranchRequest) => {
    await createBranch({
      cwd: req.cwd,
      name: req.name,
      ...(req.startPoint !== undefined ? { startPoint: req.startPoint } : {}),
      ...(req.checkout !== undefined ? { checkout: req.checkout } : {})
    })
  })
  handle(IPC.actionValidateBranch, (cwd: string, name: string) =>
    isValidBranchName(cwd, name)
  )
  handle(IPC.actionMerge, (req: MergeRequest) =>
    mergeRef({
      cwd: req.cwd,
      ref: req.ref,
      ...(req.noFastForward !== undefined ? { noFastForward: req.noFastForward } : {})
    })
  )
  handle(IPC.actionCommit, (req: CommitRequest) =>
    createCommit({
      cwd: req.cwd,
      message: req.message,
      ...(req.amend !== undefined ? { amend: req.amend } : {})
    })
  )
  handle(IPC.actionAbort, async (cwd: string, operation: string) => {
    await abortOperation(cwd, operation)
  })
  handle(IPC.mergeMessage, (cwd: string) => mergeMessage(cwd))
  handle(IPC.headMessage, (cwd: string) => headCommitMessage(cwd))

  handle(IPC.stashPush, (req: StashPushRequest) =>
    stashPush({
      cwd: req.cwd,
      ...(req.message !== undefined ? { message: req.message } : {}),
      ...(req.includeUntracked !== undefined ? { includeUntracked: req.includeUntracked } : {}),
      ...(req.keepIndex !== undefined ? { keepIndex: req.keepIndex } : {})
    })
  )
  handle(IPC.stashApply, (req: StashApplyRequest) =>
    stashApply({ cwd: req.cwd, ref: req.ref, ...(req.pop !== undefined ? { pop: req.pop } : {}) })
  )
  handle(IPC.stashDrop, (cwd: string, ref: string) => stashDrop(cwd, ref))

  handle(IPC.sequencerRun, (req: SequencerRequest) =>
    runSequencer({
      cwd: req.cwd,
      kind: req.kind,
      hashes: req.hashes,
      ...(req.mainline !== undefined ? { mainline: req.mainline } : {})
    })
  )
  handle(IPC.sequencerStep, (cwd: string, kind: SequencerKind, step: SequencerStep) =>
    sequencerStep(cwd, kind, step)
  )
  handle(IPC.isMergeCommit, (cwd: string, hash: string) => isMergeCommit(cwd, hash))

  handle(IPC.tagCreate, (req: CreateTagRequest) =>
    createTag({
      cwd: req.cwd,
      name: req.name,
      ...(req.target !== undefined ? { target: req.target } : {}),
      ...(req.message !== undefined ? { message: req.message } : {})
    })
  )
  handle(IPC.tagDelete, (cwd: string, name: string) => deleteTag(cwd, name))
  handle(IPC.tagValidate, (cwd: string, name: string) => isValidTagName(cwd, name))
  handle(IPC.branchDelete, (req: DeleteBranchRequest) =>
    deleteBranch({
      cwd: req.cwd,
      name: req.name,
      ...(req.force !== undefined ? { force: req.force } : {})
    })
  )
  handle(IPC.branchMerged, (cwd: string, name: string) => isBranchMerged(cwd, name))

  handle(IPC.todoBuild, (cwd: string, base: string) => buildTodo(cwd, base))
  handle(IPC.todoRun, (req: RunTodoRequest) =>
    runInteractiveRebase(req.cwd, req.base, req.entries)
  )

  handle(IPC.rebaseStart, (req: RebaseRequest) => rebaseOnto({ cwd: req.cwd, onto: req.onto }))
  handle(IPC.rebaseStep, (cwd: string, step: RebaseStep) => rebaseStep(cwd, step))
  handle(IPC.rebaseProgress, (cwd: string) => rebaseProgress(cwd))

  handle(IPC.remotesList, (cwd: string) => listRemotes(cwd))
  handle(IPC.remoteFetch, (req: FetchRequest) =>
    fetchRemote({
      cwd: req.cwd,
      ...(req.remote !== undefined ? { remote: req.remote } : {}),
      ...(req.prune !== undefined ? { prune: req.prune } : {})
    })
  )
  handle(IPC.remotePull, (req: PullRequest) =>
    pullCurrent({ cwd: req.cwd, ...(req.rebase !== undefined ? { rebase: req.rebase } : {}) })
  )
  handle(IPC.remotePush, (req: PushRequest) =>
    pushBranch({
      cwd: req.cwd,
      remote: req.remote,
      ...(req.branch !== undefined ? { branch: req.branch } : {}),
      ...(req.setUpstream !== undefined ? { setUpstream: req.setUpstream } : {}),
      ...(req.includeTags !== undefined ? { includeTags: req.includeTags } : {}),
      ...(req.forceWithLease !== undefined ? { forceWithLease: req.forceWithLease } : {})
    })
  )
  handle(IPC.remotePushTags, (req: PushTagsRequest) =>
    pushTags({ cwd: req.cwd, remote: req.remote, ...(req.tag !== undefined ? { tag: req.tag } : {}) })
  )

  handle(IPC.unstageFiles, async (req: StageRequest) => {
    if (req.paths.length === 0) return
    // `restore --staged` is the modern spelling and, unlike `reset`, is a no-op
    // on an unborn HEAD instead of erroring.
    await git(['restore', '--staged', '--', ...req.paths], { cwd: req.cwd })
  })
}
