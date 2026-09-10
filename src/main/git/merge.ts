import { diffIndices } from 'node-diff3'
import type { MergeChunk, MergeChunkType, MergeDocument, MergeKind } from '@shared/git.js'
import { getConflictStages } from './conflict.js'

/**
 * Split into lines for merging.
 *
 * Plain `split('\n')` on purpose: it keeps the trailing empty element for a
 * file that ends with a newline, so `join('\n')` round-trips byte-for-byte and
 * a "no newline at end of file" difference is visible to the diff rather than
 * silently normalised away.
 */
function toLines(text: string | null): string[] {
  if (text === null) return []
  return text.split('\n')
}

interface Hunk {
  side: 'ours' | 'theirs'
  oStart: number
  oLength: number
  xStart: number
  xLength: number
}

function hunksFor(base: string[], other: string[], side: Hunk['side']): Hunk[] {
  return diffIndices(base, other).map((d) => ({
    side,
    oStart: d.buffer1[0],
    oLength: d.buffer1[1],
    xStart: d.buffer2[0],
    xLength: d.buffer2[1]
  }))
}

function sameLines(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Three-way merge into aligned chunks.
 *
 * Built from two two-way diffs against the base rather than from
 * `diff3MergeRegions`, because a 3-pane editor needs the base/ours/theirs
 * ranges for *every* region — including the auto-merged ones, where the
 * library reports only the winning side's text.
 */
export function buildMergeChunks(
  base: string[],
  ours: string[],
  theirs: string[]
): MergeChunk[] {
  const oursHunks = hunksFor(base, ours, 'ours')
  const theirsHunks = hunksFor(base, theirs, 'theirs')

  const all = [...oursHunks, ...theirsHunks].sort(
    (a, b) => a.oStart - b.oStart || a.oLength - b.oLength
  )

  const chunks: MergeChunk[] = []
  let id = 0

  // Positions are tracked incrementally rather than derived from a base->side
  // index map. A map is ambiguous at a pure insertion: base index i
  // corresponds to both "before" and "after" the inserted lines, and resolving
  // that the wrong way makes the preceding stable region swallow the insert.
  let basePos = 0
  let oursPos = 0
  let theirsPos = 0

  const pushStable = (until: number): void => {
    const length = until - basePos
    if (length <= 0) return
    chunks.push({
      id: id++,
      type: 'unchanged',
      base: base.slice(basePos, until),
      ours: ours.slice(oursPos, oursPos + length),
      theirs: theirs.slice(theirsPos, theirsPos + length)
    })
    basePos = until
    oursPos += length
    theirsPos += length
  }

  for (let i = 0; i < all.length; ) {
    // Grow a group while the next hunk still touches the region. Adjacent
    // hunks are merged too: two changes with no surviving base line between
    // them cannot be resolved independently.
    const first = all[i]!
    const regionStart = first.oStart
    let regionEnd = first.oStart + first.oLength
    const group: Hunk[] = [first]

    let j = i + 1
    while (j < all.length) {
      const next = all[j]!
      if (next.oStart > regionEnd) break
      group.push(next)
      regionEnd = Math.max(regionEnd, next.oStart + next.oLength)
      j++
    }
    i = j

    pushStable(regionStart)

    // Inside the region a side tracks the base exactly except for its own
    // hunks, so its length is the base length plus those hunks' deltas.
    const regionLength = regionEnd - regionStart
    const delta = (side: Hunk['side']): number =>
      group.reduce((sum, h) => (h.side === side ? sum + h.xLength - h.oLength : sum), 0)

    const oursLength = regionLength + delta('ours')
    const theirsLength = regionLength + delta('theirs')

    const baseSlice = base.slice(regionStart, regionEnd)
    const oursSlice = ours.slice(oursPos, oursPos + oursLength)
    const theirsSlice = theirs.slice(theirsPos, theirsPos + theirsLength)

    const touchedOurs = group.some((h) => h.side === 'ours')
    const touchedTheirs = group.some((h) => h.side === 'theirs')

    let type: MergeChunkType
    if (touchedOurs && touchedTheirs) {
      type = sameLines(oursSlice, theirsSlice) ? 'both-same' : 'conflict'
    } else if (touchedOurs) {
      type = 'ours'
    } else {
      type = 'theirs'
    }

    chunks.push({ id: id++, type, base: baseSlice, ours: oursSlice, theirs: theirsSlice })

    basePos = regionEnd
    oursPos += oursLength
    theirsPos += theirsLength
  }

  pushStable(base.length)
  return chunks
}

/** The lines a chunk contributes when it is auto-merged. */
export function autoResolution(chunk: MergeChunk): string[] | null {
  switch (chunk.type) {
    case 'unchanged':
      return chunk.base
    case 'ours':
      return chunk.ours
    case 'theirs':
      return chunk.theirs
    case 'both-same':
      return chunk.ours
    case 'conflict':
      return null
  }
}

function isBinary(text: string | null): boolean {
  // A NUL byte in the first few KB is git's own heuristic for "not text".
  return text !== null && text.slice(0, 8000).includes('\0')
}

export async function getMergeDocument(cwd: string, path: string): Promise<MergeDocument> {
  const stages = await getConflictStages(cwd, path)

  const kind = ((): MergeKind => {
    if (isBinary(stages.base) || isBinary(stages.ours) || isBinary(stages.theirs)) {
      return 'binary'
    }
    // A missing stage is meaningful, not an error: stage 1 is absent for an
    // add/add, and stage 2 or 3 is absent when one side deleted the path.
    if (stages.ours === null) return 'deleted-by-us'
    if (stages.theirs === null) return 'deleted-by-them'
    if (stages.base === null) return 'add-add'
    return 'content'
  })()

  const chunks =
    kind === 'content' || kind === 'add-add'
      ? buildMergeChunks(
          toLines(stages.base),
          toLines(stages.ours),
          toLines(stages.theirs)
        )
      : []

  return {
    path,
    kind,
    oursLabel: stages.oursLabel,
    theirsLabel: stages.theirsLabel,
    chunks,
    conflictCount: chunks.filter((c) => c.type === 'conflict').length
  }
}
