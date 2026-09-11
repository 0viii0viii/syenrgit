import { useEffect, useRef, useState } from 'react'
import { GitMerge, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { describeError } from '@/lib/errors'
import { splitPath } from '@/lib/git-status'
import { useConflicts } from '@/stores/conflicts'
import { useMerge } from '@/stores/merge'
import { useRepo } from '@/stores/repo'

/**
 * What a merge left behind, listed in one place.
 *
 * A conflicted merge stops mid-operation and the repository is in a state the
 * user did not ask for, so it announces itself rather than waiting to be
 * noticed in a file list. The two whole-file answers are here because most
 * conflicts get one of them; anything needing thought opens the merge editor.
 */
export function ConflictsDialog(): React.JSX.Element | null {
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const refresh = useRepo((s) => s.refresh)
  const openMerge = useMerge((s) => s.open)
  const open = useConflicts((s) => s.listOpen)
  const openList = useConflicts((s) => s.openList)
  const closeList = useConflicts((s) => s.closeList)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const conflicts = status?.files.filter((f) => f.conflicted) ?? []
  const count = conflicts.length

  // Announce on the transition into conflict, not while in it: reopening on
  // every status refresh would make the dialog impossible to dismiss.
  const previous = useRef(count)
  useEffect(() => {
    if (previous.current === 0 && count > 0) openList()
    previous.current = count
  }, [count, openList])

  // Nothing left to decide.
  useEffect(() => {
    if (count === 0) closeList()
  }, [count, closeList])

  if (!root || count === 0) return null

  const take = async (path: string, side: 'ours' | 'theirs'): Promise<void> => {
    setBusy(path)
    setError(null)
    try {
      await window.api.takeSide({ cwd: root, path, side })
      await refresh()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeList()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 text-status-conflicted" />
            {count} file{count === 1 ? '' : 's'} merged with conflicts
          </DialogTitle>
          <DialogDescription className="text-xs">
            Keep one side outright, or open the file to decide region by region.
            {status?.operation !== 'none' && ` The ${status?.operation} stays in progress until every file is resolved.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-xs bg-danger-subtle px-2 py-1 text-2xs text-danger-content">
            {error}
          </p>
        )}

        <div className="scroll-thin -mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          {conflicts.map((entry) => {
            const { dir, name } = splitPath(entry.path)
            const working = busy === entry.path
            return (
              <div
                key={entry.path}
                className="flex items-center gap-2 border-b border-border-subtle py-1.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs" title={entry.path}>
                    {name}
                  </p>
                  {dir && (
                    <p className="truncate text-2xs text-content-tertiary">{dir}</p>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  className="h-6 shrink-0 px-2 text-2xs"
                  onClick={() => void take(entry.path, 'ours')}
                >
                  Accept yours
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  className="h-6 shrink-0 px-2 text-2xs"
                  onClick={() => void take(entry.path, 'theirs')}
                >
                  Accept theirs
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={working}
                  className="h-6 shrink-0 gap-1 px-2 text-2xs"
                  onClick={() => {
                    closeList()
                    void openMerge(root, entry.path)
                  }}
                >
                  <GitMerge className="size-3" />
                  Merge&hellip;
                </Button>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={closeList}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
