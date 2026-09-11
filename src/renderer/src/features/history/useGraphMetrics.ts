import { useMemo } from 'react'
import { measureVar } from '@/lib/measure'
import type { GraphMetrics } from '@shared/graphLayout'

export { fitLanes, type GraphMetrics } from '@shared/graphLayout'

const FALLBACK: GraphMetrics = { row: 28, lane: 14, node: 8, stroke: 2, maxWidth: 176 }

/**
 * Measured once per session and cached at module scope.
 *
 * These tokens are pure geometry — they do not vary with theme — so measuring
 * in an effect would only cost every consumer a second render pass. The cache
 * is populated on first use rather than at import time, because the stylesheet
 * may not have been applied yet when this module is evaluated.
 */
let cached: GraphMetrics | null = null

export function useGraphMetrics(): GraphMetrics {
  return useMemo(() => {
    cached ??= {
      row: measureVar('--layout-row-height', FALLBACK.row),
      lane: measureVar('--graph-lane-width', FALLBACK.lane),
      node: measureVar('--graph-node-size', FALLBACK.node),
      stroke: measureVar('--graph-stroke-width', FALLBACK.stroke),
      maxWidth: measureVar('--graph-max-width', FALLBACK.maxWidth)
    }
    return cached
  }, [])
}
