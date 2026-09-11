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
import { Textarea } from '@/components/ui/textarea'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Commit to tag. Defaults to HEAD. */
  target?: string
  /** Shown so the user can see what they are tagging. */
  targetLabel?: string
}

export function NewTagDialog(props: Props): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-sm">
        {props.open && <NewTagForm {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function NewTagForm({ onOpenChange, target, targetLabel }: Props): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const busy = useActions((s) => s.busy)
  const createTag = useActions((s) => s.createTag)

  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [valid, setValid] = useState(true)
  // Carries the name it describes, so a stale answer never colours a name the
  // user has since edited — and so nothing has to be reset synchronously.
  const [taken, setTaken] = useState({ name: '', exists: false })

  useEffect(() => {
    if (!root || name.trim() === '') return
    let cancelled = false
    const timer = setTimeout(() => {
      void Promise.all([
        window.api.validateTagName(root, name),
        window.api.tagExists(root, name)
      ]).then(([legal, already]) => {
        if (cancelled) return
        setValid(legal)
        setTaken({ name: name.trim(), exists: already })
      })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [root, name])

  const exists = taken.exists && taken.name === name.trim()

  const showInvalid = name.trim() !== '' && !valid
  const canCreate = root !== null && name.trim() !== '' && valid && busy === null

  const submit = async (force = false): Promise<void> => {
    if (!root || !canCreate) return
    const done = await createTag(root, {
      name: name.trim(),
      ...(target ? { target } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
      ...(force ? { force: true } : {})
    })
    if (done) onOpenChange(false)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New tag</DialogTitle>
        <DialogDescription>Tagging {targetLabel ?? 'HEAD'}.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="tag-name" className="text-2xs">
          Name
        </Label>
        <Input
          id="tag-name"
          value={name}
          autoFocus
          spellCheck={false}
          placeholder="v1.0.0"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit(exists)
            }
          }}
          className="h-7 text-xs"
        />
        {showInvalid && (
          <p className="text-2xs text-danger-content">Git will not accept that name.</p>
        )}
        {/* An existing name is a move, not a mistake — but only here. A tag
            that has been pushed keeps its old commit on the remote and for
            everyone who already fetched it. */}
        {exists && !showInvalid && (
          <p className="text-2xs text-content-secondary">
            {name.trim()} already exists. Creating it again moves it here, locally — push it
            with force to move it on a remote too.
          </p>
        )}

        <Label htmlFor="tag-message" className="pt-1 text-2xs">
          Message
        </Label>
        <Textarea
          id="tag-message"
          value={message}
          spellCheck={false}
          placeholder="Leave empty for a lightweight tag"
          onChange={(e) => setMessage(e.target.value)}
          className="h-16 min-h-0 resize-none bg-surface-inset text-xs"
        />
        {/* Annotated tags carry a tagger and a date, and are what `git
            describe` and most release tooling expect. */}
        <p className="text-2xs text-content-tertiary">
          {message.trim() ? 'Creates an annotated tag.' : 'Creates a lightweight tag.'}
        </p>
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canCreate} onClick={() => void submit(exists)}>
          {busy === 'createTag'
            ? exists
              ? 'Moving…'
              : 'Creating…'
            : exists
              ? 'Move tag here'
              : 'Create tag'}
        </Button>
      </DialogFooter>
    </>
  )
}
