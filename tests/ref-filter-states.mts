import { matchesRef, refMatchScore } from '@/lib/fuzzy'

/**
 * The filter's empty state is a UI concern, but the condition that produced it
 * is not: a query matching nothing empties every section at once, and the
 * component then has to keep its own input on screen. This pins the condition
 * so the shape of the bug stays visible.
 */
let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

const refs = ['main', 'develop', 'feature/auth', 'feature/search', 'hotfix/login-crash']
const tags = ['v1.0.0', 'v1.1.0']
const stashes = ['WIP on main: something']

const survives = (query: string): number =>
  [...refs, ...tags, ...stashes].filter((r) => matchesRef(r, query)).length

ok('an empty query keeps everything', survives('') === refs.length + tags.length + stashes.length)
ok('a matching query keeps a subset', survives('auth') > 0 && survives('auth') < refs.length)

// The state that stranded the user: nothing left in any section.
ok('a query matching nothing empties the tree', survives('zzzznomatch') === 0)
ok('  which is reachable by typing normal characters', survives('qqq') === 0)

// Ranking must not throw on a non-match, since it runs over the filtered list.
ok('ranking a non-match is defined', refMatchScore('main', 'zzz') === 100)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
