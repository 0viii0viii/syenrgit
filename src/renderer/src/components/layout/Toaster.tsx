import { useEffect, useState } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'
import { useToasts, type Toast } from '@/stores/toasts'

/**
 * How long a success stays up.
 *
 * Long enough to read a sentence without being asked to acknowledge it —
 * confirmation of something that worked is not worth a click.
 */
const DISMISS_MS = 6000

/**
 * Results, reported where they will be seen.
 *
 * These used to appear as a line of grey text in the status bar, at the far
 * corner from everything the user was doing, and vanished on the next action
 * whether or not anyone had read them.
 *
 * Failures stay until dismissed: something did not happen, and the
 * acknowledgement is the point. Successes go on their own, because a click to
 * confirm that a push worked is a click spent on nothing.
 */
export function Toaster(): React.JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  const push = useToasts((s) => s.push)

  // The stores report through `notice` and `error`, which stay set until
  // something clears them. Each one is drained as it arrives so that doing the
  // same thing twice — two pushes, two identical messages — reads as two
  // events rather than one unchanged string.
  useEffect(
    () =>
      useActions.subscribe((state, previous) => {
        if (state.error && state.error !== previous.error) {
          push('error', state.error)
          useActions.getState().clear()
        } else if (state.notice && state.notice !== previous.notice) {
          push('success', state.notice)
          useActions.getState().clear()
        }
      }),
    [push]
  )

  useEffect(
    () =>
      useRepo.subscribe((state, previous) => {
        if (state.error && state.error !== previous.error) {
          push('error', state.error)
          useRepo.setState({ error: null })
        }
      }),
    [push]
  )

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-statusbar right-0 z-50 flex w-full max-w-sm flex-col gap-1.5 p-3"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastRow({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useToasts((s) => s.dismiss)
  const [paused, setPaused] = useState(false)
  const sticky = toast.kind === 'error'

  // Restarted rather than resumed on unhover. Resuming would mean a message
  // read halfway then left alone disappears a moment later.
  useEffect(() => {
    if (sticky || paused) return
    const timer = setTimeout(() => dismiss(toast.id), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [sticky, paused, toast.id, dismiss])

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-md border p-2 shadow-lg',
        'animate-in fade-in slide-in-from-bottom-2',
        sticky
          ? 'border-danger-content/30 bg-danger-subtle text-danger-content'
          : 'border-border-default bg-surface-overlay text-content-primary'
      )}
    >
      {sticky ? (
        <TriangleAlert className="mt-px size-3.5 shrink-0" />
      ) : (
        <Check className="mt-px size-3.5 shrink-0 text-success-content" />
      )}

      <p className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-snug">
        {toast.text}
      </p>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded-xs p-0.5 opacity-60 hover:bg-surface-active hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
