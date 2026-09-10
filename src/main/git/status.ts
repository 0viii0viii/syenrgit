import { git, splitNul } from './exec.js'
import type { BranchInfo, FileEntry, FileState, RepoStatus } from '@shared/git.js'
import { detectOperation } from './repo.js'

function toState(code: string | undefined): FileState {
  switch (code) {
    case 'M':
      return 'modified'
    case 'T':
      return 'typechanged'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '.':
      return 'unmodified'
    default:
      return 'unmodified'
  }
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * The `-z` format is field-delimited by NUL, but entry kind `2` (rename/copy)
 * spans TWO NUL-separated records: the new path, then the original path. Any
 * parser that treats one record as one entry silently corrupts renames, so we
 * consume records with an explicit cursor rather than mapping over them.
 */
export function parsePorcelainV2(raw: string): {
  branch: BranchInfo
  files: FileEntry[]
} {
  const records = splitNul(raw)
  const files: FileEntry[] = []
  const branch: BranchInfo = {
    name: null,
    head: null,
    detached: false,
    ahead: 0,
    behind: 0
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue

    // --- Header lines -----------------------------------------------------
    if (rec.startsWith('# ')) {
      const [key, ...rest] = rec.slice(2).split(' ')
      const value = rest.join(' ')
      switch (key) {
        case 'branch.oid':
          branch.head = value === '(initial)' ? null : value
          break
        case 'branch.head':
          if (value === '(detached)') {
            branch.detached = true
          } else {
            branch.name = value
          }
          break
        case 'branch.upstream':
          branch.upstream = value
          break
        case 'branch.ab': {
          // "+<ahead> -<behind>"
          const m = /^\+(-?\d+) -(-?\d+)$/.exec(value)
          if (m) {
            branch.ahead = Number(m[1])
            branch.behind = Number(m[2])
          }
          break
        }
      }
      continue
    }

    const kind = rec[0]

    // --- Ordinary changed entry: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
    if (kind === '1') {
      const sp = splitFields(rec, 8)
      if (!sp) continue
      const [, xy, sub, , , , , , path] = sp
      files.push({
        path: path ?? '',
        indexState: toState(xy?.[0]),
        worktreeState: toState(xy?.[1]),
        conflicted: false,
        ...(sub && sub !== 'N...' ? { submodule: sub } : {})
      })
      continue
    }

    // --- Rename/copy: "2 <XY> ... <X><score> <path>" NUL "<origPath>"
    if (kind === '2') {
      const sp = splitFields(rec, 9)
      if (!sp) continue
      const [, xy, sub, , , , , , score, path] = sp
      const origPath = records[++i] ?? ''
      files.push({
        path: path ?? '',
        origPath,
        indexState: toState(xy?.[0]),
        worktreeState: toState(xy?.[1]),
        conflicted: false,
        similarity: Number(score?.slice(1) ?? 0),
        ...(sub && sub !== 'N...' ? { submodule: sub } : {})
      })
      continue
    }

    // --- Unmerged: "u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
    if (kind === 'u') {
      const sp = splitFields(rec, 10)
      if (!sp) continue
      const [, , sub, , , , , , , , path] = sp
      files.push({
        path: path ?? '',
        indexState: 'conflicted',
        worktreeState: 'conflicted',
        conflicted: true,
        ...(sub && sub !== 'N...' ? { submodule: sub } : {})
      })
      continue
    }

    // --- Untracked / ignored ----------------------------------------------
    if (kind === '?' || kind === '!') {
      const path = rec.slice(2)
      const state: FileState = kind === '?' ? 'untracked' : 'ignored'
      files.push({
        path,
        indexState: 'unmodified',
        worktreeState: state,
        conflicted: false
      })
    }
  }

  return { branch, files }
}

/**
 * Split the first `count` space-delimited fields, returning the remainder
 * (the path, which may itself contain spaces) as the final element.
 */
function splitFields(rec: string, count: number): string[] | null {
  const out: string[] = []
  let start = 0
  for (let f = 0; f < count; f++) {
    const idx = rec.indexOf(' ', start)
    if (idx === -1) return null
    out.push(rec.slice(start, idx))
    start = idx + 1
  }
  out.push(rec.slice(start))
  return out
}

export async function getStatus(cwd: string): Promise<RepoStatus> {
  const [raw, root, operation] = await Promise.all([
    git(
      [
        'status',
        '--porcelain=v2',
        '--branch',
        '--untracked-files=all',
        '--renames',
        '-z'
      ],
      { cwd }
    ),
    git(['rev-parse', '--show-toplevel'], { cwd }).then((s) => s.trim()),
    detectOperation(cwd)
  ])

  const { branch, files } = parsePorcelainV2(raw)
  return { root, branch, operation, files }
}
