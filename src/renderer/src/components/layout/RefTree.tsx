import { useCallback, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import {
  Archive,
  ChevronRight,
  Cloud,
  FolderTree,
  GitBranch,
  Lock,
  Plus,
  Search,
  Tag as TagIcon,
  X
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { matchesRef, refMatchScore } from '@/lib/fuzzy'
import { cn } from '@/lib/utils'
import { relativeTime } from '@/lib/format'
import { useListMetrics } from '@/lib/list-metrics'
import { NewBranchDialog } from '@/features/branches/NewBranchDialog'
import { NewWorktreeDialog } from '@/features/branches/NewWorktreeDialog'
import { useActions } from '@/stores/actions'
import { useHistory } from '@/stores/history'
import { useRepo } from '@/stores/repo'
import { useWorkspace } from '@/stores/workspace'
import type { BranchRef, RefList, StashEntry, TagRef } from '@shared/git'
import type { Worktree } from '@shared/ipc'

type Icon = React.ComponentType<{ className?: string }>

type Row =
  | { kind: 'header'; id: string; title: string; icon: Icon; count: number }
  | { kind: 'branch'; branch: BranchRef }
  | { kind: 'tag'; tag: TagRef }
  | { kind: 'stash'; stash: StashEntry }
  | { kind: 'worktree'; worktree: Worktree }

const OVERSCAN = 12

/** Group remote-tracking branches under their remote name. */
function groupRemotes(remotes: BranchRef[]): [string, BranchRef[]][] {
  const grouped = new Map<string, BranchRef[]>()
  for (const ref of remotes) {
    const slash = ref.name.indexOf('/')
    const remote = slash === -1 ? ref.name : ref.name.slice(0, slash)
    const list = grouped.get(remote)
    if (list) list.push(ref)
    else grouped.set(remote, [ref])
  }
  return [...grouped]
}

/**
 * Flatten the ref tree into one indexable sequence, honouring collapse state.
 *
 * A monorepo can carry thousands of remote-tracking branches, so this list is
 * windowed like every other list in the app. Collapsed sections contribute
 * only their header, which is what keeps expanding a large remote cheap.
 */
/** Order matches so the most likely one is on top, otherwise keep git's order. */
function rank<T>(items: T[], query: string, nameOf: (item: T) => string): T[] {
  if (query === '') return items
  return items
    .filter((item) => matchesRef(nameOf(item), query))
    .sort((a, b) => refMatchScore(nameOf(a), query) - refMatchScore(nameOf(b), query))
}

function buildRows(
  refs: RefList,
  worktrees: Worktree[],
  expanded: ReadonlySet<string>,
  query: string
): Row[] {
  const rows: Row[] = []

  const section = (id: string, title: string, icon: Icon, count: number): boolean => {
    if (count === 0) return false
    rows.push({ kind: 'header', id, title, icon, count })
    // While filtering, a collapsed section would hide its own matches — so a
    // query opens every section that still has one.
    return expanded.has(id) || query !== ''
  }

  const local = rank(refs.local, query, (b) => b.name)
  if (section('local', 'Branches', GitBranch, local.length)) {
    for (const branch of local) rows.push({ kind: 'branch', branch })
  }

  for (const [remote, branches] of groupRemotes(refs.remote)) {
    const matched = rank(branches, query, (b) => b.name)
    if (section(`remote:${remote}`, remote, Cloud, matched.length)) {
      for (const branch of matched) rows.push({ kind: 'branch', branch })
    }
  }

  const tags = rank(refs.tags, query, (t) => t.name)
  if (section('tags', 'Tags', TagIcon, tags.length)) {
    for (const tag of tags) rows.push({ kind: 'tag', tag })
  }

  // Stashes are matched on their message, which is the only name they have.
  const stashes = rank(refs.stashes, query, (s) => s.message)
  if (section('stashes', 'Stashes', Archive, stashes.length)) {
    for (const stash of stashes) rows.push({ kind: 'stash', stash })
  }

  // Only worth a section once there is more than the main working tree, which
  // every repository has.
  const trees = rank(worktrees, query, (w) => `${w.path} ${w.label}`)
  if (worktrees.length > 1 && section('worktrees', 'Worktrees', FolderTree, trees.length)) {
    for (const worktree of trees) rows.push({ kind: 'worktree', worktree })
  }

  return rows
}

/**
 * Only local branches start expanded. Tracked as an opt-in set rather than an
 * opt-out one because remote section ids are derived from the remote names: a
 * collapsed-by-default list cannot enumerate them, and a repo with thousands
 * of remote-tracking branches should not expand them unasked.
 */
const DEFAULT_EXPANDED = new Set(['local'])

/**
 * A row that scopes the commit graph to its ref.
 *
 * Plain click solos the ref; cmd/ctrl-click adds it to the current selection
 * so two branches can be compared side by side in one graph.
 */
function useRefFilter(refName: string): {
  filtered: boolean
  onClick: (e: React.MouseEvent) => void
} {
  const root = useRepo((s) => s.root)
  const setTab = useRepo((s) => s.setTab)
  const filter = useHistory((s) => s.filter)
  const toggleRef = useHistory((s) => s.toggleRef)

  return {
    filtered: filter.includes(refName),
    onClick: (e) => {
      if (!root) return
      // Filtering only affects history, so show it — otherwise the click looks
      // like it did nothing.
      setTab('history')
      void toggleRef(root, refName, e.metaKey || e.ctrlKey)
    }
  }
}

function BranchRow({ branch }: { branch: BranchRef }): React.JSX.Element {
  const { filtered, onClick } = useRefFilter(branch.refName)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false)
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const busy = useActions((s) => s.busy)
  const checkout = useActions((s) => s.checkout)
  const merge = useActions((s) => s.merge)
  const rebase = useActions((s) => s.rebase)
  const deleteBranch = useActions((s) => s.deleteBranch)

  const current = status?.branch.name
  const operation = status?.operation ?? 'none'
  // Merging or checking out on top of an unfinished operation would fail
  // anyway; refusing up front says why instead of surfacing git's error.
  const mid = operation !== 'none'

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
      className={cn(
        'flex h-full cursor-default items-center gap-1.5 pl-6 pr-2 text-xs',
        'hover:bg-surface-hover',
        filtered && 'bg-surface-selected hover:bg-surface-selected'
      )}
      title={`${branch.name}\n${branch.subject}`}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          // The checked-out branch is the one piece of state a user scans this
          // list for; everything else stays at normal weight.
          branch.isHead && 'font-semibold text-content-link'
        )}
      >
        {branch.name}
      </span>
      {branch.ahead > 0 && (
        <span className="shrink-0 text-2xs tabular-nums text-sync-ahead">&uarr;{branch.ahead}</span>
      )}
      {branch.behind > 0 && (
        <span className="shrink-0 text-2xs tabular-nums text-sync-behind">
          &darr;{branch.behind}
        </span>
      )}
      <span className="w-8 shrink-0 text-right text-2xs text-content-tertiary">
        {relativeTime(branch.date)}
      </span>
    </div>
  )

  if (!root) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          disabled={busy !== null || mid || branch.isHead}
          onSelect={() => void checkout(root, branch.name)}
        >
          {branch.isHead ? 'Already checked out' : `Checkout ${branch.name}`}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={busy !== null || mid || branch.isHead || !current}
          onSelect={() => void merge(root, branch.name, false)}
        >
          Merge into {current ?? 'HEAD'}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy !== null || mid || branch.isHead || !current}
          onSelect={() => void merge(root, branch.name, true)}
        >
          Merge without fast-forward
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy !== null || mid || branch.isHead || !current}
          onSelect={() => void rebase(root, branch.name)}
        >
          Rebase {current ?? 'HEAD'} onto {branch.name}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy !== null} onSelect={() => setNewBranchOpen(true)}>
          New branch from {branch.name}
        </ContextMenuItem>
        <ContextMenuItem disabled={busy !== null} onSelect={() => setNewWorktreeOpen(true)}>
          New worktree for {branch.name}&hellip;
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Two entries rather than one with a confirm: the unforced delete
            refuses to drop commits that exist nowhere else, and that refusal
            is the whole safety of the operation. */}
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null || branch.isHead}
          onSelect={() => void deleteBranch(root, branch.name, false)}
        >
          {branch.isHead ? 'Cannot delete the current branch' : `Delete ${branch.name}`}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null || branch.isHead}
          onSelect={() => void deleteBranch(root, branch.name, true)}
        >
          Delete, discarding unmerged commits
        </ContextMenuItem>
      </ContextMenuContent>

      <NewBranchDialog
        open={newBranchOpen}
        onOpenChange={setNewBranchOpen}
        startPoint={branch.refName}
      />
      <NewWorktreeDialog
        open={newWorktreeOpen}
        onOpenChange={setNewWorktreeOpen}
        startRef={branch.refName}
      />
    </ContextMenu>
  )
}

