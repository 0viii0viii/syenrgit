import { parseQuery } from '@/features/history/parse-query'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }
const eq = (l: string, got: unknown, want: unknown) =>
  ok(l, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))

eq('plain words become a message search', parseQuery('fix the login'), { message: 'fix the login' })
eq('author: is extracted', parseQuery('author:ada'), { author: 'ada' })
eq('by: is an alias', parseQuery('by:grace'), { author: 'grace' })
eq('author and message combine',
  parseQuery('author:ada refresh tokens'), { author: 'ada', message: 'refresh tokens' })
eq('a bare hash is treated as an id', parseQuery('9af58ad'), { hash: '9af58ad' })
eq('a full hash too',
  parseQuery('9af58ad9af58ad9af58ad9af58ad9af58ad9af58'),
  { hash: '9af58ad9af58ad9af58ad9af58ad9af58ad9af58' })
eq('hash: is explicit', parseQuery('hash:abc1234'), { hash: 'abc1234' })
eq('commit: is an alias', parseQuery('commit:abc1234'), { hash: 'abc1234' })
// A hex-looking word alongside others is a message search, not an id.
eq('a hash-like word with others stays a message',
  parseQuery('deadbeef in the parser'), { message: 'deadbeef in the parser' })
eq('short hex is a message, not an id', parseQuery('abc'), { message: 'abc' })
eq('an empty query searches nothing', parseQuery('   '), {})
eq('a bare prefix with no value is ignored', parseQuery('author:'), {})
eq('extra whitespace is harmless',
  parseQuery('  author:ada   fix   login  '), { author: 'ada', message: 'fix login' })
eq('case in the prefix does not matter', parseQuery('Author:Ada'), { author: 'Ada' })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
