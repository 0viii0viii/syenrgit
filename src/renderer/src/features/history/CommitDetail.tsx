import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { absoluteTime, initials } from '@/lib/format'
import { useListMetrics } from '@/lib/list-metrics'
import { primaryState, splitPath, stateMeta } from '@/lib/git-status'
import { useHistory } from '@/stores/history'
import { useRepo } from '@/stores/repo'
import { RefBadges } from './RefBadges'

export function CommitDetail(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const detail = useHistory((s) => s.detail)
  const selectedFile = useHistory((s) => s.selectedFile)
  const selectFile = useHistory((s) => s.selectFile)

  const metrics = useListMetrics()
  const scrollRef = useRef<HTMLDivElement>(null)

  // A merge or a generated-code commit can touch thousands of files, so the
  // file list is windowed like every other long list in the app.
  const virtualizer = useVirtualizer({
    count: detail?.files.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => metrics.row,
    overscan: 12
  })

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-default">
        <p className="text-xs text-content-tertiary">Select a commit</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-default">
      <div className="shrink-0 space-y-2 p-3">
        <div className="flex items-start gap-2">
          <p className="selectable min-w-0 flex-1 text-md font-medium leading-tight">
            {detail.subject}
          </p>
          <RefBadges refs={detail.refs} />
        </div>

        {detail.body && (
          <p className="selectable whitespace-pre-wrap text-xs leading-normal text-content-secondary">
            {detail.body}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-content-tertiary">
          <span
            className="flex items-center gap-1"
            title={`${detail.authorName} <${detail.authorEmail}>`}
          >
            <span className="flex size-4 items-center justify-center rounded-full bg-surface-inset text-[9px] font-medium text-content-secondary">
              {initials(detail.authorName)}
            </span>
            {detail.authorName}
          </span>
          <span>{absoluteTime(detail.authorDate)}</span>
          <span className="selectable font-mono">{detail.shortHash}</span>
          {/* Amended and rebased commits have a committer that differs from
              the author; surfacing it explains otherwise-confusing dates. */}
          {detail.committerEmail !== detail.authorEmail && (
            <span title={`Committed by ${detail.committerName}`}>
              committed by {detail.committerName}
            </span>
          )}
          {detail.parents.length > 1 && (
            <span className="text-content-secondary">
              merge of {detail.parents.length} parents
            </span>
          )}
        </div>
      </div>

      <Separator />

      <div className="flex h-6 shrink-0 items-center gap-2 px-3 text-2xs text-content-tertiary">
        <span>
          {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="text-diff-add-content">+{detail.additions}</span>
        <span className="text-diff-del-content">&minus;{detail.deletions}</span>
        {detail.parents.length > 1 && (
          <span className="ml-auto">vs. first parent</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-auto"
        role="listbox"
        aria-label="Files in commit"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const file = detail.files[item.index]
            if (!file) return null
            const meta = stateMeta(primaryState(file))
            const { dir, name } = splitPath(file.path)
            return (
              <div
                key={file.path}
                role="option"
                aria-selected={file.path === selectedFile}
                onClick={() => root && void selectFile(root, file.path)}
                className={cn(
                  'absolute left-0 top-0 flex w-full cursor-default items-center gap-1.5 px-3 text-xs',
                  'hover:bg-surface-hover',
                  file.path === selectedFile && 'bg-surface-selected hover:bg-surface-selected'
                )}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span
                  className={cn(
                    'w-3 shrink-0 text-center font-mono text-2xs font-semibold',
                    meta.color
                  )}
                  title={meta.label}
                >
                  {meta.letter}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {dir && <span className="text-content-tertiary">{dir}</span>}
                  {name}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
