const MINUTE = 60
const HOUR = 3600
const DAY = 86400

/**
 * Compact relative time for dense commit rows ("3m", "2h", "5d", then a date).
 * Beyond a year the absolute date is more useful than "14mo".
 */
export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const delta = Math.max(0, Math.floor(now - unixSeconds))
  if (delta < MINUTE) return 'now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < DAY * 30) return `${Math.floor(delta / DAY)}d`
  if (delta < DAY * 365) return `${Math.floor(delta / (DAY * 30))}mo`
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short'
  })
}

export function absoluteTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/** "Ada Lovelace" -> "AL"; used for the commit author chip. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** "refs/heads/feature/x" -> "feature/x"; used for filter chips. */
export function shortRefName(refName: string): string {
  return refName
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^refs\/tags\//, '')
}

/** Which kind of ref a full ref name denotes. */
export function refKind(refName: string): 'local' | 'remote' | 'tag' | 'other' {
  if (refName.startsWith('refs/heads/')) return 'local'
  if (refName.startsWith('refs/remotes/')) return 'remote'
  if (refName.startsWith('refs/tags/')) return 'tag'
  return 'other'
}
