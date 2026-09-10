import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildMergeChunks, autoResolution } from '@main/git/merge.js'

const run = promisify(execFile)
const dir = mkdtempSync(join(tmpdir(), 'mf-'))

/** git's own three-way merge, as the reference implementation. */
async function gitMergeFile(base: string, ours: string, theirs: string) {
  writeFileSync(join(dir, 'base'), base)
  writeFileSync(join(dir, 'ours'), ours)
  writeFileSync(join(dir, 'theirs'), theirs)
  try {
    const { stdout } = await run('git', ['merge-file', '-p', '--diff3', 'ours', 'base', 'theirs'],
      { cwd: dir, maxBuffer: 1 << 26 })
    return { clean: true, text: stdout }
  } catch (e) {
    const err = e as { code?: number; stdout?: string }
    // Exit code is the conflict count; anything negative is a real failure.
    if (typeof err.code === 'number' && err.code > 0) {
      return { clean: false, text: err.stdout ?? '' }
    }
    throw e
  }
}

function mutate(lines: string[], rng: () => number, tag: string): string[] {
  const out = [...lines]
  const edits = 1 + Math.floor(rng() * 3)
  for (let e = 0; e < edits; e++) {
    if (out.length === 0) break
    const at = Math.floor(rng() * out.length)
    const op = rng()
    if (op < 0.4) out[at] = `${tag}${at}`
    else if (op < 0.7) out.splice(at, 0, `${tag}ins${at}`)
    else out.splice(at, 1)
  }
  return out
}

let mulberry = 12345
const rng = (): number => {
  mulberry |= 0; mulberry = (mulberry + 0x6d2b79f5) | 0
  let t = Math.imul(mulberry ^ (mulberry >>> 15), 1 | mulberry)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let cleanCases = 0, matched = 0, mismatched = 0
let conflictCases = 0, conflictAgree = 0, conflictDisagree = 0
const failures: string[] = []

for (let trial = 0; trial < 400; trial++) {
  const n = 5 + Math.floor(rng() * 25)
  const baseLines = Array.from({ length: n }, (_, i) => `line${i}`)
  const oursLines = mutate(baseLines, rng, 'O')
  const theirsLines = mutate(baseLines, rng, 'T')

  const base = baseLines.join('\n') + '\n'
  const ours = oursLines.join('\n') + '\n'
  const theirs = theirsLines.join('\n') + '\n'

  const ref = await gitMergeFile(base, ours, theirs)
  const chunks = buildMergeChunks(base.split('\n'), ours.split('\n'), theirs.split('\n'))
  const hasConflict = chunks.some((c) => c.type === 'conflict')

  if (ref.clean) {
    cleanCases++
    const mine = chunks.flatMap((c) => autoResolution(c) ?? ['<UNRESOLVED>']).join('\n')
    if (hasConflict) {
      mismatched++
      failures.push(`trial ${trial}: git merged cleanly, we reported a conflict`)
    } else if (mine === ref.text) matched++
    else {
      mismatched++
      if (failures.length < 3) {
        failures.push(`trial ${trial}: clean merge text differs\n  git : ${JSON.stringify(ref.text)}\n  ours: ${JSON.stringify(mine)}`)
      }
    }
  } else {
    conflictCases++
    if (hasConflict) conflictAgree++
    else {
      conflictDisagree++
      if (failures.length < 6) failures.push(`trial ${trial}: git reported a conflict, we auto-merged`)
    }
  }
}

console.log(`clean merges      : ${cleanCases}  identical to git: ${matched}  differing: ${mismatched}`)
console.log(`conflicting merges: ${conflictCases}  both flag conflict: ${conflictAgree}  we missed: ${conflictDisagree}`)
if (failures.length) { console.log('\nfailures:'); for (const f of failures) console.log(' -', f) }
process.exit(mismatched + conflictDisagree ? 1 : 0)
