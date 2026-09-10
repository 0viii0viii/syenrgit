import { useCallback, useMemo, useRef } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useListMetrics } from '@/lib/list-metrics'
import { isStaged, isUnstaged, primaryState, splitPath, stateMeta } from '@/lib/git-status'
import { useRepo } from '@/stores/repo'
import type { FileEntry } from '@shared/git'

type Row =
  | { kind: 'header'; title: string; count: number }
  | { kind: 'file'; entry: FileEntry; staged: boolean }

const OVERSCAN = 12

/**
 * Flatten the three groups into one list.
 *
 * Virtualization needs a single indexable sequence, so sections become header
 * rows inside the same array rather than separate scroll containers.
 */
function buildRows(files: FileEntry[]): Row[] {
  const conflicted = files.filter((f) => f.conflicted)
  const staged = files.filter(isStaged)
  const unstaged = files.filter((f) => isUnstaged(f) && !f.conflicted)

  const rows: Row[] = []
  const push = (title: string, entries: FileEntry[], isStagedGroup: boolean): void => {
    if (entries.length === 0) return
    rows.push({ kind: 'header', title, count: entries.length })
    for (const entry of entries) rows.push({ kind: 'file', entry, staged: isStagedGroup })
  }

  push('Conflicts', conflicted, false)
  push('Staged', staged, true)
  push('Changes', unstaged, false)
  return rows
}

function FileRow({
  entry,
  staged,
  selected,
  onSelect,
  onToggle
}: {
  entry: FileEntry
  staged: boolean
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}): React.JSX.Element {
  const meta = stateMeta(primaryState(entry))
  const { dir, name } = splitPath(entry.path)

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'group flex h-full cursor-default items-center gap-1.5 px-2',
        'hover:bg-surface-hover',
        selected && 'bg-surface-selected hover:bg-surface-selected'
      )}
    >
      <span
        className={cn('w-3 shrink-0 text-center font-mono text-2xs font-semibold', meta.color)}
        title={meta.label}
      >
        {meta.letter}
      </span>

      <span className="min-w-0 flex-1 truncate text-xs">
        {dir && <span className="text-content-tertiary">{dir}</span>}
        <span className={cn(entry.worktreeState === 'deleted' && 'line-through opacity-60')}>
          {name}
        </span>
        {entry.origPath && (
          <span className="ml-1 text-2xs text-content-tertiary">
            &larr; {splitPath(entry.origPath).name}
          </span>
        )}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        aria-label={staged ? `Unstage ${entry.path}` : `Stage ${entry.path}`}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-xs',
          'text-content-tertiary opacity-0 transition-opacity hover:bg-surface-active hover:text-content-primary',
          'group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        {staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
      </button>
    </div>
  )
}

export function ChangeList(): React.JSX.Element {
  const status = useRepo((s) => s.status)
  const selection = useRepo((s) => s.selection)
  const select = useRepo((s) => s.select)
  const stage = useRepo((s) => s.stage)
  const unstage = useRepo((s) => s.unstage)

  const metrics = useListMetrics()
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => buildRows(status?.files ?? []), [status])
  const headerIndexes = useMemo(
    () => rows.reduce<number[]>((acc, r, i) => (r.kind === 'header' ? [...acc, i] : acc), []),
    [rows]
  )

  // Index of the header that should be pinned to the top right now. Held in a
  // ref because rangeExtractor runs during layout, before render.
  const stickyIndex = useRef(-1)

  const rangeExtractor = useCallback(
    (range: Range) => {
      // The pinned header is usually scrolled out of the window, so it has to
      // be forced into the rendered set or it would vanish while its group is
      // still on screen.
      let active = -1
      for (const i of headerIndexes) {
        if (i <= range.startIndex) active = i
        else break
      }
      stickyIndex.current = active
      const set = new Set(defaultRangeExtractor(range))
      if (active >= 0) set.add(active)
      return [...set].sort((a, b) => a - b)
    },
    [headerIndexes]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? metrics.header : metrics.row),
    overscan: OVERSCAN,
    rangeExtractor
  })

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-sunken">
        <p className="text-xs text-content-tertiary">Working tree clean</p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="scroll-thin h-full overflow-auto bg-surface-sunken"
      role="listbox"
      aria-label="Changed files"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null

          const isSticky = row.kind === 'header' && item.index === stickyIndex.current

          return (
            <div
              key={item.index}
              // A pinned header leaves the transformed flow and sits at the top
              // of the scroll port; every other row is positioned by offset.
              className={cn('left-0 w-full', isSticky ? 'sticky top-0 z-10' : 'absolute top-0')}
              style={{
                height: item.size,
                ...(isSticky ? {} : { transform: `translateY(${item.start}px)` })
              }}
            >
              {row.kind === 'header' ? (
                <div className="flex h-full items-center gap-1.5 bg-surface-sunken px-2 text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
                  {row.title}
                  <span className="font-normal normal-case">{row.count}</span>
                </div>
              ) : (
                <FileRow
                  entry={row.entry}
                  staged={row.staged}
                  selected={
                    selection?.path === row.entry.path && selection.staged === row.staged
                  }
                  onSelect={() =>
                    void select({ path: row.entry.path, staged: row.staged })
                  }
                  onToggle={() =>
                    void (row.staged ? unstage([row.entry.path]) : stage([row.entry.path]))
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
