import type {
  CommitDetail,
  CommitSummary,
  ConflictStages,
  FileDiff,
  MergeDocument,
  GraphRow,
  RefList,
  RepoStatus
} from './git.js'

/**
 * The renderer/main contract.
 *
 * Channel names live here so both sides import the same literals — a typo
 * becomes a type error rather than a silently dead handler.
 */
export const IPC = {
  dialogOpenRepo: 'dialog:openRepo',
  repoDiscover: 'repo:discover',
  repoStatus: 'repo:status',
  repoWatchStart: 'repo:watch:start',
  repoWatchStop: 'repo:watch:stop',
  diffFile: 'diff:file',
  conflictStages: 'conflict:stages',
  conflictList: 'conflict:list',
  conflictResolve: 'conflict:resolve',
  conflictTakeSide: 'conflict:takeSide',
  mergeDocument: 'conflict:mergeDocument',
  stageFiles: 'index:stage',
  unstageFiles: 'index:unstage',
  logList: 'log:list',
  commitDetail: 'log:detail',
  refsList: 'refs:list',
  commitDiff: 'log:diff',
  actionCheckout: 'action:checkout',
  actionCreateBranch: 'action:createBranch',
  actionValidateBranch: 'action:validateBranch',
  actionMerge: 'action:merge',
  actionCommit: 'action:commit',
  actionAbort: 'action:abort',
  mergeMessage: 'action:mergeMessage',
  remotesList: 'remote:list',
  remoteFetch: 'remote:fetch',
  remotePull: 'remote:pull',
  remotePush: 'remote:push',
  remotePushTags: 'remote:pushTags',
  stashPush: 'stash:push',
  stashApply: 'stash:apply',
  stashDrop: 'stash:drop',
  rebaseStart: 'rebase:start',
  rebaseStep: 'rebase:step',
  rebaseProgress: 'rebase:progress',
  sequencerRun: 'sequencer:run',
  sequencerStep: 'sequencer:step',
  isMergeCommit: 'sequencer:isMerge',
  tagCreate: 'tag:create',
  tagDelete: 'tag:delete',
  tagValidate: 'tag:validate',
  branchDelete: 'branch:delete',
  branchMerged: 'branch:merged',
  todoBuild: 'rebase:todo',
  todoRun: 'rebase:todoRun',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateInstall: 'update:install'
} as const

/** Pushed from main to the renderer; not request/response. */
export const IPC_EVENT = {
  repoChanged: 'repo:changed',
  updateChanged: 'update:changed'
} as const

/**
 * Where the auto-updater has got to.
 *
 * 'unsupported' is a normal state, not a failure: a dev run has no update
 * feed, and macOS refuses to swap an app bundle outside /Applications.
 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }
  | { status: 'unsupported'; reason: string }

/**
 * Which part of the repository moved.
 *
 * 'worktree' means file contents changed — only the status and the open diff
 * are stale. 'git' means refs, HEAD or the index moved, which is the only case
 * that can invalidate the commit history. Reloading a 500-commit log on every
 * worktree write would hammer git during a build.
 */
export type ChangeScope = 'worktree' | 'git'

/** Payload of the repo-changed push. */
export interface RepoChange {
  /** Repository root the change belongs to — several may be open at once. */
  root: string
  scope: ChangeScope
}

export interface DiffFileRequest {
  cwd: string
  path: string
  /** Previous path for a rename; needed for git to report it as one. */
  origPath?: string
  staged: boolean
  untracked?: boolean
  contextLines?: number
}

export interface ResolveRequest {
  cwd: string
  path: string
  content: string
}

export interface TakeSideRequest {
  cwd: string
  path: string
  side: 'ours' | 'theirs'
}

export interface StageRequest {
  cwd: string
  paths: string[]
}

export interface LogPageRequest {
  cwd: string
  limit?: number
  skip?: number
  /** Refs or ranges to walk; defaults to --all. */
  revisions?: string[]
  /** Show only commits unique to `revisions`. */
  exclusive?: boolean
  /** Restrict history to these paths. */
  paths?: string[]
}

/**
 * Commits and their lane layout travel together: the graph is a pure function
 * of the commit page, and computing it in main keeps the layout identical
 * across renders and off the UI thread.
 */
export interface LogPage {
  commits: CommitSummary[]
  graph: GraphRow[]
  /** Widest lane count in this page. */
  graphWidth: number
}

export interface MergeRequest {
  cwd: string
  /** Ref to merge into the current branch. */
  ref: string
  noFastForward?: boolean
}

export type MergeOutcome =
  | { status: 'merged'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }

export interface CommitRequest {
  cwd: string
  message: string
  amend?: boolean
}

export interface CommitCreated {
  hash: string
  shortHash: string
}

