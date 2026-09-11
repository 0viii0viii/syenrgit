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

// --- when the graph is drawn, and when it is not --------------------------
{
  const { buildGraph, graphWidth } = await import('@main/git/graph.js')
  const { fitLanes } = await import('@shared/graphLayout.js')

  // The tokens the renderer measures, as authored in git.css.
  const METRICS = { row: 28, lane: 14, node: 8, stroke: 2, maxWidth: 176 }

  // Ordinary history truncated mid-walk: every branch still being walked
  // leaves a commit whose parent is not loaded. That is a frontier, not a
  // hole, and the graph must survive it — a repository with thirty open
  // branches once lost its graph entirely to this.
  const many = mkdtempSync(join(tmpdir(), 'branches-'))
  execFileSync('git', ['init', '-q', '-b', 'main', many])
  // Commits get increasing dates: with identical timestamps git's date-ordered
  // walk breaks ties arbitrarily, and which branch tips land inside a truncated
  // window becomes a coin flip.
  let clock = 1700000000
  const gm = (...a: string[]) =>
    execFileSync('git', a, {
      cwd: many,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `${(clock += 60)} +0000`,
        GIT_COMMITTER_DATE: `${clock} +0000`
      }
    })
  gm('config', 'user.name', 'T'); gm('config', 'user.email', 't@t.t')
  gm('config', 'core.autocrlf', 'false')
  writeFileSync(join(many, 'seed.txt'), 'x\n'); gm('add', '-A'); gm('commit', '-qm', 'root')
  for (let i = 0; i < 60; i++) {
    writeFileSync(join(many, `f${i % 5}.txt`), `${i}\n`)
    gm('add', '-A'); gm('commit', '-qm', `trunk ${i}`)
    if (i % 6 === 0) gm('branch', `wip/${i}`)
  }
  for (let i = 0; i < 60; i += 6) {
    gm('checkout', '-q', `wip/${i}`)
    for (let j = 0; j < 4; j++) {
      writeFileSync(join(many, `w${i}_${j}.txt`), 'x\n')
      gm('add', '-A'); gm('commit', '-qm', `wip ${i}.${j}`)
    }
  }
  gm('checkout', '-q', 'main')

  const truncated = await getLog({ cwd: many, limit: 40 })
  const present = new Set(truncated.map(c => c.hash))
  const lastIndex = truncated.length - 1
  const midFrontier = truncated.filter(
    (c, i) => i !== lastIndex && c.parents.some(p => !present.has(p))
  ).length
  ok('a truncated walk leaves commits with unloaded parents above the last row',
    midFrontier > 0, `${midFrontier} of ${truncated.length}`)
  ok('  and its graph is still drawn', graphWidth(buildGraph(truncated)) > 0,
    `${graphWidth(buildGraph(truncated))} lanes`)
  rmSync(many, { recursive: true, force: true })

  // A search, by contrast, opens a lane per match: the parents are missing
  // because they did not match, not because the walk stopped.
  const wide = mkdtempSync(join(tmpdir(), 'wide-'))
  execFileSync('git', ['init', '-q', '-b', 'main', wide])
  const authors = ['Ada', 'Grace', 'Alan']
  for (let i = 0; i < 90; i++) {
    writeFileSync(join(wide, `f${i % 5}.txt`), `${i}\n`)
    execFileSync('git', ['add', '-A'], { cwd: wide })
    const who = authors[i % 3]
    execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${who}@x.com`,
      'commit', '-qm', `commit ${i}`], { cwd: wide })
  }
  const everything = await getLog({ cwd: wide })
  ok('unfiltered history stays one lane', graphWidth(buildGraph(everything)) === 1,
    String(graphWidth(buildGraph(everything))))

  const scattered = await getLog({ cwd: wide, search: { author: 'Grace' } })
  ok('a scattered search matches many commits', scattered.length === 30, String(scattered.length))
  ok('  and would open a lane per commit, which is why a search draws none',
    graphWidth(buildGraph(scattered)) > 20,
    `${graphWidth(buildGraph(scattered))} lanes`)
  rmSync(wide, { recursive: true, force: true })

  // Whatever the lane count, the column stays inside its budget: that, not
  // hiding the graph, is what keeps the commit subjects on screen.
  for (const lanes of [0, 1, 3, 12, 31, 200]) {
    const fit = fitLanes(METRICS, lanes)
    ok(`  ${lanes} lanes fit the column budget`,
      fit.width <= METRICS.maxWidth + 0.001,
      `${fit.width.toFixed(1)}px of ${METRICS.maxWidth}px`)
    ok(`  ${lanes} lanes keep a visible node inside its lane`,
      fit.node >= 3 && fit.node <= fit.lane,
      `node ${fit.node.toFixed(1)}px in a ${fit.lane.toFixed(1)}px lane`)
    ok(`  ${lanes} lanes stay legible or are clipped, never smeared`,
      fit.lane >= 4 && fit.visibleLanes >= 1,
      `${fit.lane.toFixed(1)}px lanes, ${fit.visibleLanes} of ${lanes} shown`)
  }
  ok('  an ordinary graph is untouched by the budget',
    fitLanes(METRICS, 3).lane === METRICS.lane && fitLanes(METRICS, 3).node === METRICS.node,
    `${fitLanes(METRICS, 3).lane}px lanes`)
}

rmSync(cwd, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
