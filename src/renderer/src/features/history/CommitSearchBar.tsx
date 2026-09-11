import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useHistory } from '@/stores/history'
import { useRepo } from '@/stores/repo'
import { parseQuery, queryFromSearch } from './parse-query'
import { AuthorFilter } from './AuthorFilter'

/** Debounce, so a walk is not spawned on every keystroke. */
const SETTLE_MS = 300

export function CommitSearchBar(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const search = useHistory((s) => s.search)
  const searching = useHistory((s) => s.searching)
  const commits = useHistory((s) => s.commits)
  const loading = useHistory((s) => s.loading)
  const setSearch = useHistory((s) => s.setSearch)
  const clearSearch = useHistory((s) => s.clearSearch)

  // Seeded from the store so a tab switch restores what was typed.
  const [text, setText] = useState(() => queryFromSearch(search))
  const applied = useRef(text)

  useEffect(() => {
    if (!root || text === applied.current) return
    const timer = setTimeout(() => {
      applied.current = text
      const parsed = parseQuery(text)
      if (Object.keys(parsed).length === 0) void clearSearch(root)
      else void setSearch(root, parsed)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text, root, setSearch, clearSearch])

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-app px-2">
      <Search className="size-3 shrink-0 text-content-tertiary" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text !== '') {
            e.preventDefault()
            setText('')
          }
        }}
        spellCheck={false}
        placeholder="Search commits — message, author:name, or a commit id"
        className={cn(
          'h-5 min-w-0 flex-1 border-0 bg-transparent px-0 text-2xs',
          'shadow-none focus-visible:ring-0'
        )}
      />

      {/* Rewritten through the serializer rather than spliced into the text,
          so picking a person and typing `author:` cannot disagree. */}
      <AuthorFilter
        value={parseQuery(text).author}
        onSelect={(email) => {
          const next = parseQuery(text)
          if (email) next.author = email
          else delete next.author
          setText(queryFromSearch(next))
        }}
      />

      {searching && (
        <span className="shrink-0 text-2xs tabular-nums text-content-tertiary">
          {loading ? '…' : `${commits.length} ${commits.length === 1 ? 'match' : 'matches'}`}
        </span>
      )}
      {text !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setText('')}
          className="flex size-4 shrink-0 items-center justify-center rounded-xs text-content-tertiary hover:bg-surface-active hover:text-content-primary"
        >
          <X className="size-2.5" />
        </button>
      )}
    </div>
  )
}
