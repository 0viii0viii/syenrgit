import { git, GitError } from './exec.js'

/**
 * Partial staging works by handing `git apply` a patch containing only the
 * lines the user picked.
 *
 * The patch is built by filtering the *raw* diff text rather than
 * re-rendering it from the parsed structure, so the file header — modes, index
 * line, rename markers — survives byte-for-byte. Only the hunk bodies and
 * their counts are rewritten.
 */

/** A raw diff split into its file header and its hunks, still as text. */
export interface RawPatch {
  header: string
  hunks: RawHunk[]
}

export interface RawHunk {
  /** The `@@ -a,b +c,d @@` line, including any trailing section heading. */
  header: string
  oldStart: number
  newStart: number
  /** Body lines, each still carrying its leading ' ', '+', '-' or '\'. */
  lines: string[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export function splitPatch(raw: string): RawPatch | null {
  const lines = raw.split('\n')
  const headerLines: string[] = []
  const hunks: RawHunk[] = []
  let current: RawHunk | null = null

  for (const line of lines) {
    const match = HUNK_HEADER.exec(line)
    if (match) {
      current = {
        header: line,
        oldStart: Number(match[1]),
        newStart: Number(match[3]),
        lines: []
      }
      hunks.push(current)
      continue
    }
    if (current === null) {
      // Everything before the first @@ is the file header. A binary diff has
      // no hunks at all, and cannot be staged line by line.
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) return null
      headerLines.push(line)
      continue
    }
    // A trailing empty element from the final newline is not a body line.
    if (line === '' && current.lines.length > 0) continue
    current.lines.push(line)
  }

  if (hunks.length === 0) return null
  return { header: headerLines.join('\n'), hunks }
}

/** Which lines of which hunks the user picked, by index into the raw hunk. */
export interface Selection {
  /** hunk index -> selected body line indices. An empty set means the whole hunk. */
  hunks: Map<number, Set<number> | 'all'>
}

export type PatchDirection =
  /** Add the selection to the index (or the worktree, when reversed). */
  | 'forward'
  /** Remove the selection, by reversing it. */
  | 'reverse'

/**
 * Rewrite one hunk to contain only the selected changes.
 *
 * The rules are asymmetric, and getting them backwards is how partial staging
 * corrupts a file:
 *
 * - a selected change is kept as-is
 * - an unselected `+` is dropped: it is not in the target yet, and is not
 *   being added
 * - an unselected `-` becomes context: the line is still in the target, so the
 *   patch must expect to find it there
 *
 * Returns null when nothing in the hunk was selected.
 */
function filterHunk(hunk: RawHunk, selected: Set<number> | 'all'): string[] | null {
  if (selected === 'all') return [hunk.header, ...hunk.lines]

  const body: string[] = []
  let oldCount = 0
  let newCount = 0
  let changed = false

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]!
    const marker = line[0]
    const isSelected = selected.has(i)

