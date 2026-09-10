import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { shortRefName } from '@/lib/format'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'
import { useWorkspace } from '@/stores/workspace'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Branch to check out in the new worktree. Not named `ref`, which React
   * reserves — it would be swallowed as an element ref and never arrive.
   */
  startRef?: string
}

export function NewWorktreeDialog(props: Props): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        {props.open && <NewWorktreeForm {...props} />}
      </DialogContent>
    </Dialog>
  )
}

/** Suggest a sibling directory, which is where worktrees usually go. */
function suggestPath(root: string | null, name: string): string {
  if (!root) return name
  const parent = root.slice(0, root.lastIndexOf('/'))
  const repo = root.slice(root.lastIndexOf('/') + 1)
  const safe = name.replace(/\//g, '-') || 'worktree'
  return `${parent}/${repo}-${safe}`
}

function NewWorktreeForm({ onOpenChange, startRef }: Props): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const addWorktree = useActions((s) => s.addWorktree)
  const worktrees = useActions((s) => s.worktrees)
  const openTab = useWorkspace((s) => s.add)

  const existing = startRef ? shortRefName(startRef) : ''
  const [mode, setMode] = useState<'existing' | 'new'>(existing ? 'existing' : 'new')
  const [branchName, setBranchName] = useState('')
  const [openAfter, setOpenAfter] = useState(true)

  // The directory follows the branch name until the user types their own.
  // Derived rather than synced in an effect: the suggestion is a pure function
  // of what is already on screen, and an effect would only add a render pass.
  const [typedPath, setTypedPath] = useState<string | null>(null)
  const basis = mode === 'existing' ? existing : branchName.trim()
  const path = typedPath ?? (basis ? suggestPath(root, basis) : '')

  const busyHere = busy === 'addWorktree'
  const name = mode === 'existing' ? existing : branchName.trim()
  const canCreate = root !== null && name !== '' && path.trim() !== '' && busy === null

  // A branch already checked out elsewhere cannot be checked out again, and
  // saying so here is friendlier than letting git refuse.
  const conflict =
    mode === 'existing'
      ? worktrees.find((w) => w.branch === startRef)
      : worktrees.find((w) => shortRefName(w.branch ?? '') === branchName.trim())

  const submit = async (): Promise<void> => {
    if (!root || !canCreate || conflict) return
    const done = await addWorktree(root, {
      path: path.trim(),
      ...(mode === 'existing' ? { ref: startRef } : { newBranch: branchName.trim() }),
      ...(mode === 'new' && startRef ? { ref: startRef } : {})
    })
    if (!done) return
    onOpenChange(false)
    if (openAfter) await openTab(path.trim())
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New worktree</DialogTitle>
        <DialogDescription>
          A second checkout of this repository, so another branch can be open at the same
          time.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        {existing && (
          <div className="flex gap-1 rounded-xs bg-surface-inset p-px text-2xs">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={
                mode === 'existing'
                  ? 'flex-1 rounded-xs bg-accent-bg px-2 py-0.5 text-accent-content'
                  : 'flex-1 rounded-xs px-2 py-0.5 text-content-secondary hover:text-content-primary'
              }
            >
              Check out {existing}
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={
                mode === 'new'
                  ? 'flex-1 rounded-xs bg-accent-bg px-2 py-0.5 text-accent-content'
                  : 'flex-1 rounded-xs px-2 py-0.5 text-content-secondary hover:text-content-primary'
              }
            >
              New branch from it
            </button>
          </div>
        )}

        {mode === 'new' && (
          <>
            <Label htmlFor="wt-branch" className="text-2xs">
              New branch
            </Label>
            <Input
              id="wt-branch"
              value={branchName}
              autoFocus
              spellCheck={false}
              placeholder="feature/my-change"
              onChange={(e) => setBranchName(e.target.value)}
              className="h-7 text-xs"
            />
          </>
        )}

        <Label htmlFor="wt-path" className="pt-1 text-2xs">
          Directory
        </Label>
        <Input
          id="wt-path"
          value={path}
          spellCheck={false}
          placeholder="/path/to/checkout"
          onChange={(e) => setTypedPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          className="h-7 font-mono text-2xs"
        />

        {conflict && (
          <p className="text-2xs text-danger-content">
            {name} is already checked out in {conflict.path}. A branch can only be in one
            worktree at a time.
          </p>
        )}

        <label className="flex cursor-default items-center gap-1.5 pt-1 text-2xs text-content-secondary">
          <input
            type="checkbox"
            checked={openAfter}
            onChange={(e) => setOpenAfter(e.target.checked)}
            className="size-3 accent-accent-bg"
          />
          Open it in a new tab
        </label>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canCreate || conflict !== undefined} onClick={() => void submit()}>
          {busyHere ? 'Creating…' : 'Create worktree'}
        </Button>
      </DialogFooter>
    </>
  )
}
