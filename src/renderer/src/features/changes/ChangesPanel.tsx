import { GitCompare } from 'lucide-react'
import { ChangeList } from './ChangeList'
import { CommitBox } from './CommitBox'
import { useRepo } from '@/stores/repo'

/**
 * The working tree, as a permanent section rather than a tab.
 *
 * Staging and committing is the most-used surface in the app, and history is
 * the thing you consult while doing it — which branch a change belongs on,
 * whether something is already committed, what the last message looked like.
 * As peer tabs each one hid the other exactly when it was wanted.
 */
export function ChangesPanel(): React.JSX.Element {
  const status = useRepo((s) => s.status)
  const count = status?.files.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-y border-border-subtle bg-surface-app px-2">
        <GitCompare className="size-3 shrink-0 text-content-tertiary" />
        <span className="text-2xs font-medium text-content-secondary">Changes</span>
        {count > 0 && (
          <span className="text-2xs tabular-nums text-content-tertiary">{count}</span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <ChangeList />
      </div>
      <CommitBox />
    </div>
  )
}