export interface CreateBranchRequest {
  cwd: string
  name: string
  /** Ref to branch from; defaults to HEAD. */
  startPoint?: string
  checkout?: boolean
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface FetchRequest {
  cwd: string
  /** Omit to fetch every remote. */
  remote?: string
  prune?: boolean
}

export interface PullRequest {
  cwd: string
  rebase?: boolean
}

export type PullOutcome =
  | { status: 'pulled'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }

export interface PushRequest {
  cwd: string
  remote: string
  branch?: string
  setUpstream?: boolean
  includeTags?: boolean
  forceWithLease?: boolean
}

export interface PushTagsRequest {
  cwd: string
  remote: string
  /** A single tag; omit to push every tag. */
  tag?: string
}

export interface StashPushRequest {
  cwd: string
  message?: string
  includeUntracked?: boolean
  keepIndex?: boolean
}

export type StashPushOutcome =
  | { status: 'stashed'; message: string }
  | { status: 'nothing-to-stash'; message: string }

export interface StashApplyRequest {
  cwd: string
  /** e.g. "stash@{0}". */
  ref: string
  pop?: boolean
}

export type StashApplyOutcome =
  | { status: 'applied'; message: string }
  | { status: 'conflicts'; message: string }

export interface RebaseRequest {
  cwd: string
  /** Ref to replay the current branch onto. */
  onto: string
}

export type RebaseOutcome =
  | { status: 'rebased'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }
  | { status: 'stopped'; message: string }

export type RebaseStep = 'continue' | 'skip' | 'abort'

export interface RebaseProgress {
  current: number
  total: number
}

export type SequencerKind = 'cherry-pick' | 'revert'
export type SequencerStep = 'continue' | 'skip' | 'abort'

export interface SequencerRequest {
  cwd: string
  kind: SequencerKind
  /** Commits to replay, oldest first. */
  hashes: string[]
  /** Required when replaying a merge commit. */
  mainline?: number
}

export type SequencerOutcome =
  | { status: 'done'; message: string }
  | { status: 'conflicts'; message: string }
  | { status: 'empty'; message: string }

export interface CreateTagRequest {
  cwd: string
  name: string
  /** Commit to tag; defaults to HEAD. */
  target?: string
  /** Given a message, the tag is annotated. */
  message?: string
}

export interface DeleteBranchRequest {
  cwd: string
  name: string
  force?: boolean
}

/**
 * `reword` is absent on purpose: it opens the commit-message editor, and this
 * app runs git with no editor so a subprocess can never block on one.
 */
export type TodoAction = 'pick' | 'squash' | 'fixup' | 'edit' | 'drop'

export interface TodoEntry {
  hash: string
  shortHash: string
  subject: string
  action: TodoAction
}

export interface RunTodoRequest {
  cwd: string
  /** Commit the replay starts after. */
  base: string
  entries: TodoEntry[]
}

export interface CommitDiffRequest {
  cwd: string
  hash: string
  path: string
  origPath?: string
}

/** Shape exposed on `window.api` by the preload bridge. */
export interface RendererApi {
  openRepoDialog(): Promise<string | null>
  discoverRepo(path: string): Promise<string | null>
  status(cwd: string): Promise<RepoStatus>
  watchRepo(cwd: string): Promise<void>
  unwatchRepo(root: string): Promise<void>
  fileDiff(req: DiffFileRequest): Promise<FileDiff>
  conflictStages(cwd: string, path: string): Promise<ConflictStages>
  mergeDocument(cwd: string, path: string): Promise<MergeDocument>
  listConflicts(cwd: string): Promise<string[]>
  resolveConflict(req: ResolveRequest): Promise<void>
  takeSide(req: TakeSideRequest): Promise<void>
  stage(req: StageRequest): Promise<void>
  unstage(req: StageRequest): Promise<void>
  log(req: LogPageRequest): Promise<LogPage>
  commitDetail(cwd: string, hash: string): Promise<CommitDetail>
  commitDiff(req: CommitDiffRequest): Promise<FileDiff>
  refs(cwd: string): Promise<RefList>
  checkout(cwd: string, branch: string): Promise<void>
  createBranch(req: CreateBranchRequest): Promise<void>
  validateBranchName(cwd: string, name: string): Promise<boolean>
  merge(req: MergeRequest): Promise<MergeOutcome>
  commit(req: CommitRequest): Promise<CommitCreated>
  /** Abandon the in-progress merge, rebase, cherry-pick or revert. */
  abort(cwd: string, operation: string): Promise<void>
  /** Message git prepared for an in-progress merge, if any. */
  mergeMessage(cwd: string): Promise<string | null>
  remotes(cwd: string): Promise<RemoteInfo[]>
  fetch(req: FetchRequest): Promise<string>
  pull(req: PullRequest): Promise<PullOutcome>
  push(req: PushRequest): Promise<string>
  pushTags(req: PushTagsRequest): Promise<string>
  stashPush(req: StashPushRequest): Promise<StashPushOutcome>
  stashApply(req: StashApplyRequest): Promise<StashApplyOutcome>
  stashDrop(cwd: string, ref: string): Promise<string>
  rebase(req: RebaseRequest): Promise<RebaseOutcome>
  rebaseStep(cwd: string, step: RebaseStep): Promise<RebaseOutcome>
  rebaseProgress(cwd: string): Promise<RebaseProgress | null>
  sequencer(req: SequencerRequest): Promise<SequencerOutcome>
  sequencerStep(cwd: string, kind: SequencerKind, step: SequencerStep): Promise<SequencerOutcome>
  isMergeCommit(cwd: string, hash: string): Promise<boolean>
  createTag(req: CreateTagRequest): Promise<string>
  deleteTag(cwd: string, name: string): Promise<string>
  validateTagName(cwd: string, name: string): Promise<boolean>
  deleteBranch(req: DeleteBranchRequest): Promise<string>
  isBranchMerged(cwd: string, name: string): Promise<boolean>
  buildTodo(cwd: string, base: string): Promise<TodoEntry[]>
  runTodo(req: RunTodoRequest): Promise<RebaseOutcome>
  /** Subscribe to repo-changed pushes. Returns an unsubscribe function. */
  onRepoChanged(listener: (change: RepoChange) => void): () => void
  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  /** Subscribe to updater progress. Returns an unsubscribe function. */
  onUpdateChanged(listener: (state: UpdateState) => void): () => void
}
