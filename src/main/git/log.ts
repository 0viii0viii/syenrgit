import { git, gitLine } from './exec.js'
import type { CommitDetail, CommitSummary, RefBadge } from '@shared/git.js'

/**
 * Unit and record separators. Commit subjects and bodies contain newlines and
 * every printable character, so field splitting has to use bytes that cannot
 * appear in git's own output for these placeholders.
 */
const US = '\x1f'
const RS = '\x1e'

const SUMMARY_FORMAT = [
  '%H', // full hash
  '%P', // parent hashes, space separated
  '%an',
  '%ae',
  '%at', // author date, unix seconds
  '%D', // ref names, no wrapping parens
  '%s' // subject
].join(US)

/**
 * Decode `%D`, e.g. "HEAD -> main, origin/main, tag: v1.2.0, origin/HEAD".
 *
 * `origin/HEAD` is dropped: it is a symbolic alias for the remote's default
 * branch and rendering it duplicates a badge the user already sees.
 */
export function parseRefs(decoration: string): RefBadge[] {
  if (!decoration.trim()) return []

  const badges: RefBadge[] = []
  for (const raw of decoration.split(', ')) {
    const part = raw.trim()
    if (!part) continue

    if (part.startsWith('tag: ')) {
      badges.push({ kind: 'tag', name: part.slice(5), isHead: false })
      continue
    }
    if (part === 'HEAD') {
      // Detached HEAD.
      badges.push({ kind: 'head', name: 'HEAD', isHead: true })
      continue
    }
    if (part.startsWith('HEAD -> ')) {
      badges.push({ kind: 'local', name: part.slice(8), isHead: true })
      continue
    }
    if (part.endsWith('/HEAD')) continue

    // A remote-tracking ref is the only kind whose short name contains a slash
    // at the top level; local branches may too ("feature/x"), so distinguish by
    // whether the leading segment names a remote. Callers that need certainty
    // use listRefs(); for badges this heuristic matches git's own rendering.
    badges.push({
      kind: part.includes('/') ? 'remote' : 'local',
      name: part,
      isHead: false
    })
  }
  return badges
}

function parseSummary(record: string): CommitSummary | null {
  const fields = record.split(US)
  if (fields.length < 7) return null
  const [hash, parents, authorName, authorEmail, authorDate, refs, subject] = fields
  if (!hash) return null

  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: (parents ?? '').split(' ').filter(Boolean),
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authorDate: Number(authorDate ?? 0),
    refs: parseRefs(refs ?? ''),
    subject: subject ?? ''
  }
}

/**
 * What to walk when the caller does not specify.
 *
 * Deliberately NOT `--all`: that includes `refs/stash`, and a stash entry is a
 * merge commit, so stashes show up in the graph as two extra commits with a
 * merge node. Stashes belong in their own list, not in the history.
 */
const DEFAULT_REVISIONS = ['--branches', '--tags', '--remotes', 'HEAD']

/**
 * Whether the repository has any commit at all.
 *
 * A freshly initialised repository has no HEAD, and naming it in the walk
 * makes `git log` fail with "ambiguous argument 'HEAD'" — so an empty history
 * arrives as an error instead of an empty list.
 */
async function hasAnyCommit(cwd: string): Promise<boolean> {
  const head = await gitLine(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd }).catch(
    () => ''
  )
  if (head) return true
  // HEAD can be unborn while another branch still holds commits.
  const refs = await git(['for-each-ref', '--count=1', '--format=%(objectname)', 'refs/'], {
    cwd
  }).catch(() => '')
  return refs.trim() !== ''
}

/**
 * What to match commits against.
 *
 * Every field is handed to `git log`, not applied to a page of results: a
 * client-side filter can only ever search the commits already loaded, which
 * silently hides everything older than the current page.
 */
export interface LogSearch {
  /** Substring of the commit message, matched case-insensitively. */
  message?: string
  /** Substring of the author's name or email. */
  author?: string
  /**
   * A commit id, full or abbreviated. Resolved separately from the walk,
   * because `git log --grep` does not look at hashes and a user pasting one
   * expects to land on that commit.
   */
  hash?: string
}

