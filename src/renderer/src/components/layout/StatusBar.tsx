import { AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from './ThemeToggle'
import { UpdateBadge } from './UpdateBadge'
import { useActions } from '@/stores/actions'
import { useRepo } from '@/stores/repo'
import type { RepoOperation } from '@shared/git'

const OPERATION_LABEL: Record<RepoOperation, string | null> = {
  none: null,
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
  bisect: 'Bisecting'
}

/** Operations git can abandon cleanly; bisect needs `git bisect reset`. */
const ABORTABLE = new Set<RepoOperation>(['merge', 'rebase', 'cherry-pick', 'revert'])

export function StatusBar(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const status = useRepo((s) => s.status)
  const repoError = useRepo((s) => s.error)
  const busy = useActions((s) => s.busy)
  const actionError = useActions((s) => s.error)
  const notice = useActions((s) => s.notice)
  const abort = useActions((s) => s.abort)
  const rebaseStep = useActions((s) => s.rebaseStep)
  const sequencerStep = useActions((s) => s.sequencerStep)
  const clear = useActions((s) => s.clear)

  const operation = status?.operation ?? 'none'
  const label = OPERATION_LABEL[operation]
  const conflicts = status?.files.filter((f) => f.conflicted).length ?? 0
  const error = actionError ?? repoError

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-app px-2 text-2xs text-content-tertiary">
      {label && (
        <span className="flex shrink-0 items-center gap-1 text-warning-content">
          <AlertTriangle className="size-3" />
          {label}
        </span>
      )}
      {label && root && ABORTABLE.has(operation) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void abort(root, operation)}
          className="h-4 px-1 text-2xs text-content-secondary"
        >
          {busy === 'abort' ? 'Aborting…' : 'Abort'}
        </Button>
      )}
      {conflicts > 0 && (
        <span className="shrink-0 text-status-conflicted">
          {conflicts} conflicted {conflicts === 1 ? 'file' : 'files'}
        </span>
      )}

      {/* A stopped cherry-pick or revert is driven the same way as a rebase:
          git's sequencer runs all three with the same three verbs. */}
      {root && (operation === 'cherry-pick' || operation === 'revert') && (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || conflicts > 0}
            title={conflicts > 0 ? 'Resolve the conflicts first' : `Continue the ${operation}`}
            onClick={() => void sequencerStep(root, operation, 'continue')}
            className="h-4 px-1 text-2xs text-content-secondary"
          >
            Continue
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            title="Drop the commit that stopped it"
            onClick={() => void sequencerStep(root, operation, 'skip')}
            className="h-4 px-1 text-2xs text-content-secondary"
          >
            Skip
          </Button>
        </>
      )}

      {/* A stopped rebase is driven from here: continue once the conflicts
          are staged, or skip the commit that caused them. */}
      {root && operation === 'rebase' && (
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || conflicts > 0}
            title={conflicts > 0 ? 'Resolve the conflicts first' : 'Continue the rebase'}
            onClick={() => void rebaseStep(root, 'continue')}
            className="h-4 px-1 text-2xs text-content-secondary"
          >
            Continue
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            title="Drop the commit that stopped the rebase"
            onClick={() => void rebaseStep(root, 'skip')}
            className="h-4 px-1 text-2xs text-content-secondary"
          >
            Skip
          </Button>
        </>
      )}

      {error ? (
        <button
          type="button"
          onClick={clear}
          title={error}
          className="min-w-0 truncate text-left text-danger-content hover:underline"
        >
          {error}
        </button>
      ) : notice ? (
        <button
          type="button"
          onClick={clear}
          className="flex min-w-0 items-center gap-1 truncate text-left text-content-secondary hover:underline"
        >
          <Check className="size-3 shrink-0 text-success-content" />
          {notice}
        </button>
      ) : null}

      <div className="flex-1" />
      <UpdateBadge />
      <ThemeToggle />
      {status && <span className="shrink-0">{status.files.length} changes</span>}
    </footer>
  )
}
