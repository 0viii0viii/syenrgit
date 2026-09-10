import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/stores/workspace'

/**
 * Repository tabs, in the top row of the window.
 *
 * A repository is the outermost thing in git — branches, history and files all
 * live inside one — so the tab strip sits above the branch toolbar rather than
 * under it. It doubles as the window's drag region and carries the inset for
 * the macOS traffic lights, so it always renders even with nothing open.
 */
export function RepoTabs(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeRoot = useWorkspace((s) => s.activeRoot)
  const stale = useWorkspace((s) => s.stale)
  const activate = useWorkspace((s) => s.activate)
  const close = useWorkspace((s) => s.close)
  const openDialog = useWorkspace((s) => s.openDialog)

  return (
    <div
      className={cn(
        'drag-region flex h-titlebar shrink-0 items-stretch',
        'border-b border-border-subtle bg-surface-app',
        window.platform?.isMac ? 'pl-20' : 'pl-1'
      )}
      role="tablist"
      aria-label="Open repositories"
    >
      <div className="scroll-hide-y flex min-w-0 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.root === activeRoot
          return (
            <div
              key={tab.root}
              role="tab"
              aria-selected={active}
              onClick={() => void activate(tab.root)}
              title={tab.root}
              className={cn(
                'no-drag group relative flex max-w-52 shrink-0 cursor-default items-center gap-1.5',
                'border-r border-border-subtle px-3 text-xs',
                active
                  ? 'bg-surface-default text-content-primary'
                  : 'text-content-secondary hover:bg-surface-hover'
              )}
            >
              {/* The active tab reads as the front sheet of a stack: it shares
                  the workspace's background and is capped by an accent edge. */}
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent-bg" />}

              {/* An unread mark, not an error: the repo moved while in the
                  background and will reload when it is next opened. */}
              {stale.has(tab.root) && !active && (
                <span className="size-1.5 shrink-0 rounded-full bg-accent-bg" />
              )}

              <span className="truncate">{tab.name}</span>

              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void close(tab.root)
                }}
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-xs',
                  'text-content-tertiary opacity-0 hover:bg-surface-active hover:text-content-primary',
                  'group-hover:opacity-100 focus-visible:opacity-100',
                  active && 'opacity-60'
                )}
              >
                <X className="size-2.5" />
              </button>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void openDialog()}
        aria-label="Open another repository"
        title="Open a repository"
        className={cn(
          'no-drag flex w-9 shrink-0 items-center justify-center',
          'text-content-tertiary hover:bg-surface-hover hover:text-content-primary'
        )}
      >
        <Plus className="size-4" />
      </button>

      {/* The rest of the row stays draggable. */}
      <div className="flex-1" />
    </div>
  )
}
