/**
 * Subsequence matching for the ref filter.
 *
 * Typing "fa" should reach "feature/auth", so a plain substring test is too
 * strict — but the characters must still appear in order, or the filter turns
 * into "contains these letters somewhere" and stops being predictable.
 */
export function matchesRef(candidate: string, query: string): boolean {
  if (query === '') return true
  const haystack = candidate.toLowerCase()
  const needle = query.toLowerCase()

  // A contiguous match is the common case and cheap to settle first.
  if (haystack.includes(needle)) return true

  let at = 0
  for (const character of needle) {
    // Whitespace in a query is the user separating ideas, not something to
    // find in a ref name.
    if (character === ' ') continue
    const found = haystack.indexOf(character, at)
    if (found === -1) return false
    at = found + 1
  }
  return true
}

/**
 * Rank matches so the most likely one is on top.
 *
 * Lower is better: an exact name beats a prefix, a prefix beats a substring,
 * and anything contiguous beats a scattered subsequence.
 */
export function refMatchScore(candidate: string, query: string): number {
  if (query === '') return 0
  const haystack = candidate.toLowerCase()
  const needle = query.toLowerCase()

  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1

  // A match right after a separator reads as a prefix too: "auth" should rank
  // highly for "feature/auth".
  const segments = haystack.split(/[/\-_.]/)
  if (segments.some((segment) => segment.startsWith(needle))) return 2

  const index = haystack.indexOf(needle)
  if (index !== -1) return 3 + index / 1000
  return 100
}
