import type { MergeChunk, MergeChunkType } from '@shared/git'
import { resolvedLines, sidesOf, type Resolution, type SidesIn } from '@shared/merge'

export type MergeRow =
  | {
      kind: 'action'
      chunkId: number
      resolution: Resolution | undefined
      /** 1-based position among conflicts, for "Conflict 2 of 7". */
      ordinal: number
    }
  | {
      kind: 'line'
      chunkId: number
      type: MergeChunkType
      /** First and last line of the chunk, so its extent can be drawn. */
      first: boolean
      last: boolean
      /**
       * Which sides this chunk's resolution keeps, for conflicts only. Lets a
       * pane show at a glance whether its block is in the result.
       */
      sides: SidesIn | null
      decided: boolean
      ours: string | null
      result: string | null
      theirs: string | null
    }

/**
 * Flatten chunks into aligned display rows.
 *
 * Every chunk occupies the same number of rows in all three panes, padded with
 * nulls, so the columns stay aligned without any cross-pane measurement. Each
 * conflict is preceded by an action row, which both gives the buttons a full
 * row of height and separates one conflict from the next visually.
 */
export function buildMergeRows(
  chunks: MergeChunk[],
  resolutions: Readonly<Record<number, Resolution>>
): MergeRow[] {
  const rows: MergeRow[] = []
  let ordinal = 0

  for (const chunk of chunks) {
    const resolution = resolutions[chunk.id]
    const result = resolvedLines(chunk, resolution)
    const isConflict = chunk.type === 'conflict'

    if (isConflict) {
      rows.push({ kind: 'action', chunkId: chunk.id, resolution, ordinal: ++ordinal })
    }

    const height = Math.max(chunk.ours.length, chunk.theirs.length, result?.length ?? 0)
    const sides = isConflict ? sidesOf(resolution) : null

    for (let i = 0; i < height; i++) {
      rows.push({
        kind: 'line',
        chunkId: chunk.id,
        type: chunk.type,
        first: i === 0,
        last: i === height - 1,
        sides,
        decided: resolution !== undefined,
        ours: chunk.ours[i] ?? null,
        result: result?.[i] ?? null,
        theirs: chunk.theirs[i] ?? null
      })
    }
  }

  // A file whose last line ends with a newline splits to a trailing empty
  // string. Keeping it in the data is what makes the write round-trip, but
  // rendering it adds a phantom blank row at the end of every file.
  const last = rows[rows.length - 1]
  if (last?.kind === 'line' && last.ours === '' && last.result === '' && last.theirs === '') {
    rows.pop()
  }

  return rows
}
