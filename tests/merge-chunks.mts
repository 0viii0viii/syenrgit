import { buildMergeChunks, autoResolution } from '@main/git/merge.js'

let pass = 0, fail = 0
const L = (s: string): string[] => s.split('\n')

function check(name: string, base: string, ours: string, theirs: string, expect: string[]) {
  const chunks = buildMergeChunks(L(base), L(ours), L(theirs))
  const got = chunks.map(c => `${c.type}(${c.base.join('/')}|${c.ours.join('/')}|${c.theirs.join('/')})`)
  const ok = JSON.stringify(got) === JSON.stringify(expect)
  console.log(ok ? '  ok  ' : ' FAIL ', name)
  if (!ok) { console.log('    expected', JSON.stringify(expect)); console.log('    got     ', JSON.stringify(got)) }
  ok ? pass++ : fail++
  return chunks
}

// --- classification ---------------------------------------------------------
check('unchanged only', 'a\nb', 'a\nb', 'a\nb', ['unchanged(a/b|a/b|a/b)'])
check('ours only', 'a\nb\nc', 'a\nZ\nc', 'a\nb\nc',
  ['unchanged(a|a|a)', 'ours(b|Z|b)', 'unchanged(c|c|c)'])
check('theirs only', 'a\nb\nc', 'a\nb\nc', 'a\nZ\nc',
  ['unchanged(a|a|a)', 'theirs(b|b|Z)', 'unchanged(c|c|c)'])
check('both identical', 'a\nb\nc', 'a\nZ\nc', 'a\nZ\nc',
  ['unchanged(a|a|a)', 'both-same(b|Z|Z)', 'unchanged(c|c|c)'])
check('real conflict', 'a\nb\nc', 'a\nX\nc', 'a\nY\nc',
  ['unchanged(a|a|a)', 'conflict(b|X|Y)', 'unchanged(c|c|c)'])

// --- non-overlapping edits on both sides must BOTH auto-merge ---------------
check('disjoint edits', 'a\nb\nc\nd\ne', 'a\nB\nc\nd\ne', 'a\nb\nc\nD\ne',
  ['unchanged(a|a|a)', 'ours(b|B|b)', 'unchanged(c|c|c)', 'theirs(d|d|D)', 'unchanged(e|e|e)'])

// --- adjacent edits must merge into ONE conflict ----------------------------
check('adjacent edits', 'a\nb\nc\nd', 'a\nX\nY\nd', 'a\nP\nQ\nd',
  ['unchanged(a|a|a)', 'conflict(b/c|X/Y|P/Q)', 'unchanged(d|d|d)'])

// --- insertions / deletions -------------------------------------------------
check('ours inserts', 'a\nc', 'a\nb\nc', 'a\nc',
  ['unchanged(a|a|a)', 'ours(|b|)', 'unchanged(c|c|c)'])
check('ours deletes', 'a\nb\nc', 'a\nc', 'a\nb\nc',
  ['unchanged(a|a|a)', 'ours(b||b)', 'unchanged(c|c|c)'])
check('delete vs modify', 'a\nb\nc', 'a\nc', 'a\nB\nc',
  ['unchanged(a|a|a)', 'conflict(b||B)', 'unchanged(c|c|c)'])

// --- add/add (no base) ------------------------------------------------------
check('add/add', '', 'x', 'y', ['conflict(|x|y)'])

// --- offsets: an edit early must not misalign a later region ----------------
check('shifted offsets', 'a\nb\nc\nd\ne\nf',
                          'a\nb1\nb2\nb3\nc\nd\ne\nf',
                          'a\nb\nc\nd\ne\nF',
  ['unchanged(a|a|a)', 'ours(b|b1/b2/b3|b)', 'unchanged(c/d/e|c/d/e|c/d/e)', 'theirs(f|f|F)'])

// --- round-trip: auto-merged doc reassembles exactly ------------------------
{
  const base = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n'
  const ours = 'l1\nOURS\nl3\nl4\nl5\nl6\nl7\n'
  const theirs = 'l1\nl2\nl3\nl4\nTHEIRS\nl6\nl7\n'
  const chunks = buildMergeChunks(base.split('\n'), ours.split('\n'), theirs.split('\n'))
  const merged = chunks.flatMap(c => autoResolution(c) ?? ['<UNRESOLVED>']).join('\n')
  const expected = 'l1\nOURS\nl3\nl4\nTHEIRS\nl6\nl7\n'
  const ok = merged === expected
  console.log(ok ? '  ok  ' : ' FAIL ', 'clean auto-merge round-trips')
  if (!ok) console.log('    got', JSON.stringify(merged))
  ok ? pass++ : fail++
}

// --- trailing newline is preserved as data ---------------------------------
{
  const chunks = buildMergeChunks(['a',''], ['a',''], ['a',''])
  const out = chunks.flatMap(c => autoResolution(c) ?? []).join('\n')
  const ok = out === 'a\n'
  console.log(ok ? '  ok  ' : ' FAIL ', 'trailing newline round-trips')
  ok ? pass++ : fail++
}
{
  // "no newline at end" on one side only is a real difference, not noise
  const chunks = buildMergeChunks(['a',''], ['a'], ['a',''])
  const types = chunks.map(c => c.type)
  const ok = types.includes('ours')
  console.log(ok ? '  ok  ' : ' FAIL ', 'missing trailing newline is seen as a change')
  if (!ok) console.log('    got', JSON.stringify(types))
  ok ? pass++ : fail++
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
