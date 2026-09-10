#!/usr/bin/env node
/**
 * Fail the build when a component uses a Tailwind utility that generates no CSS.
 *
 * This catches a silent failure mode specific to a token-driven design system:
 * a semantic token exists (`--accent-bg`) but was never bridged into the theme
 * (`--color-accent-bg`), so `bg-accent-bg` compiles to nothing. Types pass,
 * the build passes, and the element just renders unstyled.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const SRC = 'src/renderer/src'
const CSS_DIR = 'out/renderer/assets'

/**
 * shadcn/ui is CLI-generated; its classes are not ours to police.
 *
 * Written with the platform separator: on Windows a path reads
 * `components\ui`, so a hardcoded forward slash silently matches nothing and
 * the check fails on CI for classes that were never ours.
 */
const IGNORED_DIRS = [join('components', 'ui')]

/**
 * Prefixes whose values come from the theme. Layout utilities (`flex`, `w-1/2`)
 * are excluded because they are always built in and would only add noise.
 */
const PREFIXES = [
  'bg', 'text', 'border', 'fill', 'stroke', 'ring', 'outline',
  'shadow', 'divide', 'decoration', 'caret', 'placeholder', 'from', 'via', 'to'
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (IGNORED_DIRS.some((d) => path.includes(d))) continue
      out.push(...walk(path))
    } else if (['.ts', '.tsx'].includes(extname(path))) {
      out.push(path)
    }
  }
  return out
}

function loadCss() {
  let files
  try {
    files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))
  } catch {
    console.error(`check-tokens: no build output in ${CSS_DIR}. Run the build first.`)
    process.exit(2)
  }
  if (files.length === 0) {
    console.error(`check-tokens: no CSS in ${CSS_DIR}. Run the build first.`)
    process.exit(2)
  }
  return files.map((f) => readFileSync(join(CSS_DIR, f), 'utf8')).join('\n')
}

const css = loadCss()
// The lookbehind keeps the prefix from matching inside a longer identifier —
// `--graph-stroke-width` must not read as the utility `stroke-width`.
const classPattern = new RegExp(
  `(?<![-\\w])(?:${PREFIXES.join('|')})-[a-z0-9][a-z0-9-]*`,
  'g'
)

const used = new Map() // class -> Set<file>
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(classPattern)) {
    const name = match[0]
    if (!used.has(name)) used.set(name, new Set())
    used.get(name).add(file)
  }
}

/**
 * A rule exists if the class appears after a `.` (plain) or after an escaped
 * `:` (behind a variant such as `hover:` or `group-hover:`).
 */
function hasRule(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\.|\\\\:)${escaped}(?=[{,:\\s\\\\/])`).test(css)
}

const missing = [...used.keys()].filter((name) => !hasRule(name)).sort()

if (missing.length === 0) {
  console.log(`check-tokens: ${used.size} themed utilities, all resolve.`)
  process.exit(0)
}

console.error('check-tokens: these utilities generate no CSS\n')
for (const name of missing) {
  console.error(`  ${name}`)
  for (const file of used.get(name)) console.error(`    ${file}`)
}
console.error(
  '\nEither the class is a typo, or its token is defined in the semantic layer' +
    '\nbut never bridged into `@theme inline` in styles/globals.css.'
)
process.exit(1)
