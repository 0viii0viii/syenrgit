import { useMemo } from 'react'
import { measureVar } from './measure'

export interface ListMetrics {
  /** Height of a file/commit row, px. */
  row: number
  /** Height of a sticky section header, px. */
  header: number
}

const FALLBACK: ListMetrics = { row: 28, header: 24 }

/**
 * Row geometry read from the design tokens.
 *
 * A virtualizer needs these as numbers before anything is mounted, so they are
 * measured from the tokens rather than from a rendered row — that keeps the
 * CSS authoritative without making the list depend on its own output.
 */
let cached: ListMetrics | null = null

export function useListMetrics(): ListMetrics {
  return useMemo(() => {
    cached ??= {
      row: measureVar('--layout-row-height', FALLBACK.row),
      header: measureVar('--layout-section-header', FALLBACK.header)
    }
    return cached
  }, [])
}
