import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLog } from '@main/git/log.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

/** Commits by two authors, plus one buried far enough to fall off a page. */
function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'search-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Ada Lovelace'); g('config', 'user.email', 'ada@example.com')
  // LF fixtures are compared byte-for-byte; Git for Windows would
  // otherwise rewrite them to CRLF on checkout.
  g('config', 'core.autocrlf', 'false')

  writeFileSync(join(cwd, 'f.txt'), 'seed\n')
  g('add', '-A'); g('commit', '-qm', 'Deeply buried treasure')

  for (let i = 0; i < 30; i++) {
    writeFileSync(join(cwd, `n${i}.txt`), `${i}\n`)
    g('add', '-A')
    const grace = i % 3 === 0
    if (grace) { g('config', 'user.name', 'Grace Hopper'); g('config', 'user.email', 'grace@example.com') }
    else { g('config', 'user.name', 'Ada Lovelace'); g('config', 'user.email', 'ada@example.com') }
    g('commit', '-qm', i === 15 ? 'Fix the [regex] problem (100%)' : `routine change ${i}`)
  }
  return cwd
}

const cwd = repo()
const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

// --- message ---------------------------------------------------------------
{
  const hits = await getLog({ cwd, search: { message: 'routine' } })
  ok('message search finds the matching commits', hits.length === 29, String(hits.length))
  ok('  and nothing else', hits.every(c => c.subject.includes('routine')))

  const caseless = await getLog({ cwd, search: { message: 'ROUTINE CHANGE 4' } })
  ok('message search ignores case', caseless.length === 1, String(caseless.length))

  // A message full of regex punctuation must be matched literally.
  const literal = await getLog({ cwd, search: { message: '[regex] problem (100%)' } })
  ok('message search treats the query literally, not as a regex',
    literal.length === 1 && literal[0]!.subject.includes('[regex]'),
    String(literal.length))

  ok('a message that matches nothing returns nothing',
    (await getLog({ cwd, search: { message: 'no such commit anywhere' } })).length === 0)
}

// --- author ----------------------------------------------------------------
{
  const grace = await getLog({ cwd, search: { author: 'Grace' } })
  ok('author search finds one author', grace.length === 10, String(grace.length))
  ok('  and only that author', grace.every(c => c.authorName === 'Grace Hopper'))

  const byEmail = await getLog({ cwd, search: { author: 'ada@example.com' } })
  ok('author search matches on email too', byEmail.length === 21, String(byEmail.length))

  const caseless = await getLog({ cwd, search: { author: 'grace hopper' } })
  ok('author search ignores case', caseless.length === 10, String(caseless.length))
}

// --- combined ---------------------------------------------------------------
{
  // Grace authored 10 commits, but one of them is the [regex] message rather
  // than a routine one — so the intersection is 9, not 10.
  const both = await getLog({ cwd, search: { message: 'routine', author: 'Grace' } })
  ok('message and author narrow together',
    both.length === 9 && both.every(c => c.authorName === 'Grace Hopper'), String(both.length))
  ok('  the intersection is smaller than either alone',
    both.length < (await getLog({ cwd, search: { author: 'Grace' } })).length)
}

// --- hash -------------------------------------------------------------------
{
  const target = g('rev-parse', 'HEAD~5')
  const full = await getLog({ cwd, search: { hash: target } })
  ok('a full hash finds its commit', full.length === 1 && full[0]!.hash === target)

  const short = await getLog({ cwd, search: { hash: target.slice(0, 7) } })
  ok('  an abbreviated one works too', short.length === 1 && short[0]!.hash === target)

  ok('a hash that is not a commit finds nothing',
    (await getLog({ cwd, search: { hash: 'deadbeef' } })).length === 0)
  ok('  and neither does something that is not a hash',
    (await getLog({ cwd, search: { hash: 'not-a-hash' } })).length === 0)

  // A tree id is a valid object but not a commit; the walk cannot use it.
  const tree = g('rev-parse', 'HEAD^{tree}')
  ok('a tree id is rejected rather than returned',
    (await getLog({ cwd, search: { hash: tree } })).length === 0)
}

