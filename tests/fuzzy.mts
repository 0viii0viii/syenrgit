import { matchesRef, refMatchScore } from '@/lib/fuzzy'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

ok('an empty query matches everything', matchesRef('anything', ''))
ok('a substring matches', matchesRef('feature/auth', 'auth'))
ok('  case-insensitively', matchesRef('Feature/Auth', 'AUTH'))
ok('a subsequence matches', matchesRef('feature/auth', 'fa'))
ok('  across separators', matchesRef('hotfix/login-crash', 'hlc'))
ok('a character that is not there at all fails', !matchesRef('feature/auth', 'htx'))
ok('a character that is absent does not match', !matchesRef('main', 'z'))
ok('order matters', !matchesRef('abc', 'cba'))
ok('spaces in a query are ignored', matchesRef('feature/auth', 'f a'))

// Ranking: exact, then prefix, then segment prefix, then substring.
const rank = (name: string, q: string) => refMatchScore(name, q)
ok('an exact name ranks first', rank('main', 'main') === 0)
ok('a prefix beats a segment prefix', rank('mainline', 'main') < rank('feature/main', 'main'))
ok('a segment prefix beats a bare substring',
  rank('feature/auth', 'auth') < rank('reauthorize', 'auth'),
  `${rank('feature/auth', 'auth')} vs ${rank('reauthorize', 'auth')}`)
ok('an earlier substring outranks a later one',
  rank('xauth', 'auth') < rank('xxxxxauth', 'auth'))
ok('a non-match ranks last', rank('nothing', 'zzz') === 100)

// Ordering a realistic list.
{
  const names = ['feature/auth', 'main', 'hotfix/auth-crash', 'reauthorize', 'develop']
  const sorted = names
    .filter((n) => matchesRef(n, 'auth'))
    .sort((a, b) => refMatchScore(a, 'auth') - refMatchScore(b, 'auth'))
  ok('a realistic list sorts sensibly',
    sorted[0] === 'feature/auth' || sorted[0] === 'hotfix/auth-crash',
    JSON.stringify(sorted))
  ok('  and excludes non-matches', !sorted.includes('main') && !sorted.includes('develop'),
    JSON.stringify(sorted))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
