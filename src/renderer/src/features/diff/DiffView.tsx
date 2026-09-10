import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { measureVar, monoCharWidth } from '@/lib/measure'
import { useRepo } from '@/stores/repo'
import type { DiffHunk, DiffLine, FileDiff } from '@shared/git'

/** Row-level colors are driven entirely by the diff tokens in tokens/git.css. */
const LINE_CLASS: Record<DiffLine['kind'], string> = {
  add: 'bg-diff-add-bg text-diff-add-content',
  delete: 'bg-diff-del-bg text-diff-del-content',
  context: '',
  meta: 'text-content-tertiary italic'
}

const MARKER: Record<DiffLine['kind'], string> = {
  add: '+',
  delete: '-',
  context: ' ',
  meta: ''
}

const OVERSCAN = 24

type Row = { kind: 'hunk'; hunk: DiffHunk } | { kind: 'line'; line: DiffLine }

/** Flatten hunks and their lines into one indexable sequence. */
function buildRows(diff: FileDiff): Row[] {
  const rows: Row[] = []
  for (const hunk of diff.hunks) {
    rows.push({ kind: 'hunk', hunk })
    for (const line of hunk.lines) rows.push({ kind: 'line', line })
  }
  return rows
}

/** Longest rendered line, in characters, including the hunk headers. */
function longestLine(rows: Row[]): number {
  let max = 0
  for (const row of rows) {
    const len = row.kind === 'hunk' ? row.hunk.header.length : row.line.content.length
    if (len > max) max = len
  }
  return max
}

/** Digits needed for the widest line number on either side. */
function lineNumberDigits(rows: Row[]): number {
  let max = 0
  for (const row of rows) {
    if (row.kind !== 'line') continue
    if (row.line.oldLine !== null && row.line.oldLine > max) max = row.line.oldLine
    if (row.line.newLine !== null && row.line.newLine > max) max = row.line.newLine
  }
  return Math.max(2, String(max).length)
}

function LineNumber({ value, width }: { value: number | null; width: number }): React.JSX.Element {
  return (
    <span
      className="shrink-0 select-none px-1.5 text-right text-diff-linenum-content tabular-nums"
      style={{ width }}
    >
      {value ?? ''}
    </span>
  )
}

function DiffRow({
  line,
  gutter,
  numberWidth
}: {
  line: DiffLine
  gutter: number
  numberWidth: number
}): React.JSX.Element {
  return (
    <div className={cn('flex h-full items-center', LINE_CLASS[line.kind])}>
      <span
        className="sticky left-0 flex h-full shrink-0 items-center border-r border-border-subtle bg-inherit text-2xs"
        style={{ width: gutter }}
      >
        <LineNumber value={line.oldLine} width={numberWidth} />
        <LineNumber value={line.newLine} width={numberWidth} />
      </span>
      <span className="w-4 shrink-0 select-none text-center opacity-70">
        {MARKER[line.kind]}
      </span>
      <span className="selectable whitespace-pre pr-4">{line.content}</span>
    </div>
  )
}

function HunkHeader({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  return (
    <div className="flex h-full items-center bg-diff-hunk-bg px-2 text-2xs text-diff-hunk-content">
      <span className="selectable whitespace-pre">{hunk.header}</span>
    </div>
  )
}

interface DiffPanelProps {
  diff: FileDiff | null
  /** Shown when nothing is selected yet. */
  placeholder?: string
}

/**
 * Presentational diff renderer, shared by the working-tree view and the
 * commit-history view. It knows nothing about where the diff came from.
 */
export function DiffPanel({ diff, placeholder }: DiffPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => (diff ? buildRows(diff) : []), [diff])
  const rowHeight = useMemo(() => measureVar('--diff-row-height', 20), [])

  // The gutter is sized to the widest line number actually present. A fixed
  // width is wrong in both directions: it wastes space on a short file and
  // collides the two columns once line numbers reach four or five digits.
  const { gutter, numberWidth } = useMemo(() => {
    const char = monoCharWidth()
    const padding = 12 // px-1.5 on each side
    const min = measureVar('--diff-linenum-width', 52)
    const number = Math.ceil(lineNumberDigits(rows) * char + padding)
    const width = Math.max(min, number * 2)
    return { gutter: width, numberWidth: width / 2 }
  }, [rows])

  // Only the visible lines are mounted, so the container cannot size itself
  // from its contents — the horizontal scrollbar would jump on every scroll.
  // Width comes from the longest line instead.
  const contentWidth = useMemo(() => {
    if (rows.length === 0) return 0
    const MARKER_COL = 16
    const TRAILING_PAD = 16
    return gutter + MARKER_COL + TRAILING_PAD + longestLine(rows) * monoCharWidth()
  }, [rows, gutter])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN
  })

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-default">
        <p className="text-xs text-content-tertiary">
          {placeholder ?? 'Select a file to view its diff'}
        </p>
      </div>
    )
  }

  const empty = diff.combined
    ? { title: 'This file has conflicts', hint: 'Open the merge editor to resolve it' }
    : diff.binary
      ? { title: 'Binary file', hint: 'No textual diff' }
      : rows.length === 0
        ? { title: 'No changes', hint: null }
        : null

  return (
    // min-w-0 matters: the inner diff surface is sized to the longest line,
    // and without it a flex parent would grow to that width instead of
    // letting this pane scroll.
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-default">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-xs">
        <span className="truncate font-medium">{diff.path}</span>
        <span className="ml-auto flex gap-2 text-2xs tabular-nums">
          <span className="text-diff-add-content">+{diff.additions}</span>
          <span className="text-diff-del-content">&minus;{diff.deletions}</span>
        </span>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <p
            className={cn(
              'text-xs',
              diff.combined ? 'text-status-conflicted' : 'text-content-tertiary'
            )}
          >
            {empty.title}
          </p>
          {empty.hint && <p className="text-2xs text-content-tertiary">{empty.hint}</p>}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="scroll-thin min-h-0 flex-1 overflow-auto font-mono text-sm"
          style={{ tabSize: 2 }}
        >
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize(), width: contentWidth }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={item.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === 'hunk' ? (
                    <HunkHeader hunk={row.hunk} />
                  ) : (
                    <DiffRow line={row.line} gutter={gutter} numberWidth={numberWidth} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Working-tree / index diff for the Changes tab. */
export function DiffView(): React.JSX.Element {
  const diff = useRepo((s) => s.diff)
  const selection = useRepo((s) => s.selection)
  return <DiffPanel diff={selection ? diff : null} />
}
