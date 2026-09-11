import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { measureVar } from '@/lib/measure'
import { useMerge } from '@/stores/merge'
import { useRepo } from '@/stores/repo'
import { buildMergeRows, type MergeRow } from './merge-rows'
import { resolvedLines, sidesOf, toggleSide } from '@shared/merge'
import type { MergeChunkType } from '@shared/git'

type Pane = 'ours' | 'result' | 'theirs'

/**
 * Per-pane tint for a chunk.
 *
 * Auto-merged chunks stay visible rather than blending into context: a merge
 * tool that hides what it decided for you is how changes get lost silently.
 */
function cellClass(type: MergeChunkType, pane: Pane, resolved: boolean): string {
  if (type === 'conflict') {
    if (!resolved) return pane === 'result' ? 'bg-conflict-unresolved-bg' : ''
    return ''
  }
  if (type === 'unchanged') return ''
  if (type === 'both-same') return 'bg-conflict-base-bg'
  // 'ours' / 'theirs': tint the side that won, and the result it produced.
  if (type === 'ours' && (pane === 'ours' || pane === 'result')) return 'bg-conflict-ours-bg'
  if (type === 'theirs' && (pane === 'theirs' || pane === 'result')) {
    return 'bg-conflict-theirs-bg'
  }
  return ''
}

