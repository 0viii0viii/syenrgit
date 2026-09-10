import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTodo, renderTodo, validateTodo, runInteractiveRebase } from '@main/git/interactive.js'
import { rebaseStep } from '@main/git/rebase.js'
import { getStatus } from '@main/git/status.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

/** base A, then C1 C2 C3 on top, each touching its own file. */
function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ir-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'base.txt'), 'base\n'); g('add', '-A'); g('commit', '-qm', 'A')
  for (const n of ['C1', 'C2', 'C3']) {
    writeFileSync(join(cwd, `${n}.txt`), `${n}\n`); g('add', '-A'); g('commit', '-qm', n)
  }
  return cwd
}
const log = (cwd: string, n = 6) =>
  execFileSync('git', ['log', '--format=%s', `-${n}`], { cwd, encoding: 'utf8' }).trim().split('\n')

// --- todo construction ------------------------------------------------------
{
  const cwd = repo()
  const todo = await buildTodo(cwd, 'HEAD~3')
  ok('todo is oldest-first', JSON.stringify(todo.map(t => t.subject)) === JSON.stringify(['C1','C2','C3']),
     JSON.stringify(todo.map(t => t.subject)))
  ok('  every entry defaults to pick', todo.every(t => t.action === 'pick'))
  ok('  render skips dropped entries',
    renderTodo([{ ...todo[0]!, action: 'drop' }, todo[1]!]).split('\n').filter(Boolean).length === 1)
  ok('  an all-dropped plan renders noop',
    renderTodo(todo.map(t => ({ ...t, action: 'drop' as const }))).trim() === 'noop')
  ok('  squash first is rejected',
    validateTodo([{ ...todo[0]!, action: 'squash' }, todo[1]!]) !== null)
  ok('  pick first is fine', validateTodo(todo) === null)
  rmSync(cwd, { recursive: true, force: true })
}

// --- reorder ----------------------------------------------------------------
{
  const cwd = repo()
  const todo = await buildTodo(cwd, 'HEAD~3')
  const reordered = [todo[2]!, todo[0]!, todo[1]!]   // C3 C1 C2
  const r = await runInteractiveRebase(cwd, 'HEAD~3', reordered)
  ok('reorder succeeds', r.status === 'rebased', r.message)
  ok('  history follows the plan',
    JSON.stringify(log(cwd, 4)) === JSON.stringify(['C2','C1','C3','A']), JSON.stringify(log(cwd, 4)))
  rmSync(cwd, { recursive: true, force: true })
}

// --- drop -------------------------------------------------------------------
{
  const cwd = repo()
  const todo = await buildTodo(cwd, 'HEAD~3')
  const r = await runInteractiveRebase(cwd, 'HEAD~3',
    todo.map(t => t.subject === 'C2' ? { ...t, action: 'drop' as const } : t))
  ok('drop removes the commit', r.status === 'rebased', r.message)
  ok('  C2 is gone', JSON.stringify(log(cwd, 3)) === JSON.stringify(['C3','C1','A']), JSON.stringify(log(cwd, 3)))
  rmSync(cwd, { recursive: true, force: true })
}

// --- squash and fixup -------------------------------------------------------
{
  const cwd = repo()
  const todo = await buildTodo(cwd, 'HEAD~3')
  const r = await runInteractiveRebase(cwd, 'HEAD~3',
    [todo[0]!, { ...todo[1]!, action: 'squash' }, { ...todo[2]!, action: 'fixup' }])
  ok('squash + fixup collapse into one commit', r.status === 'rebased', r.message)
  ok('  only two commits remain',
    JSON.stringify(log(cwd, 5)) === JSON.stringify(['C1','A']), JSON.stringify(log(cwd, 5)))
  const body = execFileSync('git', ['log', '--format=%B', '-1'], { cwd, encoding: 'utf8' })
  ok('  squashed message keeps both subjects', body.includes('C1') && body.includes('C2'), JSON.stringify(body.trim()))
  ok('  fixup message is discarded', !body.includes('C3'))
  ok('  all three files survive',
    execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' }).trim().split('\n').length === 4)
  rmSync(cwd, { recursive: true, force: true })
}

// --- edit stops the rebase --------------------------------------------------
{
  const cwd = repo()
  const todo = await buildTodo(cwd, 'HEAD~3')
  const r = await runInteractiveRebase(cwd, 'HEAD~3',
    todo.map(t => t.subject === 'C2' ? { ...t, action: 'edit' as const } : t))
  ok('edit stops the rebase', r.status === 'stopped', `${r.status}: ${r.message}`)
  ok('  status reports a rebase', (await getStatus(cwd)).operation === 'rebase')
  const cont = await rebaseStep(cwd, 'continue')
  ok('  continue finishes it', cont.status === 'rebased', cont.message)
  ok('  history is intact',
    JSON.stringify(log(cwd, 4)) === JSON.stringify(['C3','C2','C1','A']), JSON.stringify(log(cwd, 4)))
  rmSync(cwd, { recursive: true, force: true })
}

// --- reorder that conflicts --------------------------------------------------
{
  const cwd = mkdtempSync(join(tmpdir(), 'irc-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nl2\nl3\n'); g('add', '-A'); g('commit', '-qm', 'A')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nX\nl3\n'); g('add', '-A'); g('commit', '-qm', 'X')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nY\nl3\n'); g('add', '-A'); g('commit', '-qm', 'Y')
  const todo = await buildTodo(cwd, 'HEAD~2')
  const r = await runInteractiveRebase(cwd, 'HEAD~2', [todo[1]!, todo[0]!])
  ok('a conflicting reorder is reported, not thrown', r.status === 'conflicts', `${r.status}: ${r.message}`)
  ok('  rebase is in progress', (await getStatus(cwd)).operation === 'rebase')
  await rebaseStep(cwd, 'abort')
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
