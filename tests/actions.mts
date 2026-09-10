import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkoutBranch, createBranch, mergeRef, createCommit,
  abortMerge, isMerging, mergeMessage
} from '@main/git/actions.js'
import { getStatus } from '@main/git/status.js'
import { listConflicts, resolveConflict } from '@main/git/conflict.js'
import { getMergeDocument } from '@main/git/merge.js'
import { assembleMerge, type Resolution } from '@shared/merge.js'

let pass = 0, fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(cond ? '  ok  ' : ' FAIL ', label, extra)
  cond ? pass++ : fail++
}

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'act-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Test'); g('config', 'user.email', 't@t.t')
  // LF fixtures are compared byte-for-byte; Git for Windows would
  // otherwise rewrite them to CRLF on checkout.
  g('config', 'core.autocrlf', 'false')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nl2\nl3\n')
  g('add', '-A'); g('commit', '-qm', 'base')
  return cwd
}

// --- clean fast-forward merge ----------------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd: cwd, name: 'feature' })
  writeFileSync(join(cwd, 'g.txt'), 'new\n')
  execFileSync('git', ['add', '-A'], { cwd })
  const c = await createCommit({ cwd, message: 'add g' })
  ok('commit returns a hash', /^[0-9a-f]{40}$/.test(c.hash), c.shortHash)

  await checkoutBranch(cwd, 'main')
  const r = await mergeRef({ cwd, ref: 'feature' })
  ok('fast-forward merge reports merged', r.status === 'merged', r.status)
  ok('  and leaves no merge in progress', !(await isMerging(cwd)))
  rmSync(cwd, { recursive: true, force: true })
}

// --- --no-ff produces a merge commit ---------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd: cwd, name: 'feature' })
  writeFileSync(join(cwd, 'g.txt'), 'new\n')
  execFileSync('git', ['add', '-A'], { cwd })
  await createCommit({ cwd, message: 'add g' })
  await checkoutBranch(cwd, 'main')
  await mergeRef({ cwd, ref: 'feature', noFastForward: true })
  const parents = execFileSync('git', ['rev-list', '--parents', '-n1', 'HEAD'],
    { cwd, encoding: 'utf8' }).trim().split(' ')
  ok('--no-ff creates a merge commit', parents.length === 3, `${parents.length - 1} parents`)
  rmSync(cwd, { recursive: true, force: true })
}

// --- already up to date -----------------------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd: cwd, name: 'feature' })
  await checkoutBranch(cwd, 'main')
  const r = await mergeRef({ cwd, ref: 'feature' })
  ok('no-op merge reports up-to-date', r.status === 'up-to-date', r.status)
  rmSync(cwd, { recursive: true, force: true })
}

// --- conflicting merge is an outcome, not a throw ---------------------------
{
  const cwd = repo()
  await createBranch({ cwd: cwd, name: 'feature' })
  writeFileSync(join(cwd, 'f.txt'), 'l1\nFEATURE\nl3\n')
  execFileSync('git', ['add', '-A'], { cwd })
  await createCommit({ cwd, message: 'feature edit' })
  await checkoutBranch(cwd, 'main')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nMAIN\nl3\n')
  execFileSync('git', ['add', '-A'], { cwd })
  await createCommit({ cwd, message: 'main edit' })

  const r = await mergeRef({ cwd, ref: 'feature' })
  ok('conflicting merge reports conflicts', r.status === 'conflicts', r.status)
  ok('  merge is in progress', await isMerging(cwd))
  ok('  status sees the operation', (await getStatus(cwd)).operation === 'merge')
  ok('  conflicted path listed', (await listConflicts(cwd)).includes('f.txt'))

  const msg = await mergeMessage(cwd)
  ok('  MERGE_MSG prefill has no comment lines',
    msg !== null && !msg.includes('#') && msg.includes('feature'), JSON.stringify(msg))

  // resolve through the merge editor path, then commit
  const doc = await getMergeDocument(cwd, 'f.txt')
  const res: Record<number, Resolution> = {}
  for (const c of doc.chunks) if (c.type === 'conflict') res[c.id] = { kind: 'ours' }
  await resolveConflict(cwd, 'f.txt', assembleMerge(doc.chunks, res)!)
  const commit = await createCommit({ cwd, message: msg ?? 'merge' })
  ok('  merge commits after resolving', /^[0-9a-f]{40}$/.test(commit.hash))
  const parents = execFileSync('git', ['rev-list', '--parents', '-n1', 'HEAD'],
    { cwd, encoding: 'utf8' }).trim().split(' ')
  ok('  result is a real merge commit', parents.length === 3, `${parents.length - 1} parents`)
  ok('  no merge left in progress', !(await isMerging(cwd)))
  rmSync(cwd, { recursive: true, force: true })
}

// --- abort restores the pre-merge state -------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd: cwd, name: 'feature' })
  writeFileSync(join(cwd, 'f.txt'), 'l1\nFEATURE\nl3\n')
  execFileSync('git', ['add', '-A'], { cwd }); await createCommit({ cwd, message: 'f' })
  await checkoutBranch(cwd, 'main')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nMAIN\nl3\n')
  execFileSync('git', ['add', '-A'], { cwd }); await createCommit({ cwd, message: 'm' })
  await mergeRef({ cwd, ref: 'feature' })
  await abortMerge(cwd)
  ok('abort clears the merge', !(await isMerging(cwd)))
  const st = await getStatus(cwd)
  ok('  worktree is clean again', st.files.length === 0 && st.operation === 'none')
  rmSync(cwd, { recursive: true, force: true })
}

// --- failures that must stay failures ---------------------------------------
{
  const cwd = repo()
  let threw = false
  try { await mergeRef({ cwd, ref: 'no-such-branch' }) } catch { threw = true }
  ok('unknown ref throws', threw)
  ok('  and starts no merge', !(await isMerging(cwd)))

  threw = false
  try { await createCommit({ cwd, message: '   ' }) } catch { threw = true }
  ok('empty message throws', threw)
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
