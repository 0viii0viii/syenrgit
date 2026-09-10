import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rebaseOnto, rebaseStep, rebaseProgress } from '@main/git/rebase.js'
import { getStatus } from '@main/git/status.js'
import { listConflicts, resolveConflict } from '@main/git/conflict.js'
import { getMergeDocument } from '@main/git/merge.js'
import { conflictLabels } from '@main/git/repo.js'
import { assembleMerge, type Resolution } from '@shared/merge.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

/** main: A B C ; feature branched at A with F1 F2 (F1 touches the same line as B) */
function repo(conflict: boolean): string {
  const cwd = mkdtempSync(join(tmpdir(), 'rb-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nl2\nl3\n'); g('add', '-A'); g('commit', '-qm', 'A')
  g('checkout', '-q', '-b', 'feature')
  writeFileSync(join(cwd, conflict ? 'f.txt' : 'g.txt'), conflict ? 'l1\nFEATURE\nl3\n' : 'g\n')
  g('add', '-A'); g('commit', '-qm', 'F1')
  writeFileSync(join(cwd, 'h.txt'), 'h\n'); g('add', '-A'); g('commit', '-qm', 'F2')
  g('checkout', '-q', 'main')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nMAIN\nl3\n'); g('add', '-A'); g('commit', '-qm', 'B')
  g('checkout', '-q', 'feature')
  return cwd
}

{
  const cwd = repo(false)
  const r = await rebaseOnto({ cwd, onto: 'main' })
  ok('clean rebase succeeds', r.status === 'rebased', r.status)
  const log = execFileSync('git', ['log', '--format=%s', '-4'], { cwd, encoding: 'utf8' }).trim().split('\n')
  ok('  history is replayed onto main', JSON.stringify(log) === JSON.stringify(['F2','F1','B','A']), JSON.stringify(log))
  ok('  nothing in progress', (await getStatus(cwd)).operation === 'none')
  rmSync(cwd, { recursive: true, force: true })
}

{
  const cwd = repo(true)
  const r = await rebaseOnto({ cwd, onto: 'main' })
  ok('conflicting rebase reports conflicts', r.status === 'conflicts', r.status)
  ok('  status sees a rebase', (await getStatus(cwd)).operation.startsWith('rebase'))
  ok('  conflicted path listed', (await listConflicts(cwd)).includes('f.txt'))

  const p = await rebaseProgress(cwd)
  ok('  progress is reported', p !== null && p.total >= 1, JSON.stringify(p))

  // Sides are swapped during a rebase: "ours" is the upstream being replayed onto.
  const labels = await conflictLabels(cwd)
  ok('  labels reflect rebase direction',
    /upstream/.test(labels.ours) && labels.theirs === 'feature', JSON.stringify(labels))

  const doc = await getMergeDocument(cwd, 'f.txt')
  const res: Record<number, Resolution> = {}
  for (const c of doc.chunks) if (c.type === 'conflict') res[c.id] = { kind: 'theirs' }
  await resolveConflict(cwd, 'f.txt', assembleMerge(doc.chunks, res)!)

  const cont = await rebaseStep(cwd, 'continue')
  ok('continue finishes the rebase', cont.status === 'rebased', `${cont.status}: ${cont.message}`)
  const log = execFileSync('git', ['log', '--format=%s', '-4'], { cwd, encoding: 'utf8' }).trim().split('\n')
  ok('  replayed on top of main', JSON.stringify(log) === JSON.stringify(['F2','F1','B','A']), JSON.stringify(log))
  rmSync(cwd, { recursive: true, force: true })
}

{
  const cwd = repo(true)
  await rebaseOnto({ cwd, onto: 'main' })
  const s = await rebaseStep(cwd, 'skip')
  ok('skip drops the conflicting commit', s.status === 'rebased', `${s.status}: ${s.message}`)
  const log = execFileSync('git', ['log', '--format=%s', '-3'], { cwd, encoding: 'utf8' }).trim().split('\n')
  ok('  F1 is gone, F2 replayed', JSON.stringify(log) === JSON.stringify(['F2','B','A']), JSON.stringify(log))
  rmSync(cwd, { recursive: true, force: true })
}

{
  const cwd = repo(true)
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  await rebaseOnto({ cwd, onto: 'main' })
  const a = await rebaseStep(cwd, 'abort')
  ok('abort restores the branch', a.status === 'rebased', a.message)
  ok('  HEAD is back where it was',
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim() === before)
  ok('  nothing in progress', (await getStatus(cwd)).operation === 'none')
  rmSync(cwd, { recursive: true, force: true })
}

{
  const cwd = repo(false)
  let threw = false
  try { await rebaseOnto({ cwd, onto: 'nope' }) } catch { threw = true }
  ok('unknown ref throws', threw)
  ok('  and starts nothing', (await getStatus(cwd)).operation === 'none')
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
