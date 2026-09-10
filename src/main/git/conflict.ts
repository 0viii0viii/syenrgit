import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, gitBuffer, splitNul, GitError } from './exec.js'
import { conflictLabels } from './repo.js'
import type { ConflictSide, ConflictStages } from '@shared/git.js'

const STAGE_NUMBER: Record<ConflictSide, 1 | 2 | 3> = {
  base: 1,
  ours: 2,
  theirs: 3
}

/**
 * Read one index stage of a conflicted path.
 *
 * Returns null when the stage is absent — which is normal and meaningful:
 * an add/add conflict has no stage 1, a delete/modify conflict is missing
 * stage 2 or 3. The UI needs that distinction to label the conflict correctly.
 */
async function readStage(
  cwd: string,
  path: string,
  side: ConflictSide
): Promise<string | null> {
  try {
    const buf = await gitBuffer(['show', `:${STAGE_NUMBER[side]}:${path}`], { cwd })
    return buf.toString('utf8')
  } catch (err) {
    if (err instanceof GitError) return null
    throw err
  }
}

/**
 * Load the three sides of a conflict straight out of the index.
 *
 * We deliberately do NOT parse the `<<<<<<<` / `=======` / `>>>>>>>` markers
 * out of the working-tree file. Marker parsing breaks on nested conflicts,
 * on files whose own content contains marker-like lines, and on any file where
 * the user has already started editing. The index stages are the source of
 * truth git itself uses.
 */
export async function getConflictStages(
  cwd: string,
  path: string
): Promise<ConflictStages> {
  const [base, ours, theirs, labels] = await Promise.all([
    readStage(cwd, path, 'base'),
    readStage(cwd, path, 'ours'),
    readStage(cwd, path, 'theirs'),
    conflictLabels(cwd)
  ])

  return { path, base, ours, theirs, oursLabel: labels.ours, theirsLabel: labels.theirs }
}

/** Paths currently in an unmerged state. */
export async function listConflicts(cwd: string): Promise<string[]> {
  const raw = await git(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd })
  return splitNul(raw)
}

/**
 * Write a resolved file and stage it. Staging is what actually marks the
 * conflict resolved — it collapses the three index stages down to stage 0.
 */
export async function resolveConflict(
  cwd: string,
  path: string,
  content: string
): Promise<void> {
  await writeFile(join(cwd, path), content, 'utf8')
  await git(['add', '--', path], { cwd })
}

/**
 * Resolve wholesale by taking one side.
 *
 * When the chosen side deleted the path there is no blob to check out — its
 * index stage is simply absent — and taking that side means accepting the
 * deletion. `git checkout --ours` fails outright on a delete/modify conflict,
 * so the missing stage is detected first rather than surfaced as an error.
 */
export async function takeSide(
  cwd: string,
  path: string,
  side: Exclude<ConflictSide, 'base'>
): Promise<void> {
  const content = await readStage(cwd, path, side)
  if (content === null) {
    await git(['rm', '--force', '--', path], { cwd })
    return
  }
  await git(['checkout', `--${side}`, '--', path], { cwd })
  await git(['add', '--', path], { cwd })
}

/**
 * Re-materialise the working-tree file with conflict markers.
 *
 * `zdiff3` is the modern default: it shows the common base alongside both
 * sides, which is what makes a 3-way merge view actually decidable. Used when
 * the user wants to drop back to text editing after an abandoned resolution.
 */
export async function restoreMarkers(cwd: string, path: string): Promise<void> {
  await git(['checkout', '--merge', '--conflict=zdiff3', '--', path], { cwd })
}

/** Undo a resolution: put the path back into its unmerged state. */
export async function unresolve(cwd: string, path: string): Promise<void> {
  await git(['reset', '--', path], { cwd })
  await restoreMarkers(cwd, path)
}
