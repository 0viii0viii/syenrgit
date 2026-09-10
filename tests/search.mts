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

rmSync(cwd, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
