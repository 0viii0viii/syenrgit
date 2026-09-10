import { useEffect, useState } from 'react'
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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ref to branch from. Defaults to the checked-out branch. */
  startPoint?: string
}

/**
 * The form lives in its own component so closing the dialog unmounts it and
 * the fields reset on their own — no effect resetting state on `open`, which
 * would cost a render pass every time the dialog appears.
 */
export function NewBranchDialog({ open, onOpenChange, startPoint }: Props): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {open && <NewBranchForm onOpenChange={onOpenChange} startPoint={startPoint} />}
      </DialogContent>
    </Dialog>
  )
}

function NewBranchForm({
  onOpenChange,
  startPoint
}: Omit<Props, 'open'>): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const busy = useActions((s) => s.busy)
  const createBranch = useActions((s) => s.createBranch)

  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [valid, setValid] = useState(true)

  // Ask git whether the name is legal rather than reimplementing
  // check-ref-format, which has more rules than anyone remembers.
  useEffect(() => {
    if (!root || name.trim() === '') return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.validateBranchName(root, name).then((result) => {
        if (!cancelled) setValid(result)
      })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [root, name])

  const base = startPoint ? shortRefName(startPoint) : (status?.branch.name ?? 'HEAD')
  // An empty field is not "invalid", it is just empty — derived rather than
  // written back into state so the effect never has to reset it.
  const showInvalid = name.trim() !== '' && !valid
  const canCreate = root !== null && name.trim() !== '' && valid && busy === null

  const submit = async (): Promise<void> => {
    if (!root || !canCreate) return
    const done = await createBranch(root, {
      name: name.trim(),
      ...(startPoint ? { startPoint } : {}),
      checkout
    })
    if (done) onOpenChange(false)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New branch</DialogTitle>
        <DialogDescription>Branching from {base}.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="branch-name" className="text-2xs">
          Name
        </Label>
        <Input
          id="branch-name"
          value={name}
          autoFocus
          spellCheck={false}
          placeholder="feature/my-change"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          className="h-7 text-xs"
        />
        {showInvalid && (
          <p className="text-2xs text-danger-content">Git will not accept that name.</p>
        )}

        <label className="flex cursor-default items-center gap-1.5 pt-1 text-2xs text-content-secondary">
          <input
            type="checkbox"
            checked={checkout}
            onChange={(e) => setCheckout(e.target.checked)}
            className="size-3 accent-accent-bg"
          />
          Switch to it after creating
        </label>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canCreate} onClick={() => void submit()}>
          {busy === 'createBranch' ? 'Creating…' : 'Create branch'}
        </Button>
      </DialogFooter>
    </>
  )
}
