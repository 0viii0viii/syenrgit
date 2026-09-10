import { useEffect, useState } from 'react'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { UpdateState } from '@shared/ipc'

/**
 * Update status, in the status bar.
 *
 * Silent until there is something to say: checking and idle render nothing, so
 * the common case costs no space and no attention.
 */
export function UpdateBadge(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    // The badge is decoration; a failed read must not become an unhandled
    // rejection in the renderer.
    void window.api
      .updateState()
      .then(setState)
      .catch(() => setState({ status: 'idle' }))
    return window.api.onUpdateChanged(setState)
  }, [])

  if (state.status === 'idle' || state.status === 'checking') return null

  if (state.status === 'unsupported') {
    // Worth one quiet line: the user would otherwise wait indefinitely for an
    // update that is never going to arrive. Development is the exception —
    // nobody running `pnpm dev` is waiting for one.
    if (state.reason.includes('development')) return null
    return (
      <span className="shrink-0 truncate text-2xs text-content-tertiary" title={state.reason}>
        Updates unavailable
      </span>
    )
  }

  if (state.status === 'error') {
    return (
      <span className="shrink-0 truncate text-2xs text-content-tertiary" title={state.message}>
        Update check failed
      </span>
    )
  }

  if (state.status === 'downloading') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-2xs text-content-tertiary">
        <Loader2 className="size-3 animate-spin" />
        Downloading {state.version || 'update'}
        {state.percent > 0 && <span className="tabular-nums">{state.percent}%</span>}
      </span>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void window.api.installUpdate()}
      title={`Restart to install ${state.version}`}
      className={cn('h-4 gap-1 px-1 text-2xs text-content-link hover:text-content-link')}
    >
      <ArrowUpCircle className="size-3" />
      Restart to update
    </Button>
  )
}
