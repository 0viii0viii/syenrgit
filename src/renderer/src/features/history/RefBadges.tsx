import { GitBranch, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RefBadge } from '@shared/git'

/**
 * Only HEAD is filled. Every other ref is an outline, so a commit carrying
 * four of them stays readable and the branch you are on is findable without
 * reading any of the names.
 */
const BADGE_CLASS: Record<RefBadge['kind'], string> = {
  head: 'border-transparent bg-ref-head-bg text-ref-head-content',
  local: 'border-ref-local-border text-ref-local-content',
  remote: 'border-ref-remote-border text-ref-remote-content',
  tag: 'border-ref-tag-border text-ref-tag-content'
}

export function RefBadges({ refs }: { refs: RefBadge[] }): React.JSX.Element | null {
  if (refs.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-1">
      {refs.map((ref) => (
        <span
          key={`${ref.kind}:${ref.name}`}
          className={cn(
            'flex max-w-32 items-center gap-1 rounded-xs border px-1 text-2xs leading-4',
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