/**
 * Rest props are spread onto the row element and the ref is forwarded, because
 * a Radix `asChild` trigger clones this element and injects its handlers as
 * props. A component that drops them silently renders a row that looks right
 * and does nothing.
 */
function SimpleRow({
  label,
  date,
  refName,
  ref,
  ...rest
}: {
  label: string
  date: number
  /** Omitted for stashes, which are not a place history can be scoped to. */
  refName?: string
} & React.ComponentPropsWithRef<'div'>): React.JSX.Element {
  const { filtered, onClick } = useRefFilter(refName ?? '')
  const selectable = refName !== undefined
  const row = (
    <div
      ref={ref}
      {...(selectable ? { role: 'button', tabIndex: 0, onClick } : {})}
      {...rest}
      className={cn(
        'flex h-full cursor-default items-center gap-1.5 pl-6 pr-2 text-xs',
        'hover:bg-surface-hover',
        selectable && filtered && 'bg-surface-selected hover:bg-surface-selected'
      )}
      title={label}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="w-8 shrink-0 text-right text-2xs text-content-tertiary">
        {relativeTime(date)}
      </span>
    </div>
  )

  return refName?.startsWith('refs/tags/') ? (
    <TagMenu name={refName.slice('refs/tags/'.length)}>{row}</TagMenu>
  ) : (
    row
  )
}