// --- searching must reach past the page the UI has loaded --------------------
{
  // The oldest commit is beyond a 5-commit page, which is what a client-side
  // filter over the loaded list could never find.
  const page = await getLog({ cwd, limit: 5 })
  ok('setup: the target is outside the loaded page',
    !page.some(c => c.subject === 'Deeply buried treasure'), String(page.length))

  const found = await getLog({ cwd, limit: 5, search: { message: 'buried treasure' } })
  ok('search reaches commits the current page does not hold',
    found.length === 1 && found[0]!.subject === 'Deeply buried treasure',
    String(found.length))
}

// --- an unborn repository has no history, which is not an error ------------
{
  const fresh = mkdtempSync(join(tmpdir(), 'unborn-'))
  execFileSync('git', ['init', '-q', '-b', 'main', fresh])

  ok('a repository with no commits returns an empty log',
    (await getLog({ cwd: fresh })).length === 0)
  ok('  and an empty search result', (await getLog({ cwd: fresh, search: { message: 'x' } })).length === 0)
  ok('  and an empty hash lookup', (await getLog({ cwd: fresh, search: { hash: 'abc1234' } })).length === 0)

  // The first commit must appear immediately after it is made.
  writeFileSync(join(fresh, 'f.txt'), 'first\n')
  execFileSync('git', ['add', '-A'], { cwd: fresh })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.t',
    'commit', '-qm', 'the very first commit'], { cwd: fresh })
  ok('the first commit shows up', (await getLog({ cwd: fresh })).length === 1)
  rmSync(fresh, { recursive: true, force: true })
}

// --- queries that could be mistaken for options or patterns -----------------
{
  for (const [label, query] of [
    ['a leading dash', '--not-an-option'],
    ['a short flag', '-x'],
    ['quotes', '"quotes"'],
    ['a dollar sign', '$dollar'],
    ['a glob', '*'],
    ['a range', '..']
  ] as const) {
    let threw = false
    try { await getLog({ cwd, search: { message: query } }) } catch { threw = true }
    ok(`${label} is searched, not interpreted`, !threw, query)
  }
}

// --- a search result must not claim to be a graph ---------------------------
{
  const { buildGraph, graphWidth, isContiguousHistory } = await import('@main/git/graph.js')

  const all = await getLog({ cwd })
  ok('ordinary history is contiguous', isContiguousHistory(all))
  ok('  and its graph is narrow', graphWidth(buildGraph(all)) <= 2,
    String(graphWidth(buildGraph(all))))

  const matched = await getLog({ cwd, search: { author: 'Grace' } })
  ok('a search result is not contiguous', !isContiguousHistory(matched))

  // The tell: with parents missing, lanes open and never close, so the graph
  // grows a column per hole.
  const holes = new Set(matched.map(c => c.hash))
  const missing = matched
    .slice(0, -1)
    .reduce((n, c) => n + c.parents.filter(p => !holes.has(p)).length, 0)
  ok('  because its parents are mostly absent', missing > 0, `${missing} missing`)
  ok('  and drawing it would invent lanes',
    graphWidth(buildGraph(matched)) > graphWidth(buildGraph(all)),
    `${graphWidth(buildGraph(matched))} vs ${graphWidth(buildGraph(all))}`)

  // A single commit, and an empty result, are trivially fine.
  ok('one commit is contiguous', isContiguousHistory(all.slice(0, 1)))
  ok('no commits is contiguous', isContiguousHistory([]))

  // The last commit's parents are always beyond the walk, and that is not a
  // hole — otherwise every page of ordinary history would be rejected.
  ok('a truncated page is still contiguous',
    isContiguousHistory(await getLog({ cwd, limit: 5 })))
}

rmSync(cwd, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