export function MergeEditor(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const refresh = useRepo((s) => s.refresh)
  const doc = useMerge((s) => s.doc)
  const resolutions = useMerge((s) => s.resolutions)
  const loading = useMerge((s) => s.loading)
  const saving = useMerge((s) => s.saving)
  const error = useMerge((s) => s.error)
  const setResolution = useMerge((s) => s.setResolution)
  const takeAll = useMerge((s) => s.takeAll)
  const clearResolution = useMerge((s) => s.clearResolution)
  const close = useMerge((s) => s.close)
  const save = useMerge((s) => s.save)

  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const rows = useMemo(
    () => (doc ? buildMergeRows(doc.chunks, resolutions) : []),
    [doc, resolutions]
  )

  const metrics = useMemo(
    () => ({
      line: measureVar('--diff-row-height', 20),
      action: measureVar('--layout-row-height', 28)
    }),
    []
  )

  // One virtualizer drives all three columns. The side panes mirror its
  // offsets and have their scrollTop synced, which keeps the panes aligned
  // without three independent measurements to reconcile.
  const resultRef = useRef<HTMLDivElement>(null)
  const oursRef = useRef<HTMLDivElement>(null)
  const theirsRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => resultRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'action' ? metrics.action : metrics.line),
    overscan: 20
  })

  const syncing = useRef(false)
  const syncScroll = useCallback((source: Pane, top: number) => {
    if (syncing.current) return
    syncing.current = true
    const targets = [
      ['ours', oursRef],
      ['result', resultRef],
      ['theirs', theirsRef]
    ] as const
    for (const [pane, ref] of targets) {
      if (pane !== source && ref.current && ref.current.scrollTop !== top) {
        ref.current.scrollTop = top
      }
    }
    // Released on the next frame so the scroll events this caused are ignored.
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }, [])

  const conflicts = doc?.chunks.filter((c) => c.type === 'conflict') ?? []
  const decided = conflicts.filter((c) => resolutions[c.id] !== undefined).length
  const remaining = conflicts.length - decided

  const jump = (delta: number): void => {
    const el = resultRef.current
    if (!el) return
    const targets = rows
      .map((r, i) => (r.kind === 'action' ? i : -1))
      .filter((i) => i >= 0)
    if (targets.length === 0) return
    const current = virtualizer.getVirtualItems()[0]?.index ?? 0
    const next =
      delta > 0
        ? (targets.find((i) => i > current) ?? targets[0]!)
        : ([...targets].reverse().find((i) => i < current) ?? targets[targets.length - 1]!)
    virtualizer.scrollToIndex(next, { align: 'start' })
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-default">
        <p className="text-xs text-content-tertiary">Loading merge…</p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-default">
        <p className="text-xs text-content-tertiary">{error ?? 'No conflict selected'}</p>
      </div>
    )
  }

  if (doc.kind !== 'content' && doc.kind !== 'add-add') {
    return <WholeFileConflict />
  }

  const columns: { pane: Pane; label: string; ref: React.RefObject<HTMLDivElement | null> }[] = [
    { pane: 'ours', label: `Ours · ${doc.oursLabel}`, ref: oursRef },
    { pane: 'result', label: 'Result', ref: resultRef },
    { pane: 'theirs', label: `Theirs · ${doc.theirsLabel}`, ref: theirsRef }
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-default">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-xs">
        <span className="truncate font-medium">{doc.path}</span>
        <span
          className={cn(
            'shrink-0 text-2xs',
            remaining === 0 ? 'text-success-content' : 'text-status-conflicted'
          )}
        >
          {remaining === 0
            ? `${conflicts.length} resolved`
            : `${remaining} of ${conflicts.length} unresolved`}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-6" onClick={() => jump(-1)}
            aria-label="Previous conflict">
            <ChevronUp className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6" onClick={() => jump(1)}
            aria-label="Next conflict">
            <ChevronDown className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 gap-0.5 px-2 text-2xs"
            title="Take our side for every conflict"
            onClick={() => takeAll('ours')}>
            <ChevronsRight className="size-3" />
            All ours
          </Button>
          <Button variant="ghost" size="sm" className="h-6 gap-0.5 px-2 text-2xs"
            title="Take their side for every conflict"
            onClick={() => takeAll('theirs')}>
            <ChevronsLeft className="size-3" />
            All theirs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-2xs"
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-6 gap-1 px-2 text-2xs"
            disabled={remaining > 0 || saving}
            onClick={async () => {
              if (!root) return
              if (await save(root)) {
                close()
                await refresh()
              }
            }}
          >
            <Check className="size-3" />
            {saving ? 'Saving…' : 'Mark resolved'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="shrink-0 border-b border-border-subtle bg-danger-subtle px-3 py-1 text-2xs text-danger-content">
          {error}
        </p>
      )}

      <div className="flex h-6 shrink-0 border-b border-border-subtle text-2xs">
        {columns.map(({ pane, label }) => (
          <div
            key={pane}
            className={cn(
              'flex flex-1 items-center truncate px-2 font-medium',
              pane !== 'theirs' && 'border-r border-border-subtle',
              pane === 'ours' && 'text-conflict-ours-content',
              pane === 'theirs' && 'text-conflict-theirs-content',
              pane === 'result' && 'text-content-secondary'
            )}
            title={label}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {columns.map(({ pane, ref }) => (
          <div
            key={pane}
            ref={ref}
            onScroll={(e) => syncScroll(pane, e.currentTarget.scrollTop)}
            className={cn(
              'min-w-0 flex-1 overflow-auto font-mono text-sm',
              pane === 'theirs' ? 'scroll-thin' : 'scroll-hide-y',
              pane !== 'theirs' && 'border-r border-border-subtle'
            )}
          >
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                if (!row) return null
                return (
                  <div
                    key={item.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  >
                    {row.kind === 'action' ? (
                      <ActionRow
                        row={row}
                        pane={pane}
                        onToggle={(side) => {
                          const next = toggleSide(row.resolution, side)
                          if (next) setResolution(row.chunkId, next)
                          else clearResolution(row.chunkId)
                        }}
                        onNeither={() => setResolution(row.chunkId, { kind: 'base' })}
                        onEdit={() => {
                          const chunk = doc.chunks.find((c) => c.id === row.chunkId)
                          const current = chunk
                            ? (resolvedLines(chunk, row.resolution) ?? chunk.ours)
                            : []
                          setDraft(current.join('\n'))
                          setEditing(row.chunkId)
                        }}
                      />
                    ) : (
                      <LineCell row={row} pane={pane} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit resolution</DialogTitle>
            <DialogDescription>
              These lines replace the conflicting region in the merged file.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="selectable h-64 w-full resize-none rounded-md border border-border-default bg-surface-inset p-2 font-mono text-sm leading-code outline-none focus-visible:border-border-focus"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (editing !== null) {
                  setResolution(editing, { kind: 'custom', lines: draft.split('\n') })
                }
                setEditing(null)
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One gutter arrow: puts a side into the result, or takes it back out. */
function SideArrow({
  side,
  active,
  onClick
}: {
  side: 'ours' | 'theirs'
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  // Each arrow points at the Result column it feeds, so the direction says
  // which way the lines travel rather than which column it sits in.
  const Icon = side === 'ours' ? ChevronsRight : ChevronsLeft
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Take ${side} back out of the result` : `Put ${side} into the result`}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-xs border',
        active
          ? side === 'ours'
            ? 'border-transparent bg-conflict-ours-content text-content-inverted'
            : 'border-transparent bg-conflict-theirs-content text-content-inverted'
          : 'border-border-default bg-surface-raised text-content-secondary hover:text-content-primary'
      )}
    >
      <Icon className="size-3" />
    </button>
  )
}

function ActionRow({
  row,
  pane,
  onToggle,
  onNeither,
  onEdit
}: {
  row: Extract<MergeRow, { kind: 'action' }>
  pane: Pane
  onToggle: (side: 'ours' | 'theirs') => void
  onNeither: () => void
  onEdit: () => void
}): React.JSX.Element {
  const decided = row.resolution !== undefined
  const sides = sidesOf(row.resolution)
  const custom = row.resolution?.kind === 'custom'

  const frame = cn(
    'flex h-full items-center gap-1 border-y px-2',
    decided
      ? 'border-border-subtle bg-surface-sunken'
      : 'border-conflict-unresolved-border bg-conflict-unresolved-bg/40'
  )

  // The arrows sit at each side pane's inner edge, next to the Result column
  // they feed — the position a gutter would occupy if the panes had one.
  if (pane === 'ours') {
    return (
      <div className={cn(frame, 'justify-end')}>
        <SideArrow side="ours" active={sides.ours} onClick={() => onToggle('ours')} />
      </div>
    )
  }

  if (pane === 'theirs') {
    return (
      <div className={frame}>
        <SideArrow side="theirs" active={sides.theirs} onClick={() => onToggle('theirs')} />
      </div>
    )
  }

  return (
    <div className={frame}>
      <span className="shrink-0 font-sans text-2xs text-content-tertiary">#{row.ordinal}</span>

      {custom && (
        <span className="shrink-0 font-sans text-2xs text-content-secondary">edited by hand</span>
      )}

      <button
        type="button"
        title="Take neither side — keep the common ancestor"
        onClick={onNeither}
        aria-pressed={row.resolution?.kind === 'base'}
        className={cn(
          'ml-auto flex size-5 shrink-0 items-center justify-center rounded-xs',
          row.resolution?.kind === 'base'
            ? 'bg-accent-bg text-accent-content'
            : 'text-content-tertiary hover:bg-surface-active hover:text-content-primary'
        )}
      >
        <X className="size-3" />
      </button>

      <button
        type="button"
        title="Edit this region by hand"
        onClick={onEdit}
        aria-pressed={custom}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-xs',
          custom
            ? 'bg-accent-bg text-accent-content'
            : 'text-content-tertiary hover:bg-surface-active hover:text-content-primary'
        )}
      >
        <Pencil className="size-3" />
      </button>
    </div>
  )
}

function LineCell({
  row,
  pane
}: {
  row: Extract<MergeRow, { kind: 'line' }>
  pane: Pane
}): React.JSX.Element {
  const text = pane === 'ours' ? row.ours : pane === 'theirs' ? row.theirs : row.result
  return (
    <div
      className={cn(
        'flex h-full items-center px-2',
        cellClass(row.type, pane, row.resolved),
        // A null means this pane has no line here — the other side is longer.
        text === null && 'bg-surface-inset/40'
      )}
    >
      <span className="selectable truncate whitespace-pre">{text ?? ''}</span>
    </div>
  )
}

/** Delete/modify and binary conflicts need a whole-file decision. */
function WholeFileConflict(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const refresh = useRepo((s) => s.refresh)
  const doc = useMerge((s) => s.doc)
  const close = useMerge((s) => s.close)
  const takeSide = useMerge((s) => s.takeSide)
  const busy = useMerge((s) => s.saving)
  if (!doc) return <div />

  const message =
    doc.kind === 'binary'
      ? 'This is a binary file, so it cannot be merged line by line.'
      : doc.kind === 'deleted-by-us'
        ? `Deleted on ${doc.oursLabel}, modified on ${doc.theirsLabel}.`
        : `Modified on ${doc.oursLabel}, deleted on ${doc.theirsLabel}.`

  const take = async (side: 'ours' | 'theirs'): Promise<void> => {
    if (!root) return
    if (await takeSide(root, side)) {
      close()
      await refresh()
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-default px-6 text-center">
      <p className="text-xs font-medium">{doc.path}</p>
      <p className="max-w-md text-xs text-content-secondary">{message}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void take('ours')}
        >
          Keep ours ({doc.oursLabel})
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void take('theirs')}
        >
          Keep theirs ({doc.theirsLabel})
        </Button>
      </div>
    </div>
  )
}