export interface LogRequest {
  cwd: string
  limit?: number
  skip?: number
  /** Revision range or refs to walk; defaults to all refs. */
  revisions?: string[]
  /**
   * Show only commits unique to `revisions` — those not reachable from any
   * other ref. Ignored when no revisions are given, where it has no meaning.
   */
  exclusive?: boolean
  /** Limit history to these paths. */
  paths?: string[]
  /** Narrow the walk to matching commits. */
  search?: LogSearch
}

/**
 * Refs that must stay *out* of the exclusion set for a selected ref.
 *
 * A pushed branch has a remote-tracking counterpart holding the same commits,
 * so excluding "every other ref" would hide exactly the commits the user asked
 * to see. The counterpart travels with its branch in both directions.
 */
function keepAlongside(ref: string): string[] {
  if (ref.startsWith('refs/heads/')) {
    const name = ref.slice('refs/heads/'.length)
    return [ref, `refs/remotes/*/${name}`]
  }
  if (ref.startsWith('refs/remotes/')) {
    const name = ref.slice('refs/remotes/'.length).split('/').slice(1).join('/')
    return [ref, `refs/heads/${name}`, `refs/remotes/*/${name}`]
  }
  return [ref]
}

/**
 * Build `--not --exclude=… --glob=…` arguments limiting the walk to commits
 * unique to `revisions`.
 *
 * Enumerating every other ref by name would work but blows up argv on a repo
 * with thousands of branches. `--exclude` + `--glob` keeps it bounded — at the
 * cost of repeating the excludes, because git resets them after each glob.
 */
function exclusiveArgs(revisions: string[]): string[] {
  const keep = [...new Set(revisions.flatMap(keepAlongside))]
  const args = ['--not']
  for (const glob of ['refs/heads/*', 'refs/remotes/*', 'refs/tags/*']) {
    for (const pattern of keep) args.push(`--exclude=${pattern}`)
    args.push(`--glob=${glob}`)
  }
  return args
}

/**
 * Resolve a commit id the user typed, full or abbreviated.
 *
 * `--grep` never matches a hash, so a pasted id would otherwise find nothing.
 * Returns null when the text is not a commit in this repository.
 */
async function resolveHash(cwd: string, text: string): Promise<string | null> {
  const candidate = text.trim()
  // Anything that cannot be a hash is not worth a subprocess.
  if (!/^[0-9a-fA-F]{4,40}$/.test(candidate)) return null
  try {
    // The ^{commit} suffix makes this fail on a tree or blob rather than
    // returning something the log walk cannot use.
    return await gitLine(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd })
  } catch {
    return null
  }
}

export async function getLog(req: LogRequest): Promise<CommitSummary[]> {
  const search = req.search

  // An unborn repository has no history; that is an empty list, not a failure.
  if (!(await hasAnyCommit(req.cwd))) return []

  // A hash match is an exact lookup, not a filter: the user wants that commit,
  // and combining it with --grep would ask for a commit that matches both.
  if (search?.hash) {
    const resolved = await resolveHash(req.cwd, search.hash)
    if (!resolved) return []
    const raw = await git(
      ['log', '--decorate=short', `--format=${SUMMARY_FORMAT}${RS}`, '--max-count=1', resolved],
      { cwd: req.cwd }
    )
    const commit = parseSummary(raw.split(RS)[0]?.replace(/^\n/, '') ?? '')
    return commit ? [commit] : []
  }

  const args = [
    'log',
    // Topological order keeps a branch's commits contiguous, which is what
    // makes the lane graph readable; date order alone interleaves them.
    '--topo-order',
    '--decorate=short',
    `--format=${SUMMARY_FORMAT}${RS}`,
    `--max-count=${req.limit ?? 500}`,
    ...(req.skip ? [`--skip=${req.skip}`] : []),
    // --regexp-ignore-case applies to both --grep and --author, and
    // --fixed-strings keeps a message full of regex punctuation from being
    // read as a pattern.
    ...(search?.message || search?.author
      ? ['--regexp-ignore-case', '--fixed-strings']
      : []),
    ...(search?.message ? [`--grep=${search.message}`] : []),
    ...(search?.author ? [`--author=${search.author}`] : []),
    ...(req.revisions?.length ? req.revisions : DEFAULT_REVISIONS),
    ...(req.exclusive && req.revisions?.length ? exclusiveArgs(req.revisions) : []),
    ...(req.paths?.length ? ['--', ...req.paths] : [])
  ]

  const raw = await git(args, { cwd: req.cwd })
  const out: CommitSummary[] = []
  for (const record of raw.split(RS)) {
    // Records are newline-separated by git's own trailing \n; strip it.
    const trimmed = record.replace(/^\n/, '')
    if (!trimmed) continue
    const commit = parseSummary(trimmed)
    if (commit) out.push(commit)
  }
  return out
}

