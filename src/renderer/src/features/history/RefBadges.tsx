import { GitBranch, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RefBadge } from '@shared/git'

const BADGE_CLASS: Record<RefBadge['kind'], string> = {
  head: 'bg-ref-head-bg text-ref-head-content',
  local: 'bg-ref-local-bg text-ref-local-content',
  remote: 'bg-ref-remote-bg text-ref-remote-content',
  tag: 'bg-ref-tag-bg text-ref-tag-content'
}

export function RefBadges({ refs }: { refs: RefBadge[] }): React.JSX.Element | null {
  if (refs.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1">
      {refs.map((ref) => (
        <span
          key={`${ref.kind}:${ref.name}`}
          className={cn(
            'flex max-w-32 items-center gap-0.5 rounded-xs px-1 text-2xs leading-4',
            // HEAD's own branch gets the strong treatment; everything else is
            // quiet so a busy row stays scannable.
            ref.isHead ? BADGE_CLASS.head : BADGE_CLASS[ref.kind]
          )}
          title={ref.name}
        >
          {ref.kind === 'tag' ? (
            <Tag className="size-2.5 shrink-0" />
          ) : (
            <GitBranch className="size-2.5 shrink-0" />
          )}
          <span className="truncate">{ref.name}</span>
        </span>
      ))}
    </span>
  )
}