/**
 * A worktree row. Clicking one opens it as a tab, which is the whole point of
 * having worktrees: two branches open side by side.
 */
function WorktreeRow({ worktree }: { worktree: Worktree }): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const removeWorktree = useActions((s) => s.removeWorktree)
  const setWorktreeLock = useActions((s) => s.setWorktreeLock)
  const pruneWorktrees = useActions((s) => s.pruneWorktrees)
  const tabs = useWorkspace((s) => s.tabs)
  const openTab = useWorkspace((s) => s.add)

  const isOpen = tabs.some((t) => t.root === worktree.path)
  const isCurrent = worktree.path === root
  const name = worktree.path.slice(worktree.path.lastIndexOf('/') + 1)

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void openTab(worktree.path)}
      title={`${worktree.path}\n${worktree.detached ? 'detached at' : 'on'} ${worktree.label}`}
      className={cn(
        'flex h-full cursor-default items-center gap-1.5 pl-6 pr-2 text-xs',
        'hover:bg-surface-hover',
        isCurrent && 'bg-surface-selected hover:bg-surface-selected',
        worktree.prunable && 'opacity-50'
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', isCurrent && 'font-semibold')}>{name}</span>

      {worktree.locked && <Lock className="size-2.5 shrink-0 text-content-tertiary" />}
      <span
        className={cn(
          'shrink-0 truncate text-2xs',
          worktree.detached ? 'font-mono text-content-tertiary' : 'text-ref-local-content'
        )}
      >
        {worktree.label}
      </span>
      {isOpen && !isCurrent && (
        <span className="size-1.5 shrink-0 rounded-full bg-accent-bg" title="Open in a tab" />
      )}
    </div>
  )

  if (!root) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={isCurrent} onSelect={() => void openTab(worktree.path)}>
          {isCurrent ? 'This is the open worktree' : `Open ${name} in a tab`}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={busy !== null || worktree.isMain}
          onSelect={() => void setWorktreeLock(root, worktree.path, worktree.locked === null)}
        >
          {worktree.locked ? 'Unlock' : 'Lock — keep prune from removing it'}
        </ContextMenuItem>
        {worktree.prunable && (
          <ContextMenuItem disabled={busy !== null} onSelect={() => void pruneWorktrees(root)}>
            Prune missing worktrees
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null || worktree.isMain || isCurrent}
          onSelect={() => void removeWorktree(root, worktree.path, false)}
        >
          {worktree.isMain
            ? 'The main working tree cannot be removed'
            : isCurrent
              ? 'Close this tab before removing it'
              : `Remove ${name}`}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null || worktree.isMain || isCurrent}
          onSelect={() => {
            if (window.confirm(`Remove ${name} and discard its uncommitted changes?`)) {
              void removeWorktree(root, worktree.path, true)
            }
          }}
        >
          Remove, discarding uncommitted changes
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function StashRow({ stash }: { stash: StashEntry }): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const stashApply = useActions((s) => s.stashApply)
  const stashDrop = useActions((s) => s.stashDrop)

  const row = <SimpleRow label={stash.message} date={stash.date} />
  if (!root) return row

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          disabled={busy !== null}
          onSelect={() => void stashApply(root, stash.ref, false)}
        >
          Apply, keeping the stash
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy !== null}
          onSelect={() => void stashApply(root, stash.ref, true)}
        >
          Pop &mdash; apply and remove
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null}
          onSelect={() => void stashDrop(root, stash.ref)}
        >
          Drop {stash.ref}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * A tag is published on its own schedule — cutting a release is a separate act
 * from publishing the branch it sits on — so pushing one is offered here
 * rather than folded into the branch push.
 */
