import type { CommitSummary, GraphEdge, GraphRow } from '@shared/git.js'

/**
 * Lay out a commit list as a lane graph.
 *
 * Model: a "lane" is a stable column index holding the hash of the commit it is
 * currently waiting to reach. Lanes are never compacted mid-graph, so a line is
 * straight whenever its endpoints share a lane index and the renderer only has
 * to curve on an actual branch or merge.
 *
 * Edges span the band between row i and row i+1, but a band is only fully
 * determined once row i+1 is known (that is where lanes converge onto a node).
 * So each row's edges are emitted one iteration late, while processing the row
 * below it.
 *
 * `laneOrigins[j]` records where lane j's line starts on the previous row. It
 * is a list, not a scalar, because a lane can legitimately receive two lines at
 * once: its own continuation from above plus a merge diagonal from a commit on
 * another lane.
 */
export function buildGraph(commits: CommitSummary[]): GraphRow[] {
  /** Hash each lane is waiting for; null when the lane is free. */
  const lanes: (string | null)[] = []
  /** Stable color index per lane, reassigned when a lane is recycled. */
  const laneColor: number[] = []
  /** Lane indices on the previous row that feed into each lane. */
  let laneOrigins: number[][] = []

  const rows: GraphRow[] = []
  let nextColor = 0

  const firstFree = (): number => {
    const idx = lanes.indexOf(null)
    if (idx !== -1) return idx
    lanes.push(null)
    laneColor.push(0)
    laneOrigins.push([])
    return lanes.length - 1
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!

    // Lanes that were waiting for this commit. The leftmost becomes the node's
    // lane; the rest converge onto it and are freed.
    const waiting: number[] = []
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] === commit.hash) waiting.push(j)
    }

    const nodeLane = waiting.length > 0 ? waiting[0]! : firstFree()

    // --- Close out the band above: emit into rows[i - 1] --------------------
    // Done here because convergence onto `nodeLane` is only known now.
    if (i > 0) {
      const edges: GraphEdge[] = []
      for (let j = 0; j < lanes.length; j++) {
        const held = lanes[j]
        if (held === null) continue
        const toLane = held === commit.hash ? nodeLane : j
        for (const fromLane of laneOrigins[j] ?? []) {
          edges.push({ fromLane, toLane, color: laneColor[j] ?? 0 })
        }
      }
      rows[i - 1]!.edges = edges
    }

    if (waiting.length === 0) {
      // A tip: nothing above points at it, so the lane starts here.
      lanes[nodeLane] = commit.hash
      laneColor[nodeLane] = nextColor++
    }

    const color = laneColor[nodeLane] ?? 0

    // Every additional lane that was waiting terminates at this node.
    for (const j of waiting.slice(1)) {
      lanes[j] = null
    }

    // --- Hand the lanes over to this commit's parents -----------------------
    laneOrigins = lanes.map((_, j) => [j])

    const [firstParent, ...otherParents] = commit.parents

    if (firstParent === undefined) {
      // Root commit: the lane ends here.
      lanes[nodeLane] = null
    } else {
      lanes[nodeLane] = firstParent
      laneOrigins[nodeLane] = [nodeLane]
    }

    for (const parent of otherParents) {
      const existing = lanes.indexOf(parent)
      if (existing === -1) {
        // The merged branch is not on screen yet: open a lane for it, fed
        // solely by a diagonal out of this node.
        const lane = firstFree()
        lanes[lane] = parent
        laneColor[lane] = nextColor++
        laneOrigins[lane] = [nodeLane]
      } else {
        // The parent is already flowing down another lane. That lane keeps its
        // own straight continuation AND gains a diagonal from this node.
        const origins = laneOrigins[existing] ?? []
        if (!origins.includes(nodeLane)) origins.push(nodeLane)
        laneOrigins[existing] = origins
      }
    }

    let width = 0
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] !== null) width = j + 1
    }

    rows.push({
      hash: commit.hash,
      lane: nodeLane,
      color,
      isMerge: commit.parents.length > 1,
      edges: [],
      width: Math.max(width, nodeLane + 1)
    })
  }

  // The last row has no band below it; its edges stay empty.
  return rows
}

/** Widest lane count across the graph — the renderer's column width. */
export function graphWidth(rows: GraphRow[]): number {
  let max = 0
  for (const row of rows) {
    if (row.width > max) max = row.width
    for (const e of row.edges) {
      const w = Math.max(e.fromLane, e.toLane) + 1
      if (w > max) max = w
    }
  }
  return max
}