const DETAIL_FORMAT = [
  '%H',
  '%P',
  '%an',
  '%ae',
  '%at',
  '%D',
  '%cn',
  '%ce',
  '%ct',
  '%s',
  '%b'
].join(US)

export async function getCommitDetail(cwd: string, hash: string): Promise<CommitDetail> {
  const raw = await git(
    ['show', '--no-patch', '--decorate=short', `--format=${DETAIL_FORMAT}`, hash],
    { cwd }
  )
  const f = raw.split(US)
  const full = f[0] ?? hash

  // A commit's changed files come from diff-tree, not status. `-m` makes merge
  // commits report a diff against their first parent instead of nothing.
  const filesRaw = await git(
    ['diff-tree', '-m', '--first-parent', '--no-commit-id', '--name-status', '-z', '-r', hash],
    { cwd }
  )

  const files = parseNameStatus(filesRaw)

  const numstat = await git(
    ['diff-tree', '-m', '--first-parent', '--no-commit-id', '--numstat', '-r', hash],
    { cwd }
  )
  let additions = 0
  let deletions = 0
  for (const line of numstat.split('\n')) {
    const [add, del] = line.split('\t')
    if (add === undefined || del === undefined) continue
    // "-" marks a binary file; it contributes no line counts.
    if (add !== '-') additions += Number(add) || 0
    if (del !== '-') deletions += Number(del) || 0
  }

  return {
    hash: full,
    shortHash: full.slice(0, 7),
    parents: (f[1] ?? '').split(' ').filter(Boolean),
    authorName: f[2] ?? '',
    authorEmail: f[3] ?? '',
    authorDate: Number(f[4] ?? 0),
    refs: parseRefs(f[5] ?? ''),
    committerName: f[6] ?? '',
    committerEmail: f[7] ?? '',
    committerDate: Number(f[8] ?? 0),
    subject: f[9] ?? '',
    body: (f[10] ?? '').trim(),
    files,
    additions,
    deletions
  }
}

/**
 * Parse `--name-status -z`. Like porcelain v2, rename and copy entries span
 * two extra NUL records (old path, then new path), so records are consumed
 * with an explicit cursor.
 */
function parseNameStatus(raw: string): CommitDetail['files'] {
  const records = raw.split('\0').filter((r) => r !== '')
  const files: CommitDetail['files'] = []

  for (let i = 0; i < records.length; i++) {
    const code = records[i]
    if (!code) continue
    const letter = code[0]

    if (letter === 'R' || letter === 'C') {
      const origPath = records[++i] ?? ''
      const path = records[++i] ?? ''
      files.push({
        path,
        origPath,
        indexState: letter === 'R' ? 'renamed' : 'copied',
        worktreeState: 'unmodified',
        conflicted: false,
        similarity: Number(code.slice(1)) || 0
      })
      continue
    }

    const path = records[++i] ?? ''
    const state =
      letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : letter === 'T' ? 'typechanged' : 'modified'
    files.push({
      path,
      indexState: state,
      worktreeState: 'unmodified',
      conflicted: false
    })
  }

  return files
}
