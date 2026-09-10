import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Minus, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { measureVar, monoCharWidth } from '@/lib/measure'
import { usePatch } from '@/stores/patch'
import { useRepo } from '@/stores/repo'

/**
 * The working-tree diff, with per-line selection.
 *
 * Separate from DiffPanel rather than a mode of it: a commit's diff has
 * nothing to select, and threading "is this selectable" through every row
 * would complicate the read-only path for no benefit.
 */

type Row =
  | { kind: 'hunk'; hunk: number; header: string }
  | { kind: 'line'; hunk: number; line: number; text: string }

const OVERSCAN = 24

export function StagingDiff(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const selection = useRepo((s) => s.selection)

  const patch = usePatch((s) => s.patch)
  const path = usePatch((s) => s.path)
  const staged = usePatch((s) => s.staged)
  const selected = usePatch((s) => s.selected)
  const busy = usePatch((s) => s.busy)
  const error = usePatch((s) => s.error)
  const load = usePatch((s) => s.load)
  const toggleLine = usePatch((s) => s.toggleLine)
  const toggleHunk = usePatch((s) => s.toggleHunk)
  const hunkTally = usePatch((s) => s.hunkTally)
  const apply = usePatch((s) => s.apply)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (root && selection) void load(root, selection.path, selection.staged)
  }, [root, selection, load])

  const rows = useMemo<Row[]>(() => {
    if (!patch) return []
    const out: Row[] = []
    for (let h = 0; h < patch.hunks.length; h++) {
      const hunk = patch.hunks[h]!
      out.push({ kind: 'hunk', hunk: h, header: hunk.header })
      for (let l = 0; l < hunk.lines.length; l++) {
        out.push({ kind: 'line', hunk: h, line: l, text: hunk.lines[l]! })
      }
    }
    return out
  }, [patch])

  const rowHeight = useMemo(() => measureVar('--diff-row-height', 20), [])
  const headerHeight = useMemo(() => measureVar('--layout-row-height', 28), [])

  const contentWidth = useMemo(() => {
    if (rows.length === 0) return 0
    let longest = 0
    for (const row of rows) {
      const length = row.kind === 'hunk' ? row.header.length : row.text.length
      if (length > longest) longest = length
    }
    return 48 + longest * monoCharWidth()
  }, [rows])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'hunk' ? headerHeight : rowHeight),
    overscan: OVERSCAN
  })

  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-default">
        <p className="text-xs text-content-tertiary">Select a file to view its diff</p>
      </div>
    )
  }

  if (!patch || rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-surface-default">
        <p className="text-xs text-content-tertiary">
          {error ?? 'No line-level changes in this file'}
        </p>
        {!error && (
          <p className="text-2xs text-content-tertiary">
            Binary files and mode changes are staged whole
          </p>
        )}
      </div>
    )
  }

  const count = selected.size

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-default">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-xs">
        <span className="truncate font-medium">{path}</span>
        <span className="shrink-0 text-2xs text-content-tertiary">
          {staged ? 'staged' : 'not staged'}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="text-2xs tabular-nums text-content-tertiary">
            {count > 0 ? `${count} selected` : 'Click a line to select'}
          </span>
          {staged ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0 || busy}
              onClick={() => root && void apply(root, 'unstage')}
              className="h-5 gap-1 px-1.5 text-2xs"
            >
              <Minus className="size-3" />
              Unstage
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0 || busy}
              onClick={() => root && void apply(root, 'stage')}
              className="h-5 gap-1 px-1.5 text-2xs"
            >
              <Plus className="size-3" />
              Stage
            </Button>
          )}
          {!staged && (
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0 || busy}
              // Discarding is the one action here that destroys work: the
              // content was never committed and is not in the index.
              onClick={() => {
                if (!root) return
                if (
                  window.confirm(
                    `Discard ${count} selected ${count === 1 ? 'line' : 'lines'}? This cannot be undone.`
                  )
                ) {
                  void apply(root, 'discard')
                }
              }}
              className="h-5 gap-1 px-1.5 text-2xs text-danger-content hover:text-danger-content"
            >
              <Undo2 className="size-3" />
              Discard
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="shrink-0 border-b border-border-subtle bg-danger-subtle px-3 py-1 text-2xs text-danger-content">
          {error}
        </p>
      )}

      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-auto font-mono text-sm"
        style={{ tabSize: 2 }}
      >
        {/* min-width fills the pane so a row's background spans it, while the
            explicit width still drives horizontal scrolling for long lines. */}
        <div
          className="relative min-w-full"
          style={{ height: virtualizer.getTotalSize(), width: contentWidth }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null

            if (row.kind === 'hunk') {
              const tally = hunkTally(row.hunk)
              const allPicked = tally.total > 0 && tally.picked === tally.total
              return (
                <div
                  key={item.index}
                  className="absolute left-0 top-0 flex w-full items-center gap-2 bg-diff-hunk-bg px-2"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <button
                    type="button"
                    onClick={() => toggleHunk(row.hunk)}
                    title={allPicked ? 'Deselect this hunk' : 'Select this hunk'}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-xs border',
                      allPicked
                        ? 'border-accent-bg bg-accent-bg text-accent-content'
                        : tally.picked > 0
                          ? 'border-accent-bg text-accent-bg'
                          : 'border-border-default text-transparent hover:border-border-strong'
                    )}
                  >
                    {allPicked ? (
                      <Check className="size-2.5" />
                    ) : tally.picked > 0 ? (
                      <Minus className="size-2.5" />
                    ) : (
                      <Check className="size-2.5" />
                    )}
                  </button>
                  <span className="selectable truncate whitespace-pre text-2xs text-diff-hunk-content">
                    {row.header}
                  </span>
                </div>
              )
            }

            const marker = row.text[0]
            const isChange = marker === '+' || marker === '-'
            const picked = selected.has(`${row.hunk}:${row.line}`)

            return (
              <div
                key={item.index}
                onClick={(e) => {
                  if (isChange) toggleLine({ hunk: row.hunk, line: row.line }, !e.shiftKey)
                }}
                className={cn(
                  'absolute left-0 top-0 flex w-full items-center gap-1 px-2',
                  marker === '+' && 'bg-diff-add-bg text-diff-add-content',
                  marker === '-' && 'bg-diff-del-bg text-diff-del-content',
                  marker === '\\' && 'italic text-content-tertiary',
                  isChange && 'cursor-default',
                  // The selected line is marked with a rail rather than a
                  // background, so the add/delete colour still reads through.
                  picked && 'shadow-[inset_2px_0_0_0_var(--accent-bg)]'
                )}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span
                  className={cn(
                    'w-3 shrink-0 select-none text-center text-2xs',
                    picked ? 'text-accent-bg' : 'text-content-disabled'
                  )}
                >
                  {picked ? '●' : isChange ? '' : ''}
                </span>
                <span className="selectable whitespace-pre">{row.text}</span>
              </div>
            )
          })}
        </div>
      </div>

      <p className="shrink-0 border-t border-border-subtle px-3 py-0.5 text-2xs text-content-tertiary">
        Click a line to select it, shift-click to add to the selection, or use a hunk&apos;s
        checkbox.
      </p>
    </div>
  )
}
