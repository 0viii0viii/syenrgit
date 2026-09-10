import { git } from './exec.js'
import type { BranchRef, RefList, StashEntry, TagRef } from '@shared/git.js'

const US = '\x1f'

/**
 * `%(upstream:track)` renders as "[ahead 2, behind 1]", "[ahead 3]", "[gone]"
 * or empty. Parsing it here avoids a rev-list call per branch, which on a repo
 * with a few hundred branches is the difference between instant and a stall.
 */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  }
}

const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(HEAD)',
  '%(committerdate:unix)',
  '%(contents:subject)'
].join(US)

function parseBranchLine(line: string): BranchRef | null {
  const f = line.split(US)
  if (f.length < 8 || !f[0]) return null
  const { ahead, behind } = parseTrack(f[4] ?? '')
  const upstream = f[3] ?? ''

  return {
    refName: f[0],
    name: f[1] ?? '',
    hash: f[2] ?? '',
    isHead: f[5] === '*',
    ...(upstream ? { upstream } : {}),
    ahead,
    behind,
    date: Number(f[6] ?? 0),
    subject: f[7] ?? ''
  }
}

export async function listRefs(cwd: string): Promise<RefList> {
  const [branchRaw, tagRaw, stashes] = await Promise.all([
    git(
      [
        'for-each-ref',
        `--format=${REF_FORMAT}`,
        '--sort=-committerdate',
        'refs/heads',
        'refs/remotes'
      ],
      { cwd }
    ),
    git(
      [
        'for-each-ref',
        `--format=%(refname)${US}%(refname:short)${US}%(objectname)${US}%(committerdate:unix)`,
        '--sort=-committerdate',
        'refs/tags'
      ],
      { cwd }
    ),
    listStashes(cwd)
  ])

  const local: BranchRef[] = []
  const remote: BranchRef[] = []

  for (const line of branchRaw.split('\n')) {
    if (!line) continue
    const ref = parseBranchLine(line)
    if (!ref) continue
    // `refs/remotes/origin/HEAD` is a symbolic alias, not a branch.
    if (ref.refName.endsWith('/HEAD')) continue
    if (ref.refName.startsWith('refs/heads/')) local.push(ref)
    else remote.push(ref)
  }

  const tags: TagRef[] = []
  for (const line of tagRaw.split('\n')) {
    if (!line) continue
    const [refName, name, hash, date] = line.split(US)
    if (!refName || !name) continue
    tags.push({ refName, name, hash: hash ?? '', date: Number(date ?? 0) })
  }

  return { local, remote, tags, stashes }
}

export async function listStashes(cwd: string): Promise<StashEntry[]> {
  // A repo with no stashes has no refs/stash at all; git exits 0 with no
  // output, so no special-casing is needed.
  const raw = await git(
    ['stash', 'list', `--format=%gd${US}%ct${US}%gs`],
    { cwd }
  )

  const out: StashEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [ref, date, message] = line.split(US)
    if (!ref) continue
    const index = Number(/stash@\{(\d+)\}/.exec(ref)?.[1] ?? out.length)
    out.push({ ref, index, message: message ?? '', date: Number(date ?? 0) })
  }
  return out
}

/**
 * Group remote branches by their remote name, e.g. "origin" -> [main, dev].
 * Splitting on the first slash is correct here because for-each-ref's short
 * name for a remote ref is always "<remote>/<branch>".
 */
export function groupByRemote(remotes: BranchRef[]): Map<string, BranchRef[]> {
  const grouped = new Map<string, BranchRef[]>()
  for (const ref of remotes) {
    const slash = ref.name.indexOf('/')
    const remote = slash === -1 ? ref.name : ref.name.slice(0, slash)
    const list = grouped.get(remote)
    if (list) list.push(ref)
    else grouped.set(remote, [ref])
  }
  return grouped
}
