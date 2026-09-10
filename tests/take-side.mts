import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeSide, listConflicts } from '@main/git/conflict.js'
import { getMergeDocument } from '@main/git/merge.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

function conflicted(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ts-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  // LF fixtures are compared byte-for-byte; Git for Windows would
  // otherwise rewrite them to CRLF on checkout.
  g('config', 'core.autocrlf', 'false')
  writeFileSync(join(cwd, 'delbyus.txt'), 'base\n')
  writeFileSync(join(cwd, 'delbythem.txt'), 'base\n')
  writeFileSync(join(cwd, 'both.txt'), 'base\n')
  g('add', '-A'); g('commit', '-qm', 'base')
  g('checkout', '-q', '-b', 'other')
  writeFileSync(join(cwd, 'delbyus.txt'), 'their edit\n')
  rmSync(join(cwd, 'delbythem.txt'))
  writeFileSync(join(cwd, 'both.txt'), 'their edit\n')
  g('add', '-A'); g('commit', '-qm', 'other')
  g('checkout', '-q', 'main')
  rmSync(join(cwd, 'delbyus.txt'))
  writeFileSync(join(cwd, 'delbythem.txt'), 'our edit\n')
  writeFileSync(join(cwd, 'both.txt'), 'our edit\n')
  g('add', '-A'); g('commit', '-qm', 'main')
  try { g('merge', 'other') } catch { /* conflicts are the point */ }
  return cwd
}

{
  const cwd = conflicted()
  console.log('  kinds:', (await Promise.all((await listConflicts(cwd))
    .map(async p => `${p}=${(await getMergeDocument(cwd, p)).kind}`))).join(' '))

  // We deleted it; taking "ours" means the deletion stands.
  await takeSide(cwd, 'delbyus.txt', 'ours')
  ok('deleted-by-us + ours removes the file', !existsSync(join(cwd, 'delbyus.txt')))

  // They deleted it; taking "theirs" means the deletion stands.
  await takeSide(cwd, 'delbythem.txt', 'theirs')
  ok('deleted-by-them + theirs removes the file', !existsSync(join(cwd, 'delbythem.txt')))

  await takeSide(cwd, 'both.txt', 'theirs')
  ok('content conflict + theirs keeps their text',
    execFileSync('git', ['show', ':0:both.txt'], { cwd, encoding: 'utf8' }) === 'their edit\n')

  ok('no conflicts remain', (await listConflicts(cwd)).length === 0)
  execFileSync('git', ['commit', '-qm', 'merged'], { cwd })
  const parents = execFileSync('git', ['rev-list', '--parents', '-n1', 'HEAD'], { cwd, encoding: 'utf8' }).trim().split(' ')
  ok('merge commits cleanly', parents.length === 3)
  rmSync(cwd, { recursive: true, force: true })
}

{
  // The other direction: keeping the side that still has content.
  const cwd = conflicted()
  await takeSide(cwd, 'delbyus.txt', 'theirs')
  ok('deleted-by-us + theirs restores their file', existsSync(join(cwd, 'delbyus.txt')))
  await takeSide(cwd, 'delbythem.txt', 'ours')
  ok('deleted-by-them + ours keeps our file', existsSync(join(cwd, 'delbythem.txt')))
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
