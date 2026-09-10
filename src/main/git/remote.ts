import { git, gitLine, GitError } from './exec.js'
import { detectOperation } from './repo.js'

/**
 * Network operations get a long leash but not an unbounded one: a hung
 * connection must eventually surface as an error rather than a spinner that
 * never stops.
 */
const NETWORK_TIMEOUT_MS = 120_000

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export async function listRemotes(cwd: string): Promise<RemoteInfo[]> {
  const raw = await git(['remote', '-v'], { cwd })
  const byName = new Map<string, RemoteInfo>()

  for (const line of raw.split('\n')) {
    // "origin\thttps://example.com/repo.git (fetch)"
    const match = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/.exec(line)
    if (!match) continue
    const [, name, url, kind] = match
    if (!name || !url) continue
    const entry = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') entry.fetchUrl = url
    else entry.pushUrl = url
    byName.set(name, entry)
  }
  return [...byName.values()]
}

/**
 * Credential prompts are disabled in exec.ts so a GUI subprocess can never
 * hang waiting on a tty that does not exist. The cost is that a remote needing
 * credentials fails with git's raw plumbing message, which tells the user
 * nothing actionable — so it is translated here.
 */
function describeNetworkError(err: GitError): string {
  const text = err.stderr.toLowerCase()

  if (
    text.includes('could not read username') ||
    text.includes('could not read password') ||
    text.includes('authentication failed') ||
    text.includes('terminal prompts disabled')
  ) {
    return (
      'The remote asked for credentials. This app never prompts for them — ' +
      'configure a git credential helper, or use an SSH remote with a loaded key.'
    )
  }
  if (text.includes('permission denied (publickey)')) {
    return 'The remote rejected the SSH key. Check that your key is loaded in ssh-agent.'
  }
  if (text.includes('could not resolve host') || text.includes('unable to access')) {
    return `Cannot reach the remote. ${err.stderr.trim()}`
  }
  if (text.includes('non-fast-forward') || text.includes('fetch first')) {
    return 'The remote has commits you do not have. Pull before pushing.'
  }
  return err.stderr.trim() || err.message
}

async function runNetwork(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(args, { cwd, timeoutMs: NETWORK_TIMEOUT_MS })
  } catch (err) {
    if (err instanceof GitError) throw new Error(describeNetworkError(err), { cause: err })
    throw err
  }
}

export interface FetchOptions {
  cwd: string
  /** Omit to fetch every remote. */
  remote?: string
  /** Delete remote-tracking refs whose branch is gone from the remote. */
  prune?: boolean
}

export async function fetchRemote(options: FetchOptions): Promise<string> {
  const { cwd, remote, prune } = options
  const args = [
    'fetch',
    ...(prune ? ['--prune', '--prune-tags'] : []),
    // Progress goes to stderr and is noise here; the caller reloads refs.
    '--quiet',
    ...(remote ? [remote] : ['--all'])
  ]
  await runNetwork(cwd, args)
  return remote ? `Fetched ${remote}` : 'Fetched all remotes'
}

export type PullOutcome =
  | { status: 'pulled'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'conflicts'; message: string }

export interface PullOptions {
  cwd: string
  /** Replay local commits on top of the upstream instead of merging. */
  rebase?: boolean
}

/**
 * Pull, treating conflicts as an outcome rather than a failure — the same
 * distinction merge makes, since a pull is a fetch plus a merge or rebase.
 */
export async function pullCurrent(options: PullOptions): Promise<PullOutcome> {
  const { cwd, rebase } = options
  const args = ['pull', rebase ? '--rebase' : '--no-rebase', '--no-edit']

  try {
    const output = await git(args, { cwd, timeoutMs: NETWORK_TIMEOUT_MS })
    if (/Already up to date/i.test(output)) {
      return { status: 'up-to-date', message: output.trim() }
    }
    return { status: 'pulled', message: output.trim() }
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    // A conflicted pull leaves the merge or rebase in progress; anything else
    // never changed the working tree.
    if ((await detectOperation(cwd)) !== 'none') {
      return { status: 'conflicts', message: err.stderr.trim() || err.message }
    }
    throw new Error(describeNetworkError(err), { cause: err })
  }
}

export interface PushOptions {
  cwd: string
  remote: string
  /** Branch to push; defaults to the current one. */
  branch?: string
  /** Record the pushed branch as the upstream. */
  setUpstream?: boolean
  /** Push every tag alongside the branch. */
  includeTags?: boolean
  /**
   * Overwrite the remote branch, but only if it still points where we last
   * saw it. Plain --force is deliberately not offered: it silently discards
   * commits pushed by someone else in the meantime.
   */
  forceWithLease?: boolean
}

export async function pushBranch(options: PushOptions): Promise<string> {
  const { cwd, remote, branch, setUpstream, includeTags, forceWithLease } = options
  const target = branch ?? (await gitLine(['symbolic-ref', '--short', 'HEAD'], { cwd }))

  const args = [
    'push',
    ...(setUpstream ? ['--set-upstream'] : []),
    ...(forceWithLease ? ['--force-with-lease'] : []),
    ...(includeTags ? ['--follow-tags'] : []),
    remote,
    target
  ]
  await runNetwork(cwd, args)
  return includeTags ? `Pushed ${target} and its tags to ${remote}` : `Pushed ${target} to ${remote}`
}

export interface PushTagsOptions {
  cwd: string
  remote: string
  /** A single tag name; omit to push every tag. */
  tag?: string
}

/**
 * Push tags.
 *
 * Separate from pushBranch because tags are pushed on their own schedule —
 * cutting a release is not the same act as publishing a branch, and `--tags`
 * on a branch push would send unrelated tags along with it.
 */
export async function pushTags(options: PushTagsOptions): Promise<string> {
  const { cwd, remote, tag } = options
  const args = ['push', remote, ...(tag ? [`refs/tags/${tag}`] : ['--tags'])]
  await runNetwork(cwd, args)
  return tag ? `Pushed tag ${tag} to ${remote}` : `Pushed all tags to ${remote}`
}

/** Remote-tracking refs that no longer exist upstream, for a prune preview. */
export async function stalePruneCandidates(cwd: string, remote: string): Promise<string[]> {
  const raw = await git(['remote', 'prune', '--dry-run', remote], {
    cwd,
    timeoutMs: NETWORK_TIMEOUT_MS
  }).catch(() => '')
  return raw
    .split('\n')
    .map((line) => /\* \[would prune\] (.+)$/.exec(line)?.[1])
    .filter((v): v is string => Boolean(v))
}
