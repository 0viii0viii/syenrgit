import { resolvedLines } from '@shared/merge.js'
import type { MergeChunk } from '@shared/git.js'

const chunk = (ours: string[], theirs: string[]): MergeChunk =>
  ({ id: 0, type: 'conflict', base: [], ours, theirs })

const cases: [string, string[], string[], string[]][] = [
  ['end of file, both newline-terminated', ['a', ''], ['b', ''], ['a', 'b', '']],
  ['interior lines', ['a'], ['b'], ['a', 'b']],
  ['multi-line interior', ['a', 'b'], ['c'], ['a', 'b', 'c']],
  ['ours empty (deletion)', [], ['b'], ['b']],
  ['theirs empty', ['a'], [], ['a']],
  ['ours has no trailing newline', ['a'], ['b', ''], ['a', 'b', '']]
]

let fail = 0
for (const [name, ours, theirs, expect] of cases) {
  const got = resolvedLines(chunk(ours, theirs), { kind: 'both' })
  const ok = JSON.stringify(got) === JSON.stringify(expect)
  console.log(ok ? '  ok  ' : ' FAIL ', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(expect)}`)
  if (!ok) fail++
}
process.exit(fail ? 1 : 0)
