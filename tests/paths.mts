import { samePath } from '@shared/paths'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

// The reason this module exists: git and Node spell the same path differently.
ok('forward and back slashes are the same path',
  samePath('C:/Users/x/repo/.git', 'C:\\Users\\x\\repo\\.git'))
ok('case is ignored on a Windows path',
  samePath('C:/Users/X/Repo', 'c:\\users\\x\\repo'))
ok('a trailing slash is ignored', samePath('/a/b/', '/a/b'))
ok('different paths stay different', !samePath('/a/b', '/a/c'))

// Case must NOT be ignored on POSIX, where these are two directories.
ok('case still matters on a POSIX path', !samePath('/tmp/A', '/tmp/a'))
ok('  even with a trailing slash', !samePath('/tmp/A/', '/tmp/a'))

// The bug this replaced: reading process.platform threw in the renderer,
// where process does not exist. Nothing here may touch it.
ok('the module never reads process',
  !/process\s*\./.test(
    (await import('node:fs')).readFileSync('src/shared/paths.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  ))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
