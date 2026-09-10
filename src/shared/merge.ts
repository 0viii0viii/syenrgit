import type { MergeChunk } from './git.js'

/**
 * What the user chose for one conflicting chunk.
 *
 * 'both' and 'both-reverse' exist because concatenating the two sides is by
 * far the most common real resolution after picking one side outright, and
 * doing it by hand in a text box invites typos in code the user never read.
 */
export type Resolution =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  | { kind: 'both' }
  | { kind: 'both-reverse' }
  | { kind: 'base' }
  | { kind: 'custom'; lines: string[] }

/**
 * Concatenate two line runs as text, not as arrays.
 *
 * A trailing '' is the newline that terminates the first run, not a blank
 * line, so the second run continues from it. Appending naively puts a spurious
 * empty line between the two sides whenever a conflict reaches end of file —
 * which is every add/add conflict.
 */
function concatLines(first: string[], second: string[]): string[] {
  if (first.length === 0) return [...second]
  if (second.length === 0) return [...first]
  if (first[first.length - 1] === '') return [...first.slice(0, -1), ...second]
  return [...first, ...second]
}

/**
 * Lines a chunk contributes to the merged file.
 *
 * Returns null only for a conflict the user has not decided yet — that is the
 * signal that the file cannot be written back.
 */
export function resolvedLines(
  chunk: MergeChunk,
  resolution: Resolution | undefined
): string[] | null {
  if (chunk.type !== 'conflict') {
    switch (chunk.type) {
      case 'unchanged':
        return chunk.base
      case 'ours':
        return chunk.ours
      case 'theirs':
        return chunk.theirs
      case 'both-same':
        return chunk.ours
    }
  }

  if (!resolution) return null

  switch (resolution.kind) {
    case 'ours':
      return chunk.ours
    case 'theirs':
      return chunk.theirs
    case 'both':
      return concatLines(chunk.ours, chunk.theirs)
    case 'both-reverse':
      return concatLines(chunk.theirs, chunk.ours)
    case 'base':
      return chunk.base
    case 'custom':
      return resolution.lines
  }
}

/** True once every conflict has a decision. */
export function isFullyResolved(
  chunks: MergeChunk[],
  resolutions: Readonly<Record<number, Resolution>>
): boolean {
  return chunks.every((c) => resolvedLines(c, resolutions[c.id]) !== null)
}

/**
 * Assemble the merged file.
 *
 * Lines were produced by `split('\n')`, so joining reproduces the original
 * bytes exactly, including whether the file ended with a newline.
 */
export function assembleMerge(
  chunks: MergeChunk[],
  resolutions: Readonly<Record<number, Resolution>>
): string | null {
  const out: string[] = []
  for (const chunk of chunks) {
    const lines = resolvedLines(chunk, resolutions[chunk.id])
    if (lines === null) return null
    out.push(...lines)
  }
  return out.join('\n')
}
