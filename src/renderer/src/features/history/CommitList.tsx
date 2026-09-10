import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { initials, relativeTime } from '@/lib/format'
import { useHistory } from '@/stores/history'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'
import { InteractiveRebaseDialog } from './InteractiveRebaseDialog'
import { NewTagDialog } from './NewTagDialog'
import { CommitGraph } from './CommitGraph'
import { useGraphMetrics } from './useGraphMetrics'
import { RefBadges } from './RefBadges'

/**
 * Rows kept mounted beyond the viewport. Generous because history is scrolled
 * fast and by keyboard; the graph reads better with a little slack above and
 * below than it does re-rendering at every row boundary.
 */
const OVERSCAN = 16

export function CommitList(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const commits = useHistory((s) => s.commits)
  const graph = useHistory((s) => s.graph)
  const width = useHistory((s) => s.graphWidth)
  const selected = useHistory((s) => s.selected)
  const selectCommit = useHistory((s) => s.selectCommit)
  const filter = useHistory((s) => s.filter)
  const exclusive = useHistory((s) => s.exclusive)

  const status = useRepo((s) => s.status)
  const busy = useActions((s) => s.busy)
  const sequencer = useActions((s) => s.sequencer)
  const [tagTarget, setTagTarget] = useState<{ hash: string; label: string } | null>(null)
  const [rebaseBase, setRebaseBase] = useState<{ base: string; label: string } | null>(null)

  const metrics = useGraphMetrics()
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    // Rows are a fixed token-driven height, so the estimate is exact and the
    // graph's `index * row` geometry stays in lockstep with the row offsets.
    estimateSize: () => metrics.row,
    overscan: OVERSCAN
  })

  const items = virtualizer.getVirtualItems()

  // Keyboard navigation is the primary way to walk history, and the selected
  // row is usually not mounted, so scrolling goes through the virtualizer
  // rather than scrollIntoView on a DOM node that may not exist.
  useEffect(() => {
    if (!selected) return
    const index = commits.findIndex((c) => c.hash === selected)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
    // `virtualizer` is a stable instance; re-running on it would fight scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, commits])

  const move = (delta: number): void => {
    if (!root || commits.length === 0) return
    const current = commits.findIndex((c) => c.hash === selected)
    const next = current === -1 ? 0 : Math.min(commits.length - 1, Math.max(0, current + delta))
    const target = commits[next]
    if (target) void selectCommit(root, target.hash)
  }

  if (commits.length === 0) {
    // An empty exclusive view is a real answer — the branch is fully merged —
    // not a failure, and it should not read like one.
    const message =
      filter.length > 0
        ? exclusive
          ? 'No commits unique to these refs'
          : 'No commits on these refs'
        : 'No commits'
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-surface-sunken">
        <p className="text-xs text-content-tertiary">{message}</p>
        {filter.length > 0 && exclusive && (
          <p className="text-2xs text-content-tertiary">
            Everything here is reachable from another ref
          </p>
        )}
      </div>
    )
  }

  const graphPx = Math.max(width, 1) * metrics.lane
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? 0

  return (
    <div
      ref={scrollRef}
      className="scroll-thin h-full overflow-auto bg-surface-sunken outline-none"
      tabIndex={0}
      role="listbox"
      aria-label="Commit history"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        <CommitGraph rows={graph} width={width} metrics={metrics} from={first} to={last} />

        {items.map((item) => {
          const commit = commits[item.index]
          if (!commit) return null
          const row = (
            <div
              key={commit.hash}
              data-hash={commit.hash}
              data-index={item.index}
              role="option"
              aria-selected={commit.hash === selected}
              onClick={() => root && void selectCommit(root, commit.hash)}
              className={cn(
                'absolute left-0 top-0 flex w-full items-center gap-2 pr-2 text-xs',
                'cursor-default hover:bg-surface-hover',
                commit.hash === selected && 'bg-surface-selected hover:bg-surface-selected'
              )}
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`,
                paddingLeft: graphPx + 6
              }}
            >
              <RefBadges refs={commit.refs} />
              <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
              <span
                className="shrink-0 text-2xs text-content-tertiary"
                title={`${commit.authorName} <${commit.authorEmail}>`}
              >
                {initials(commit.authorName)}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-2xs text-content-tertiary">
                {commit.shortHash}
              </span>
              <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-content-tertiary">
                {relativeTime(commit.authorDate)}
              </span>
            </div>
          )

          if (!root) return row

          // Replaying onto a repository that is already mid-operation would
          // fail; refusing up front says why instead of relaying git's error.
          const mid = (status?.operation ?? 'none') !== 'none'
          const isMerge = commit.parents.length > 1

          return (
            <ContextMenu key={commit.hash}>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent className="w-64">
                <ContextMenuItem
                  disabled={busy !== null || mid}
                  onSelect={() => void sequencer(root, 'cherry-pick', [commit.hash])}
                >
                  Cherry-pick {commit.shortHash}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={busy !== null || mid}
                  onSelect={() =>
                    void sequencer(
                      root,
                      'revert',
                      [commit.hash],
                      // Git refuses to revert a merge without being told which
                      // parent is the mainline, and the first parent is the
                      // branch that did the merging in every normal workflow.
                      isMerge ? 1 : undefined
                    )
                  }
                >
                  Revert {commit.shortHash}
                  {isMerge && <span className="ml-1 text-content-tertiary">(merge)</span>}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={busy !== null || mid || isMerge || commit.parents.length === 0}
                  onSelect={() =>
                    setRebaseBase({
                      // The replay starts *after* this commit's parent, so the
                      // clicked commit is the oldest one in the plan.
                      base: `${commit.hash}^`,
                      label: commit.shortHash
                    })
                  }
                >
                  Rebase interactively from {commit.shortHash}&hellip;
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={busy !== null}
                  onSelect={() =>
                    setTagTarget({ hash: commit.hash, label: commit.shortHash })
                  }
                >
                  Tag {commit.shortHash}&hellip;
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>

      <InteractiveRebaseDialog
        open={rebaseBase !== null}
        onOpenChange={(next) => !next && setRebaseBase(null)}
        base={rebaseBase?.base ?? 'HEAD'}
        baseLabel={rebaseBase?.label ?? 'HEAD'}
      />

      <NewTagDialog
        open={tagTarget !== null}
        onOpenChange={(next) => !next && setTagTarget(null)}
        {...(tagTarget ? { target: tagTarget.hash, targetLabel: tagTarget.label } : {})}
      />
    </div>
  )
}
