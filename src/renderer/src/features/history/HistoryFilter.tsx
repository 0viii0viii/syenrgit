import { GitBranch, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { refKind, shortRefName } from '@/lib/format'
import { useHistory } from '@/stores/history'
import { useRepo } from '@/stores/repo'

const CHIP_CLASS = {
  local: 'bg-ref-local-bg text-ref-local-content',
  remote: 'bg-ref-remote-bg text-ref-remote-content',
  tag: 'bg-ref-tag-bg text-ref-tag-content',
  other: 'bg-ref-remote-bg text-ref-remote-content'
} as const

/**
 * Shows what the graph is currently scoped to.
 *
 * Only rendered when a filter is active: a permanent "showing everything" bar
 * would cost a row of height on the default view to say nothing.
 */
export function HistoryFilter(): React.JSX.Element | null {
  const root = useRepo((s) => s.root)
  const filter = useHistory((s) => s.filter)
  const commits = useHistory((s) => s.commits)
  const exclusive = useHistory((s) => s.exclusive)
  const setFilter = useHistory((s) => s.setFilter)
  const setExclusive = useHistory((s) => s.setExclusive)
  const toggleRef = useHistory((s) => s.toggleRef)

  if (filter.length === 0) return null

  const modes = [
    { value: false, label: 'Reachable', title: 'Every commit these refs can reach' },
    { value: true, label: 'Only on these', title: 'Commits not reachable from any other ref' }
  ]

  return (
    <div className="flex h-6 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-app px-2">
      <span className="shrink-0 text-2xs text-content-tertiary">Showing</span>

      <div className="scroll-hide-y flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {filter.map((refName) => {
          const kind = refKind(refName)
          return (
            <span
              key={refName}
              className={cn(
                'flex shrink-0 items-center gap-0.5 rounded-xs px-1 text-2xs leading-4',
                CHIP_CLASS[kind]
              )}
              title={refName}
            >
              {kind === 'tag' ? (
                <Tag className="size-2.5 shrink-0" />
              ) : (
                <GitBranch className="size-2.5 shrink-0" />
              )}
              <span className="max-w-40 truncate">{shortRefName(refName)}</span>
              <button
                type="button"
                aria-label={`Stop showing only ${shortRefName(refName)}`}
                onClick={() => root && void toggleRef(root, refName, true)}
                className="flex size-3 shrink-0 items-center justify-center rounded-xs hover:bg-surface-active"
              >
                <X className="size-2" />
              </button>
            </span>
          )
        })}
      </div>

      {/* Two named modes rather than a checkbox: "only on these" is a
          different question from "reachable", not a refinement of it. */}
      <div className="flex shrink-0 items-center rounded-xs bg-surface-inset p-px">
        {modes.map((mode) => (
          <button
            key={mode.label}
            type="button"
            title={mode.title}
            aria-pressed={exclusive === mode.value}
            onClick={() => root && void setExclusive(root, mode.value)}
            className={cn(
              'rounded-xs px-1.5 text-2xs leading-4',
              exclusive === mode.value
                ? 'bg-accent-bg text-accent-content'
                : 'text-content-secondary hover:text-content-primary'
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <span className="shrink-0 text-2xs tabular-nums text-content-tertiary">
        {commits.length} commits
      </span>
      <button
        type="button"
        onClick={() => root && void setFilter(root, [])}
        className="shrink-0 rounded-xs px-1 text-2xs text-content-secondary hover:bg-surface-active hover:text-content-primary"
      >
        Show all
      </button>
    </div>
  )
}
