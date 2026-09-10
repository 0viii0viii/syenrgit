import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'
import type { TodoAction, TodoEntry } from '@shared/ipc'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Commit the replay starts after — usually the selected commit's parent. */
  base: string
  baseLabel: string
}

const ACTIONS: { value: TodoAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep the commit as it is' },
  { value: 'squash', label: 'Squash', hint: 'Fold into the commit above, combining messages' },
  { value: 'fixup', label: 'Fixup', hint: 'Fold into the commit above, discarding this message' },
  { value: 'edit', label: 'Edit', hint: 'Stop here so the commit can be amended' },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit entirely' }
]

const ACTION_CLASS: Record<TodoAction, string> = {
  pick: 'text-content-primary',
  squash: 'text-conflict-ours-content',
  fixup: 'text-conflict-theirs-content',
  edit: 'text-warning-content',
  drop: 'text-danger-content'
}

export function InteractiveRebaseDialog(props: Props): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        {props.open && <TodoEditor {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function TodoEditor({ onOpenChange, base, baseLabel }: Props): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const runTodo = useActions((s) => s.runTodo)

  const [entries, setEntries] = useState<TodoEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!root) return
    let cancelled = false
    void window.api
      .buildTodo(root, base)
      .then((todo) => {
        if (!cancelled) setEntries(todo)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [root, base])

  const move = (index: number, delta: number): void => {
    setEntries((current) => {
      if (!current) return current
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      return next
    })
  }

  const setAction = (index: number, action: TodoAction): void => {
    setEntries((current) =>
      current?.map((e, i) => (i === index ? { ...e, action } : e)) ?? current
    )
  }

  // Git refuses a todo whose first kept line folds into something above it.
  const kept = entries?.filter((e) => e.action !== 'drop') ?? []
  const firstFolds = kept[0]?.action === 'squash' || kept[0]?.action === 'fixup'
  const canRun = root !== null && entries !== null && entries.length > 0 && !firstFolds && busy === null

  const run = async (): Promise<void> => {
    if (!root || !entries) return
    const outcome = await runTodo(root, base, entries)
    if (outcome) onOpenChange(false)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rebase interactively</DialogTitle>
        <DialogDescription>
          Replaying the commits after {baseLabel}, oldest first. Reorder them, or change what
          happens to each.
        </DialogDescription>
      </DialogHeader>

      {loadError && <p className="text-2xs text-danger-content">{loadError}</p>}

      <div className="scroll-thin max-h-80 overflow-y-auto rounded-md border border-border-subtle">
        {entries === null ? (
          <p className="p-3 text-center text-xs text-content-tertiary">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="p-3 text-center text-xs text-content-tertiary">
            Nothing to replay after {baseLabel}
          </p>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.hash}
              className={cn(
                'flex items-center gap-1.5 border-b border-border-subtle px-2 py-1 last:border-b-0',
                entry.action === 'drop' && 'opacity-50'
              )}
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label="Move earlier"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="flex size-3 items-center justify-center text-content-tertiary hover:text-content-primary disabled:opacity-30"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Move later"
                  disabled={index === entries.length - 1}
                  onClick={() => move(index, 1)}
                  className="flex size-3 items-center justify-center text-content-tertiary hover:text-content-primary disabled:opacity-30"
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>

              <select
                value={entry.action}
                onChange={(e) => setAction(index, e.target.value as TodoAction)}
                title={ACTIONS.find((a) => a.value === entry.action)?.hint}
                className={cn(
                  'h-5 shrink-0 rounded-xs border border-border-subtle bg-surface-inset px-1 text-2xs',
                  ACTION_CLASS[entry.action]
                )}
              >
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>

              <span className="shrink-0 font-mono text-2xs text-content-tertiary">
                {entry.shortHash}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-xs',
                  entry.action === 'drop' && 'line-through'
                )}
              >
                {entry.subject}
              </span>
            </div>
          ))
        )}
      </div>

      {firstFolds && (
        <p className="text-2xs text-danger-content">
          The first commit cannot be squashed or fixed up &mdash; there is nothing before it to
          combine with.
        </p>
      )}
      <p className="text-2xs text-content-tertiary">
        Rewording is not offered: it needs a commit-message editor, which this app never opens.
      </p>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canRun} onClick={() => void run()}>
          {busy === 'runTodo' ? 'Rebasing…' : 'Start rebase'}
        </Button>
      </DialogFooter>
    </>
  )
}
