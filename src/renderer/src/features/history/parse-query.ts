import type { CommitSearch } from '@shared/ipc'

/** Anything that could be a commit id, so pasting one just works. */
const LOOKS_LIKE_HASH = /^[0-9a-f]{7,40}$/i

/**
 * Turn one input into a search.
 *
 * A single box with an `author:` prefix beats three fields: the common case is
 * a few words from a commit message, and that costs no ceremony here.
 *
 * Kept apart from the component so it can be tested without pulling in React.
 */
export function parseQuery(raw: string): CommitSearch {
  const search: CommitSearch = {}
  const words: string[] = []

  for (const token of raw.split(/\s+/)) {
    if (!token) continue
    const authorPrefix = /^(?:author|by):(.*)$/i.exec(token)
    if (authorPrefix) {
      if (authorPrefix[1]) search.author = authorPrefix[1]
      continue
    }
    const hashPrefix = /^(?:hash|commit|id):(.*)$/i.exec(token)
    if (hashPrefix) {
      if (hashPrefix[1]) search.hash = hashPrefix[1]
      continue
    }
    words.push(token)
  }

  const rest = words.join(' ')
  if (!rest) return search

  // A bare hash is almost never a word someone is searching for, so it is
  // treated as an id — but only when it is the whole query, since a hex-looking
  // word alongside others is part of a message search.
  if (search.hash === undefined && words.length === 1 && LOOKS_LIKE_HASH.test(rest)) {
    search.hash = rest
    return search
  }
  search.message = rest
  return search
}

/** Render a stored search back into the box, so a tab switch is lossless. */
export function queryFromSearch(search: CommitSearch): string {
  const parts: string[] = []
  if (search.author) parts.push(`author:${search.author}`)
  if (search.hash) parts.push(search.hash)
  if (search.message) parts.push(search.message)
  return parts.join(' ')
}
