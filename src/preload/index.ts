import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '@shared/ipc.js'
import type {
  RepoChange,
  UpdateState,
  CommitDiffRequest,
  CommitRequest,
  CreateBranchRequest,
  FetchRequest,
  MergeRequest,
  PullRequest,
  PushRequest,
  PushTagsRequest,
  AddWorktreeRequest,
  CreateTagRequest,
  PatchRequest,
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
  RendererApi,
  ResolveRequest,
  StageRequest,
  TakeSideRequest
} from '@shared/ipc.js'

/**
 * The entire surface the renderer can reach. Nothing here takes a callback
 * from the renderer into main, and no channel name is renderer-supplied, so
 * a compromised renderer cannot invoke arbitrary IPC.
 */
const api: RendererApi = {
  openRepoDialog: () => ipcRenderer.invoke(IPC.dialogOpenRepo),
  discoverRepo: (path) => ipcRenderer.invoke(IPC.repoDiscover, path),
  status: (cwd) => ipcRenderer.invoke(IPC.repoStatus, cwd),
  watchRepo: (cwd) => ipcRenderer.invoke(IPC.repoWatchStart, cwd),
  unwatchRepo: (root) => ipcRenderer.invoke(IPC.repoWatchStop, root),
  fileDiff: (req: DiffFileRequest) => ipcRenderer.invoke(IPC.diffFile, req),
  conflictStages: (cwd, path) => ipcRenderer.invoke(IPC.conflictStages, cwd, path),
  mergeDocument: (cwd, path) => ipcRenderer.invoke(IPC.mergeDocument, cwd, path),
  listConflicts: (cwd) => ipcRenderer.invoke(IPC.conflictList, cwd),
  resolveConflict: (req: ResolveRequest) => ipcRenderer.invoke(IPC.conflictResolve, req),
  takeSide: (req: TakeSideRequest) => ipcRenderer.invoke(IPC.conflictTakeSide, req),
  stage: (req: StageRequest) => ipcRenderer.invoke(IPC.stageFiles, req),
  unstage: (req: StageRequest) => ipcRenderer.invoke(IPC.unstageFiles, req),
  log: (req: LogPageRequest) => ipcRenderer.invoke(IPC.logList, req),
  commitDetail: (cwd, hash) => ipcRenderer.invoke(IPC.commitDetail, cwd, hash),
  commitDiff: (req: CommitDiffRequest) => ipcRenderer.invoke(IPC.commitDiff, req),
  refs: (cwd) => ipcRenderer.invoke(IPC.refsList, cwd),
  checkout: (cwd, branch) => ipcRenderer.invoke(IPC.actionCheckout, cwd, branch),
  createBranch: (req: CreateBranchRequest) => ipcRenderer.invoke(IPC.actionCreateBranch, req),
  validateBranchName: (cwd, name) => ipcRenderer.invoke(IPC.actionValidateBranch, cwd, name),
  merge: (req: MergeRequest) => ipcRenderer.invoke(IPC.actionMerge, req),
  commit: (req: CommitRequest) => ipcRenderer.invoke(IPC.actionCommit, req),
  abort: (cwd, operation) => ipcRenderer.invoke(IPC.actionAbort, cwd, operation),
  mergeMessage: (cwd) => ipcRenderer.invoke(IPC.mergeMessage, cwd),
  headMessage: (cwd) => ipcRenderer.invoke(IPC.headMessage, cwd),
  remotes: (cwd) => ipcRenderer.invoke(IPC.remotesList, cwd),
  fetch: (req: FetchRequest) => ipcRenderer.invoke(IPC.remoteFetch, req),
  pull: (req: PullRequest) => ipcRenderer.invoke(IPC.remotePull, req),
  push: (req: PushRequest) => ipcRenderer.invoke(IPC.remotePush, req),
  pushTags: (req: PushTagsRequest) => ipcRenderer.invoke(IPC.remotePushTags, req),
  stashPush: (req: StashPushRequest) => ipcRenderer.invoke(IPC.stashPush, req),
  stashApply: (req: StashApplyRequest) => ipcRenderer.invoke(IPC.stashApply, req),
  stashDrop: (cwd, ref) => ipcRenderer.invoke(IPC.stashDrop, cwd, ref),
  rebase: (req: RebaseRequest) => ipcRenderer.invoke(IPC.rebaseStart, req),
  rebaseStep: (cwd, step: RebaseStep) => ipcRenderer.invoke(IPC.rebaseStep, cwd, step),
  rebaseProgress: (cwd) => ipcRenderer.invoke(IPC.rebaseProgress, cwd),
  sequencer: (req: SequencerRequest) => ipcRenderer.invoke(IPC.sequencerRun, req),
  sequencerStep: (cwd, kind: SequencerKind, step: SequencerStep) =>
    ipcRenderer.invoke(IPC.sequencerStep, cwd, kind, step),
  isMergeCommit: (cwd, hash) => ipcRenderer.invoke(IPC.isMergeCommit, cwd, hash),
  createTag: (req: CreateTagRequest) => ipcRenderer.invoke(IPC.tagCreate, req),
  deleteTag: (cwd, name) => ipcRenderer.invoke(IPC.tagDelete, cwd, name),
  validateTagName: (cwd, name) => ipcRenderer.invoke(IPC.tagValidate, cwd, name),
  deleteBranch: (req: DeleteBranchRequest) => ipcRenderer.invoke(IPC.branchDelete, req),
  isBranchMerged: (cwd, name) => ipcRenderer.invoke(IPC.branchMerged, cwd, name),
  buildTodo: (cwd, base) => ipcRenderer.invoke(IPC.todoBuild, cwd, base),
  runTodo: (req: RunTodoRequest) => ipcRenderer.invoke(IPC.todoRun, req),
  readPatch: (cwd, path, stagedSide) => ipcRenderer.invoke(IPC.patchRead, cwd, path, stagedSide),
  stagePartial: (req: PatchRequest) => ipcRenderer.invoke(IPC.patchStage, req),
  unstagePartial: (req: PatchRequest) => ipcRenderer.invoke(IPC.patchUnstage, req),
  discardPartial: (req: PatchRequest) => ipcRenderer.invoke(IPC.patchDiscard, req),
  discardFile: (cwd, path) => ipcRenderer.invoke(IPC.discardFile, cwd, path),
  worktrees: (cwd) => ipcRenderer.invoke(IPC.worktreeList, cwd),
  addWorktree: (req: AddWorktreeRequest) => ipcRenderer.invoke(IPC.worktreeAdd, req),
  removeWorktree: (req: RemoveWorktreeRequest) => ipcRenderer.invoke(IPC.worktreeRemove, req),
  pruneWorktrees: (cwd) => ipcRenderer.invoke(IPC.worktreePrune, cwd),
  lockWorktree: (cwd, path, reason) => ipcRenderer.invoke(IPC.worktreeLock, cwd, path, reason),
  unlockWorktree: (cwd, path) => ipcRenderer.invoke(IPC.worktreeUnlock, cwd, path),
  updateState: () => ipcRenderer.invoke(IPC.updateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateChanged: (listener) => {
    const handler = (_event: unknown, next: UpdateState): void => listener(next)
    ipcRenderer.on(IPC_EVENT.updateChanged, handler)
    return () => {
      ipcRenderer.off(IPC_EVENT.updateChanged, handler)
    }
  },
  onRepoChanged: (listener) => {
    const handler = (_event: unknown, change: RepoChange): void => listener(change)
    ipcRenderer.on(IPC_EVENT.repoChanged, handler)
    return () => {
      ipcRenderer.off(IPC_EVENT.repoChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('platform', {
  os: process.platform,
  isMac: process.platform === 'darwin'
})
