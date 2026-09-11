#!/usr/bin/env node
/**
 * Fail the build when renderer code reaches for a Node global.
 *
 * The renderer runs with contextIsolation and no node integration, so
 * `process`, `require`, `__dirname` and friends are simply absent — a
 * reference throws at render time and React unmounts the tree. Types do not
 * catch it: `src/shared` is typechecked against Node lib for the main process,
 * so `process.platform` is perfectly valid there and still explodes once the
 * renderer imports it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

/** Everything the renderer bundles: its own tree, plus whatever it imports. */
const RENDERER = 'src/renderer/src'
const SHARED = 'src/shared'

const FORBIDDEN = [
  { name: 'process', pattern: /(?<![.\w])process\s*\./ },
  { name: 'require', pattern: /(?<![.\w])require\s*\(/ },
  { name: '__dirname', pattern: /(?<![.\w])__dirname\b/ },
  { name: '__filename', pattern: /(?<![.\w])__filename\b/ },
  { name: 'Buffer', pattern: /(?<![.\w])Buffer\s*\./ },
  { name: 'node: import', pattern: /from\s+['"]node:/ }
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (['.ts', '.tsx'].includes(extname(path))) out.push(path)
  }
  return out
}

/** Strip comments so prose about `process` does not trip the check. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const findings = []
for (const dir of [RENDERER, SHARED]) {
  for (const file of walk(dir)) {
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(source)) {
        findings.push({ file: relative('.', file), name })
      }
    }
  }
}

if (findings.length === 0) {
  console.log('check-renderer-globals: no Node globals reachable from the renderer.')
  process.exit(0)
}

console.error('check-renderer-globals: these are undefined in the renderer\n')
for (const { file, name } of findings) console.error(`  ${name.padEnd(12)} ${file}`)
console.error(
  '\nThe renderer runs with contextIsolation and no node integration, so this' +
    '\nthrows at render time. Move it to the main process, or expose it through' +
    '\nthe preload bridge.'
)
process.exit(1)
