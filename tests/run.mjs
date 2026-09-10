#!/usr/bin/env node
/**
 * Run every suite in tests/ and summarise.
 *
 * These are integration tests: each one builds throwaway repositories in the
 * OS temp directory and drives the real `git` binary, which is the only way to
 * check code whose entire job is talking to git. There is no test framework —
 * a suite is a script that prints "N passed, M failed" and exits non-zero if
 * anything failed.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const only = process.argv.slice(2)

const suites = readdirSync(here)
  .filter((f) => f.endsWith('.mts'))
  .filter((f) => only.length === 0 || only.some((name) => f.includes(name)))
  .sort()

if (suites.length === 0) {
  console.error(only.length > 0 ? `No suite matches ${only.join(', ')}` : 'No suites found')
  process.exit(1)
}

let failed = 0
const started = Date.now()

for (const suite of suites) {
  const label = suite.replace(/\.mts$/, '')
  process.stdout.write(`  ${label.padEnd(22)}`)
  try {
    const out = execFileSync(
      'node',
      ['--import', 'tsx', join(here, suite)],
      { encoding: 'utf8', cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'] }
    )
    // Each suite ends with its own tally; show that rather than every line.
    const summary = out.trim().split('\n').filter(Boolean).pop() ?? 'ok'
    console.log(summary)
  } catch (err) {
    failed++
    console.log('FAILED')
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    const lines = detail.split('\n')

    // Show the failures themselves, wherever they are. A tail window hides
    // them whenever a suite fails early and keeps going — which is exactly
    // when the output is long enough to need trimming.
    const failures = lines.filter((line) => /^\s*FAIL\b/.test(line))
    if (failures.length > 0) {
      for (const line of failures) console.log(`      ${line.trim()}`)
      const tally = lines.find((line) => /\d+ passed, \d+ failed/.test(line))
      if (tally) console.log(`      ${tally.trim()}`)
    } else {
      // A crash rather than an assertion; the tail is the stack.
      for (const line of lines.slice(-20)) console.log(`      ${line}`)
    }
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  failed === 0
    ? `\n${suites.length} suites passed in ${seconds}s`
    : `\n${failed} of ${suites.length} suites FAILED (${seconds}s)`
)
process.exit(failed === 0 ? 0 : 1)
