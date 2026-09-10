import { useEffect } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, GitBranch, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'

/**
 * Branch toolbar for the active repository.
 *
 * The repository's identity lives in the tab above, so this row carries only
 * what changes as you work inside it: the checked-out branch, its distance
 * from upstream, and the three network actions that change that distance.
 */
export function TitleBar(): React.JSX.Element | null {
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const loading = useRepo((s) => s.loading)
  const refresh = useRepo((s) => s.refresh)

  const busy = useActions((s) => s.busy)
  const remotes = useActions((s) => s.remotes)
  const loadRemotes = useActions((s) => s.loadRemotes)
  const loadWorktrees = useActions((s) => s.loadWorktrees)
  const fetch = useActions((s) => s.fetch)
  const pull = useActions((s) => s.pull)
  const push = useActions((s) => s.push)
  const pushTags = useActions((s) => s.pushTags)

  useEffect(() => {
    if (!root) return
    void loadRemotes(root)
    void loadWorktrees(root)
  }, [root, loadRemotes, loadWorktrees])

  if (!root) return null

  const branch = status?.branch
  const operation = status?.operation ?? 'none'
  // Network actions mid-merge would fail or make the state harder to reason
  // about; the user finishes or aborts first.
  const mid = operation !== 'none'
  const remote = remotes[0]?.name
  const noRemote = remote === undefined
  const disabled = busy !== null || mid || noRemote
  const needsUpstream = branch !== undefined && !branch.upstream

  return (
    <header className="flex h-7 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-app px-2">
      {branch && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <GitBranch className="size-3.5 shrink-0 text-content-tertiary" />
          <span className="truncate font-medium">
            {branch.detached ? branch.head?.slice(0, 7) : branch.name}
          </span>
          {branch.upstream && (
            <span className="truncate text-2xs text-content-tertiary">{branch.upstream}</span>
          )}
          {branch.ahead > 0 && (
            <span className="shrink-0 text-2xs tabular-nums text-sync-ahead">
              &uarr;{branch.ahead}
            </span>
          )}
          {branch.behind > 0 && (
            <span className="shrink-0 text-2xs tabular-nums text-sync-behind">
              &darr;{branch.behind}
            </span>
          )}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void fetch(root, false)}
          className="h-6 gap-1 px-1.5 text-2xs"
          title={noRemote ? 'No remote configured' : 'Fetch from the remote'}
        >
          <RefreshCw className={cn('size-3', busy === 'fetch' && 'animate-spin')} />
          Fetch
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void pull(root, false)}
          className="h-6 gap-1 px-1.5 text-2xs"
          title={noRemote ? 'No remote configured' : 'Pull from the upstream'}
        >
          <ArrowDown className="size-3" />
          Pull
          {branch && branch.behind > 0 && (
            <span className="tabular-nums text-sync-behind">{branch.behind}</span>
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !remote}
          onClick={() =>
            remote && void push(root, { remote, ...(needsUpstream ? { setUpstream: true } : {}) })
          }
          className="h-6 gap-1 px-1.5 text-2xs"
          title={
            noRemote
              ? 'No remote configured'
              : needsUpstream
                ? 'Push and set the upstream'
                : 'Push to the upstream'
          }
        >
          <ArrowUp className="size-3" />
          Push
          {branch && branch.ahead > 0 && (
            <span className="tabular-nums text-sync-ahead">{branch.ahead}</span>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="size-6"
              aria-label="More remote actions"
            >
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => void pull(root, true)}>
              Pull with rebase
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void fetch(root, true)}>
              Fetch and prune
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!remote}
              onSelect={() => remote && void push(root, { remote, includeTags: true })}
            >
              Push with tags
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!remote}
              onSelect={() => remote && void pushTags(root, remote)}
            >
              Push all tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!remote}
              onSelect={() => remote && void push(root, { remote, forceWithLease: true })}
            >
              Force push (with lease)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refresh()}
          className="size-6"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
    </header>
  )
}
