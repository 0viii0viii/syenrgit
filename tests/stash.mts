import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stashPush, stashApply, stashDrop } from '@main/git/stash.js'
import { listStashes } from '@main/git/refs.js'
import { getStatus } from '@main/git/status.js'
import { listConflicts } from '@main/git/conflict.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'st-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'f.txt'), 'base\n')
  g('add', '-A'); g('commit', '-qm', 'base')
  return cwd
}

{
  const cwd = repo()
  ok('nothing to stash is reported, not thrown',
    (await stashPush({ cwd })).status === 'nothing-to-stash')

  writeFileSync(join(cwd, 'f.txt'), 'edited\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'new file\n')

  const r = await stashPush({ cwd, message: 'my work' })
  ok('stash push', r.status === 'stashed', r.message)
  ok('  worktree is clean of tracked edits',
    readFileSync(join(cwd, 'f.txt'), 'utf8') === 'base\n')
  ok('  untracked file is left behind by default', existsSync(join(cwd, 'untracked.txt')))
  ok('  stash is listed with its message',
    (await listStashes(cwd))[0]?.message.includes('my work') === true)

  const a = await stashApply({ cwd, ref: 'stash@{0}' })
  ok('apply restores the edit',
    a.status === 'applied' && readFileSync(join(cwd, 'f.txt'), 'utf8') === 'edited\n')
  ok('  and keeps the stash', (await listStashes(cwd)).length === 1)

  execFileSync('git', ['checkout', '--', 'f.txt'], { cwd })
  const p = await stashApply({ cwd, ref: 'stash@{0}', pop: true })
  ok('pop applies and drops',
    p.status === 'applied' && (await listStashes(cwd)).length === 0, p.message)
  rmSync(cwd, { recursive: true, force: true })
}

{
  const cwd = repo()
  writeFileSync(join(cwd, 'f.txt'), 'edited\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'new\n')
  await stashPush({ cwd, includeUntracked: true })
  ok('--include-untracked takes the untracked file too',
    !existsSync(join(cwd, 'untracked.txt')))
  await stashApply({ cwd, ref: 'stash@{0}', pop: true })
  ok('  and brings it back', existsSync(join(cwd, 'untracked.txt')))
  rmSync(cwd, { recursive: true, force: true })
}

{
  // A stash that cannot apply cleanly must report conflicts, not throw.
  const cwd = repo()
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, 'f.txt'), 'stashed edit\n')
  await stashPush({ cwd, message: 'conflicting' })
  writeFileSync(join(cwd, 'f.txt'), 'committed edit\n')
  g('add', '-A'); g('commit', '-qm', 'diverge')

  const c = await stashApply({ cwd, ref: 'stash@{0}' })
  ok('conflicting apply reports conflicts', c.status === 'conflicts', c.message)
  ok('  conflicted path is unmerged', (await listConflicts(cwd)).includes('f.txt'))
  ok('  the stash is kept', (await listStashes(cwd)).length === 1)
  // git leaves no MERGE_HEAD for a stash apply, so the repo reports no operation
  ok('  no operation in progress (stash quirk)',
    (await getStatus(cwd)).operation === 'none')

  // An unmerged path needs a hard reset; plain checkout refuses.
  g('reset', '-q', '--hard', 'HEAD')
  const d = await stashDrop(cwd, 'stash@{0}')
  ok('drop removes it', (await listStashes(cwd)).length === 0, d)
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
