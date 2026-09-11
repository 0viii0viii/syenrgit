/**
 * Geometry shared by the graph column and the rows beside it.
 *
 * Lives in shared rather than the renderer so the rule that keeps the graph
 * from crowding out the commit subjects can be tested without a DOM.
 */

export interface GraphMetrics {
  /** Height of one commit row, px. */
  row: number
  /** Preferred horizontal spacing between lanes, px. */
  lane: number
  /** Diameter of a commit node, px. */
  node: number
  /** Edge stroke width, px. */
  stroke: number
  /** The widest the graph column may become, px. */
  maxWidth: number
}

export interface FittedLanes {
  /** Horizontal spacing actually used between lanes, px. */
  lane: number
  /** Diameter actually used for a commit node, px. */
  node: number
  /** Total width of the graph column, px. */
  width: number
  /** Lanes past this index fall outside the column and are clipped. */
  visibleLanes: number
}

/** Below this a node stops reading as a dot and starts reading as dirt. */
const MIN_NODE = 3

/** Below this, lanes stop being separate lines and become a smear. */
const MIN_LANE = 4

/**
 * Lane spacing that keeps the column inside its budget.
 *
 * A repository with thirty open branches genuinely has thirty lanes — that is
 * correct output, not a glitch. At the preferred spacing it would be a 420px
 * column and the commit subjects would start off the right edge of the pane,
 * which is how the graph came to be suppressed entirely for such repositories.
 * Tightening the spacing instead keeps every lane visible and the text where it
 * belongs; nodes shrink with it so they never overlap their neighbours.
 */
export function fitLanes(metrics: GraphMetrics, laneCount: number): FittedLanes {
  const lanes = Math.max(laneCount, 1)
  const lane = Math.max(MIN_LANE, Math.min(metrics.lane, metrics.maxWidth / lanes))
  const node = Math.max(MIN_NODE, Math.min(metrics.node, lane * 0.62))
  // Compression has a floor, so past roughly forty lanes the column would grow
  // again. It is clipped instead: the far lanes are cut off at the column edge
  // rather than allowed to push the commit subjects out of the pane.
  const width = Math.min(lane * lanes, metrics.maxWidth)
  return { lane, node, width, visibleLanes: Math.floor(width / lane) }
}