function TagMenu({
  name,
  children
}: {
  name: string
  children: React.ReactElement
}): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const remotes = useActions((s) => s.remotes)
  const pushTags = useActions((s) => s.pushTags)
  const deleteTag = useActions((s) => s.deleteTag)

  if (!root) return children

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {remotes.length === 0 ? (
          <ContextMenuItem disabled>No remote configured</ContextMenuItem>
        ) : (
          remotes.map((remote) => (
            <ContextMenuItem
              key={remote.name}
              disabled={busy !== null}
              onSelect={() => void pushTags(root, remote.name, name)}
            >
              Push {name} to {remote.name}
            </ContextMenuItem>
          ))
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={busy !== null}
          onSelect={() => void deleteTag(root, name)}
        >
          Delete tag {name}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function RefTree(): React.JSX.Element {
  const refs = useHistory((s) => s.refs)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(DEFAULT_EXPANDED)
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false)

  const metrics = useListMetrics()
  const scrollRef = useRef<HTMLDivElement>(null)

  const worktrees = useActions((s) => s.worktrees)
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () => (refs ? buildRows(refs, worktrees, expanded, query.trim()) : []),
    [refs, worktrees, expanded, query]
  )
  const headerIndexes = useMemo(
    () => rows.reduce<number[]>((acc, r, i) => (r.kind === 'header' ? [...acc, i] : acc), []),
    [rows]
  )

  const stickyIndex = useRef(-1)

  const rangeExtractor = useCallback(
    (range: Range) => {
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

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!refs) return <div className="h-full bg-surface-app" />

  if (rows.length === 0) {
    return (
      <div className="h-full bg-surface-app">
        <p className="p-3 text-center text-2xs text-content-tertiary">No refs</p>
      </div>
    )
  }

  const filterBox = (
    <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
      <Search className="size-3 shrink-0 text-content-tertiary" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query !== '') {
            e.preventDefault()
            setQuery('')
          }
        }}
        spellCheck={false}
        placeholder="Filter refs"
        aria-label="Filter refs"
        className="h-5 min-w-0 flex-1 border-0 bg-transparent px-0 text-2xs shadow-none focus-visible:ring-0"
      />
      {query !== '' && (
        <button
          type="button"
          aria-label="Clear ref filter"
          onClick={() => setQuery('')}
          className="flex size-4 shrink-0 items-center justify-center rounded-xs text-content-tertiary hover:bg-surface-active hover:text-content-primary"
        >
          <X className="size-2.5" />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-surface-app">
      {filterBox}
      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-auto"
        aria-label="References"
      >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          const isSticky = row.kind === 'header' && item.index === stickyIndex.current

          return (
            <div
              key={item.index}
              className={cn('left-0 w-full', isSticky ? 'sticky top-0 z-10' : 'absolute top-0')}
              style={{
                height: item.size,
                ...(isSticky ? {} : { transform: `translateY(${item.start}px)` })
              }}
            >
              {row.kind === 'header' ? (
                <div className="group flex h-full items-center bg-surface-app pr-1">
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    aria-expanded={expanded.has(row.id)}
                    className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-2xs font-semibold uppercase tracking-wide text-content-tertiary hover:bg-surface-hover"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 transition-transform duration-100',
                        expanded.has(row.id) && 'rotate-90'
                      )}
                    />
                    <row.icon className="size-3" />
                    <span className="flex-1 truncate text-left">{row.title}</span>
                    <span className="font-normal normal-case">{row.count}</span>
                  </button>
                  {row.id === 'local' && (
                    <button
                      type="button"
                      aria-label="New branch"
                      title="New branch from HEAD"
                      onClick={() => setNewBranchOpen(true)}
                      className="flex size-4 shrink-0 items-center justify-center rounded-xs text-content-tertiary opacity-0 hover:bg-surface-active hover:text-content-primary group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                  {row.id === 'worktrees' && (
                    <button
                      type="button"
                      aria-label="New worktree"
                      title="New worktree"
                      onClick={() => setNewWorktreeOpen(true)}
                      className="flex size-4 shrink-0 items-center justify-center rounded-xs text-content-tertiary opacity-0 hover:bg-surface-active hover:text-content-primary group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                </div>
              ) : row.kind === 'branch' ? (
                <BranchRow branch={row.branch} />
              ) : row.kind === 'tag' ? (
                <SimpleRow label={row.tag.name} date={row.tag.date} refName={row.tag.refName} />
              ) : row.kind === 'worktree' ? (
                <WorktreeRow worktree={row.worktree} />
              ) : (
                <StashRow stash={row.stash} />
              )}
              </div>
            )
          })}
        </div>
      </div>

      <NewBranchDialog open={newBranchOpen} onOpenChange={setNewBranchOpen} />
      <NewWorktreeDialog open={newWorktreeOpen} onOpenChange={setNewWorktreeOpen} />
    </div>
  )
}
