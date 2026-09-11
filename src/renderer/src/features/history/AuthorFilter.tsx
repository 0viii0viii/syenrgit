import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, UserRound } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useHistory } from '@/stores/history'
import { useRepo } from '@/stores/repo'

interface Props {
  /** Email of the author currently filtered on, if any. */
  value: string | undefined
  /** Null clears the filter. */
  onSelect: (email: string | null) => void
}

/**
 * Pick a person out of the history.
 *
 * This writes into the same query the search box holds rather than filtering
 * alongside it. Two filters that can each narrow the list independently is two
 * places to look when the list is unexpectedly empty; one query, shown in the
 * box as `author:…`, can only ever say one thing.
 */
export function AuthorFilter({ value, onSelect }: Props): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const authors = useHistory((s) => s.authors)
  const loadAuthors = useHistory((s) => s.loadAuthors)
  const [needle, setNeedle] = useState('')

  useEffect(() => {
    if (root) void loadAuthors(root)
  }, [root, loadAuthors])

  const selected = authors.find((a) => a.email.toLowerCase() === value?.toLowerCase())

  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (!q) return authors
    return authors.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    )
  }, [authors, needle])

  // A typed `author:` that matches nobody in the list is still a real filter —
  // the list only reaches back so far — so the trigger reflects the query, not
  // whether it was found here.
  const label = selected?.name ?? value ?? 'Anyone'

  return (
    <DropdownMenu onOpenChange={(open) => !open && setNeedle('')}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-5 max-w-36 shrink-0 items-center gap-1 rounded-xs px-1 text-2xs',
          'hover:bg-surface-active focus-visible:outline-none',
          value ? 'text-content-primary' : 'text-content-tertiary'
        )}
        title="Filter history by author"
      >
        <UserRound className="size-2.5 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-2.5 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="border-b border-border-subtle p-1">
          <Input
            autoFocus
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            // Radix runs its own typeahead on the menu; without this every
            // keystroke would also jump the highlighted item.
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            placeholder="Filter people"
            className="h-6 border-0 bg-transparent px-1 text-2xs shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="scroll-thin max-h-64 overflow-y-auto py-1">
          <DropdownMenuItem className="text-xs" onSelect={() => onSelect(null)}>
            <Check className={cn('size-3', value ? 'invisible' : 'visible')} />
            Anyone
          </DropdownMenuItem>

          {shown.length > 0 && <DropdownMenuSeparator />}

          {shown.map((a) => (
            <DropdownMenuItem
              key={a.email}
              className="text-xs"
              onSelect={() => onSelect(a.email)}
              title={`${a.name} <${a.email}>`}
            >
              <Check
                className={cn(
                  'size-3 shrink-0',
                  a.email === selected?.email ? 'visible' : 'invisible'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 text-2xs tabular-nums text-content-tertiary">
                {a.commits}
              </span>
            </DropdownMenuItem>
          ))}

          {authors.length > 0 && shown.length === 0 && (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">Nobody matches</p>
          )}
          {authors.length === 0 && (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">No authors loaded yet</p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