    if (marker === '+') {
      if (isSelected) {
        body.push(line)
        newCount++
        changed = true
      }
      // else: dropped entirely
    } else if (marker === '-') {
      if (isSelected) {
        body.push(line)
        oldCount++
        changed = true
      } else {
        body.push(` ${line.slice(1)}`)
        oldCount++
        newCount++
      }
    } else if (marker === '\\') {
      // "\ No newline at end of file" describes the line above it, so it
      // travels with that line or not at all.
      const previous = body[body.length - 1]
      if (previous !== undefined) body.push(line)
    } else {
      body.push(line)
      oldCount++
      newCount++
    }
  }

  if (!changed) return null

  const heading = HUNK_HEADER.exec(hunk.header)?.[5] ?? ''
  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${heading}`
  return [header, ...body]
}

/**
 * Build a patch containing only the selection.
 *
 * Returns null when the selection is empty. The `newStart` values are left
 * untouched even though staging one hunk shifts the ones after it — `git
 * apply` locates a hunk by its old-side position and the surrounding context,
 * and treating the new-side start as advisory is what lets independent hunks
 * be staged in any order.
 */
export function buildPatch(patch: RawPatch, selection: Selection): string | null {
  const out: string[] = []

  for (let i = 0; i < patch.hunks.length; i++) {
    const picked = selection.hunks.get(i)
    if (picked === undefined) continue
    const rendered = filterHunk(patch.hunks[i]!, picked)
    if (rendered) out.push(...rendered)
  }

  if (out.length === 0) return null
  return `${patch.header}\n${out.join('\n')}\n`
}

export interface ApplyOptions {
  cwd: string
  patch: string
  /** Apply to the index rather than the working tree. */
  cached?: boolean
  /** Undo the patch instead of applying it. */
  reverse?: boolean
}

export async function applyPatch(options: ApplyOptions): Promise<void> {
  const { cwd, patch, cached, reverse } = options
  const args = [
    'apply',
    ...(cached ? ['--cached'] : []),
    ...(reverse ? ['--reverse'] : []),
    // Our rewritten hunks have correct counts, but --recount costs nothing and
    // covers the "\ No newline" edge cases where a line is elided.
    '--recount',
    // Whitespace is the user's business; silently fixing it would stage
    // something they never wrote.
    '--whitespace=nowarn',
    '--unidiff-zero',
    '-'
  ]

  try {
    await git(args, { cwd, stdin: patch })
  } catch (err) {
    if (err instanceof GitError) {
      throw new Error(`Could not apply the selected changes: ${err.stderr.trim()}`, {
        cause: err
      })
    }
    throw err
  }
}

/** Which side of the file a partial operation reads its diff from. */
export type PatchSource = 'worktree' | 'index'

async function rawDiff(cwd: string, path: string, source: PatchSource): Promise<string> {
  return git(
    [
      'diff',
      ...(source === 'index' ? ['--cached'] : []),
      '--no-color',
      '--no-ext-diff',
      // Rename detection would produce a header `git apply` cannot re-apply
      // against a single path, and the rename itself is already staged.
      '--no-renames',
      // Zero context makes adjacent selections independent: with the default
      // three lines, staging one hunk leaves the next one unable to match.
      '--unified=0',
      '--',
      path
    ],
    { cwd }
  )
}

export interface PartialRequest {
  cwd: string
  path: string
  /** Hunk index -> selected line indices, or 'all' for a whole hunk. */
  selection: Selection
}

/**
 * Stage part of a file.
 *
 * Reads the worktree diff, keeps the selection, and applies it to the index.
 */
export async function stagePartial(req: PartialRequest): Promise<void> {
  const patch = splitPatch(await rawDiff(req.cwd, req.path, 'worktree'))
  if (!patch) throw new Error('Nothing to stage in this file')
  const text = buildPatch(patch, req.selection)
  if (!text) throw new Error('Nothing selected')
  await applyPatch({ cwd: req.cwd, patch: text, cached: true })
}

/**
 * Unstage part of a file, by reversing the selection out of the index.
 *
 * The diff comes from the index side, since that is what is being undone.
 */
export async function unstagePartial(req: PartialRequest): Promise<void> {
  const patch = splitPatch(await rawDiff(req.cwd, req.path, 'index'))
  if (!patch) throw new Error('Nothing to unstage in this file')
  const text = buildPatch(patch, req.selection)
  if (!text) throw new Error('Nothing selected')
  await applyPatch({ cwd: req.cwd, patch: text, cached: true, reverse: true })
}

/**
 * Throw away part of a file's uncommitted changes.
 *
 * This is the one operation here that destroys work, and it is not
 * recoverable through git — the content was never committed and is not in the
 * index. The caller is responsible for confirming.
 */
export async function discardPartial(req: PartialRequest): Promise<void> {
  const patch = splitPatch(await rawDiff(req.cwd, req.path, 'worktree'))
  if (!patch) throw new Error('Nothing to discard in this file')
  const text = buildPatch(patch, req.selection)
  if (!text) throw new Error('Nothing selected')
  await applyPatch({ cwd: req.cwd, patch: text, reverse: true })
}

/** Throw away every uncommitted change to a file. */
export async function discardFile(cwd: string, path: string): Promise<void> {
  // `restore` covers tracked files; an untracked one has nothing to restore
  // from and has to be removed outright.
  const tracked = await git(['ls-files', '--error-unmatch', '--', path], { cwd })
    .then(() => true)
    .catch(() => false)

  if (tracked) {
    await git(['restore', '--worktree', '--', path], { cwd })
  } else {
    await git(['clean', '--force', '--', path], { cwd })
  }
}

/** The hunks of a file, for the staging UI to select against. */
export async function readPatch(
  cwd: string,
  path: string,
  source: PatchSource
): Promise<RawPatch | null> {
  return splitPatch(await rawDiff(cwd, path, source))
}
