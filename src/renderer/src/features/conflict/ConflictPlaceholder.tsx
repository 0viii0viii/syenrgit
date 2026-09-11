import { GitMerge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMerge } from '@/stores/merge'
import { useRepo } from '@/stores/repo'

/**
 * What the diff pane shows for a conflicted path.
 *
 * There is no two-sided diff to draw — git emits a combined diff for an
 * unmerged path — and the resolution happens in a window of its own, so the
 * pane's job is to say why it is empty and offer the way back in.
 */
export function ConflictPlaceholder({ path }: { path: string }): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const open = useMerge((s) => s.open)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-default px-6 text-center">
      <p className="text-xs font-medium">{path}</p>
      <p className="max-w-xs text-xs text-content-secondary">
        Both sides changed this file. It has no diff until one version of it exists.
      </p>
      <Button size="sm" className="gap-1" onClick={() => root && void open(root, path)}>
        <GitMerge className="size-3.5" />
        Resolve conflict
      </Button>
    </div>
  )
}
