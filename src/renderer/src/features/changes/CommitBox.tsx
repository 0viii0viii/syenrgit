import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isStaged } from '@/lib/git-status'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Archive } from 'lucide-react'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'

/**
 * Commit box at the foot of the change list.
 *
 * During a merge it prefills git's own MERGE_MSG and commits the merge — the
 * same `git commit` either way, since git decides from MERGE_HEAD whether the
 * result has one parent or two.
 */
export function CommitBox(): React.JSX.Element | null {
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const busy = useActions((s) => s.busy)
  const commit = useActions((s) => s.commit)
  const stash = useActions((s) => s.stash)

  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  // A ref, not state: this only guards the fetch, and writing it during the
  // effect would cost a render pass for something nothing displays.
  const prefilledFor = useRef<string | null>(null)
  /** The message we prefilled for an amend, so unticking can withdraw it. */
  const amendPrefill = useRef<string | null>(null)

  const merging = status?.operation === 'merge'
  const stagedCount = status?.files.filter(isStaged).length ?? 0
  const conflicts = status?.files.filter((f) => f.conflicted).length ?? 0

  // Pull git's prepared merge message in once per merge, and never over an
  // edit the user has already started.
  useEffect(() => {
    if (!merging) {
      prefilledFor.current = null
      return
    }
    if (!root || prefilledFor.current === root) return

    prefilledFor.current = root
    let cancelled = false
    void window.api.mergeMessage(root).then((prepared) => {
      if (cancelled || !prepared) return
      setMessage((current) => (current.trim() === '' ? prepared : current))
    })
    return () => {
      cancelled = true
    }
  }, [root, merging])

  // Ticking amend pulls in HEAD's message; unticking withdraws it again, but
  // only if the user has not edited it in between.
  const toggleAmend = (next: boolean): void => {
    setAmend(next)
    if (!root) return
    if (next) {
      void window.api.headMessage(root).then((previous) => {
        if (!previous) return
        setMessage((current) => {
          if (current.trim() !== '') return current
          amendPrefill.current = previous
          return previous
        })
      })
    } else if (amendPrefill.current !== null) {
      setMessage((current) => (current === amendPrefill.current ? '' : current))
      amendPrefill.current = null
    }
  }

  if (!root) return null

  const blocked = conflicts > 0
  // Amending replaces the previous commit, so an empty index is fine — it is
  // how you fix only the message.
  const nothingStaged = stagedCount === 0 && !merging && !amend
  const disabled = busy !== null || blocked || nothingStaged || message.trim() === ''

  const label = amend ? 'Amend' : merging ? 'Commit merge' : 'Commit'
  const hint = blocked
    ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} left to resolve`
    : amend
      ? 'Replaces the previous commit'
      : nothingStaged
        ? 'Nothing staged'
        : merging
          ? 'Merge in progress'
          : `${stagedCount} staged`

  return (
    <div className="shrink-0 space-y-1.5 border-t border-border-subtle bg-surface-app p-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={merging ? 'Merge message' : 'Commit message'}
        spellCheck={false}
        className="selectable h-16 min-h-0 resize-none bg-surface-inset text-xs leading-normal"
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter commits, the convention every git GUI shares.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !disabled) {
            e.preventDefault()
            void commit(root, message, amend).then((done) => {
              if (done) {
                setMessage('')
                setAmend(false)
              }
            })
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'truncate text-2xs',
            blocked ? 'text-status-conflicted' : 'text-content-tertiary'
          )}
        >
          {hint}
        </span>

        {/* Amending a pushed commit rewrites history, so it is off by default
            and never sticky across commits. */}
        <label
          className={cn(
            'flex shrink-0 cursor-default items-center gap-1 text-2xs',
            merging ? 'opacity-40' : 'text-content-secondary'
          )}
          title={
            merging
              ? 'Finish the merge first'
              : 'Replace the previous commit instead of adding one'
          }
        >
          <input
            type="checkbox"
            checked={amend}
            disabled={merging || busy !== null}
            onChange={(e) => toggleAmend(e.target.checked)}
            className="size-3 accent-accent-bg"
          />
          Amend
        </label>

        {/* Stashing mid-merge would shelve a half-finished merge; git allows
            it but restoring it later is a trap, so it is offered only on a
            plain dirty tree. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null || merging || (status?.files.length ?? 0) === 0}
              className="ml-auto h-6 gap-1 px-1.5 text-2xs"
            >
              <Archive className="size-3" />
              Stash
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void stash(root, message, false)}>
              Stash tracked changes
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void stash(root, message, true)}>
              Stash, including untracked
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          className="h-6 px-2 text-2xs"
          disabled={disabled}
          onClick={() =>
            void commit(root, message, amend).then((done) => {
              if (done) {
                setMessage('')
                setAmend(false)
              }
            })
          }
        >
          {busy === 'commit' ? (amend ? 'Amending…' : 'Committing…') : label}
        </Button>
      </div>
    </div>
  )
}
