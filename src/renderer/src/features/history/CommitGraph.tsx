import { useMemo } from 'react'
import { laneColorVar } from '@/lib/measure'
import { fitLanes, type GraphMetrics } from './useGraphMetrics'
import type { GraphRow } from '@shared/git'

interface Props {
  rows: GraphRow[]
  width: number
  metrics: GraphMetrics
  /** First row index to draw (inclusive). */
  from: number
  /** Last row index to draw (inclusive). */
  to: number
}

/**
 * The lane graph, drawn as one SVG behind the commit rows.
 *
 * A single SVG rather than one per row: an edge spans the band *between* two
 * rows, so per-row SVGs would clip every diagonal at the boundary.
 *
 * The element is sized to the full list, but only the rows in [from, to] are
 * emitted — at 500+ commits the path count is what costs, not the canvas.
 * Because a row's edges are drawn in the band *below* it, edge emission starts
 * one row earlier than node emission or the topmost visible row would have no
 * line arriving into it.
 */
export function CommitGraph({ rows, width, metrics, from, to }: Props): React.JSX.Element {
  const ROW = metrics.row
  const STROKE = metrics.stroke
  // Spacing is derived from how many lanes there actually are, so a wide graph
  // tightens rather than pushing the commit subjects off screen.
  const { lane: LANE, node: NODE, width: COLUMN } = fitLanes(metrics, width)

  // A lane beyond the column is pinned to its edge rather than drawn outside
  // it, so a commit in a clipped lane still shows a node on its own row.
  const laneX = (lane: number): number =>
    Math.min(lane * LANE + LANE / 2, COLUMN - NODE / 2 - STROKE / 2)
  const rowY = (index: number): number => index * ROW + ROW / 2

  const edgeStart = Math.max(0, from - 1)
  const edgeEnd = Math.min(rows.length - 1, to)

  const paths = useMemo(() => {
    const x = (lane: number): number =>
      Math.min(lane * LANE + LANE / 2, COLUMN - NODE / 2 - STROKE / 2)
    const y = (index: number): number => index * ROW + ROW / 2

    const out: { d: string; color: string; key: string }[] = []
    for (let i = edgeStart; i <= edgeEnd; i++) {
      const r = rows[i]
      if (!r) continue
      const y1 = y(i)
      const y2 = y(i + 1)
      for (let e = 0; e < r.edges.length; e++) {
        const edge = r.edges[e]!
        const x1 = x(edge.fromLane)
        const x2 = x(edge.toLane)
        // Straight runs stay crisp as lines; only real lane changes curve.
        const d =
          x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
        out.push({ d, color: laneColorVar(edge.color), key: `${i}-${e}` })
      }
    }
    return out
  }, [rows, ROW, LANE, NODE, COLUMN, STROKE, edgeStart, edgeEnd])

  const nodes = useMemo(() => {
    // Carry the index alongside the row: looking it up per node with indexOf
    // would reintroduce a full-list scan on every frame.
    const out: { row: GraphRow; index: number }[] = []
    for (let i = from; i <= Math.min(to, rows.length - 1); i++) {
      const r = rows[i]
      if (r) out.push({ row: r, index: i })
    }
    return out
  }, [rows, from, to])

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={COLUMN}
      height={rows.length * ROW}
      aria-hidden="true"
    >
      <g fill="none" strokeWidth={STROKE} strokeLinecap="round">
        {paths.map((p) => (
          <path key={p.key} d={p.d} style={{ stroke: p.color }} />
        ))}
      </g>
      {nodes.map(({ row: r, index }) => {
        const color = laneColorVar(r.color)
        return r.isMerge ? (
          // Merge commits read as rings so they are findable while scanning.
          <circle
            key={r.hash}
            cx={laneX(r.lane)}
            cy={rowY(index)}
            r={NODE / 2}
            strokeWidth={STROKE}
            style={{ stroke: color, fill: 'var(--graph-merge-node-ring)' }}
          />
        ) : (
          <circle
            key={r.hash}
            cx={laneX(r.lane)}
            cy={rowY(index)}
            r={NODE / 2}
            style={{ fill: color }}
          />
        )
      })}
    </svg>
  )
}
