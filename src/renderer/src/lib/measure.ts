/**
 * Resolve a CSS custom property to pixels.
 *
 * `getComputedStyle().getPropertyValue()` returns custom properties as
 * authored ("1.75rem"), not resolved, so a probe element is used instead. That
 * keeps the token file authoritative for graph geometry — the SVG reads the
 * same values the CSS does, in whatever unit a designer writes them.
 */
export function measureVar(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:var(${name})`
  document.body.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height || fallback
}

/** Cycle a lane index through the eight graph lane tokens. */
export function laneColorVar(index: number): string {
  return `var(--graph-lane-${(((index % 8) + 8) % 8) + 1})`
}

/**
 * Advance width of one monospace character, in px.
 *
 * A virtualized diff mounts only the visible lines, so the scroll container
 * cannot derive its width from its contents — the horizontal scrollbar would
 * resize on every scroll. Measuring the character cell lets the width be
 * computed from the longest line instead.
 */
let cachedCharWidth: number | null = null

export function monoCharWidth(): number {
  if (cachedCharWidth !== null) return cachedCharWidth
  if (typeof document === 'undefined') return 7.2

  const probe = document.createElement('span')
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;' +
    'font-family:var(--diff-font);font-size:var(--diff-font-size)'
  probe.textContent = '0'.repeat(100)
  document.body.appendChild(probe)
  const width = probe.getBoundingClientRect().width / 100
  probe.remove()

  cachedCharWidth = width || 7.2
  return cachedCharWidth
}
