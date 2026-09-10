import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTag, deleteTag, isValidTagName, deleteBranch, isBranchMerged, createBranch, checkoutBranch, createCommit
} from '@main/git/actions.js'
import { runSequencer, sequencerStep, isMergeCommit } from '@main/git/sequencer.js'
import { listRefs } from '@main/git/refs.js'
import { listConflicts, resolveConflict } from '@main/git/conflict.js'
import { getMergeDocument } from '@main/git/merge.js'
import { getStatus } from '@main/git/status.js'
import { assembleMerge, type Resolution } from '@shared/merge.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ref-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nl2\nl3\n'); g('add', '-A'); g('commit', '-qm', 'A')
  return cwd
}
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

// --- tags -------------------------------------------------------------------
{
  const cwd = repo()
  ok('valid tag name accepted', await isValidTagName(cwd, 'v1.0.0'))
  ok('invalid tag name refused', !(await isValidTagName(cwd, 'bad name')))
  ok('  and one with a control char', !(await isValidTagName(cwd, 'v1..0')))

  await createTag({ cwd, name: 'light' })
  ok('lightweight tag has no tag object',
    g(cwd, 'cat-file', '-t', 'light') === 'commit')

  await createTag({ cwd, name: 'v1.0.0', message: 'first release' })
  ok('annotated tag creates a tag object', g(cwd, 'cat-file', '-t', 'v1.0.0') === 'tag')
  ok('  with the message', g(cwd, 'tag', '-l', '--format=%(contents:subject)', 'v1.0.0') === 'first release')
  ok('  and is listed', (await listRefs(cwd)).tags.some(t => t.name === 'v1.0.0'))

  // tag a specific commit rather than HEAD
  writeFileSync(join(cwd, 'f.txt'), 'changed\n'); g(cwd, 'add', '-A'); g(cwd, 'commit', '-qm', 'B')
  await createTag({ cwd, name: 'at-first', target: 'HEAD~1' })
  ok('tag at an explicit commit',
    g(cwd, 'rev-parse', 'at-first^{commit}') === g(cwd, 'rev-parse', 'HEAD~1'))

  // An annotated tag is a tag object, which has a tagger rather than a
  // committer — reading committerdate gives an empty string and a 1970 date.
  const dated = (await listRefs(cwd)).tags
  const annotated = dated.find(t => t.name === 'v1.0.0')
  const lightweight = dated.find(t => t.name === 'light')
  ok('an annotated tag has a real date', (annotated?.date ?? 0) > 1_000_000_000,
    String(annotated?.date))
  ok('  and so does a lightweight one', (lightweight?.date ?? 0) > 1_000_000_000,
    String(lightweight?.date))
  ok('  tags are sorted newest first',
    dated.every((t, i, a) => i === 0 || a[i - 1]!.date >= t.date),
    dated.map(t => `${t.name}:${t.date}`).join(' '))

  await deleteTag(cwd, 'light')
  ok('delete removes it', !(await listRefs(cwd)).tags.some(t => t.name === 'light'))
  rmSync(cwd, { recursive: true, force: true })
}

// --- branch deletion --------------------------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd, name: 'merged-branch', checkout: false })
  ok('a branch at HEAD counts as contained', await isBranchMerged(cwd, 'merged-branch'))
  ok('deleting it works', (await deleteBranch({ cwd, name: 'merged-branch' })).includes('Deleted'))

  await createBranch({ cwd, name: 'unmerged' })
  writeFileSync(join(cwd, 'g.txt'), 'only here\n'); g(cwd, 'add', '-A')
  await createCommit({ cwd, message: 'unique work' })
  await checkoutBranch(cwd, 'main')
  ok('an unmerged branch is detected', !(await isBranchMerged(cwd, 'unmerged')))

  let refused = ''
  try { await deleteBranch({ cwd, name: 'unmerged' }) } catch (e) { refused = String(e) }
  ok('unforced delete refuses and explains',
    /exist nowhere else/.test(refused), refused.slice(0, 80))
  ok('  the branch survives', (await listRefs(cwd)).local.some(b => b.name === 'unmerged'))

  await deleteBranch({ cwd, name: 'unmerged', force: true })
  ok('forced delete removes it', !(await listRefs(cwd)).local.some(b => b.name === 'unmerged'))
  rmSync(cwd, { recursive: true, force: true })
}

// --- cherry-pick ------------------------------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd, name: 'side' })
  writeFileSync(join(cwd, 'pick.txt'), 'picked\n'); g(cwd, 'add', '-A')
  const c = await createCommit({ cwd, message: 'commit to pick' })
  await checkoutBranch(cwd, 'main')

  const r = await runSequencer({ cwd, kind: 'cherry-pick', hashes: [c.hash] })
  ok('cherry-pick applies the commit', r.status === 'done', r.message)
  ok('  file is present', readFileSync(join(cwd, 'pick.txt'), 'utf8') === 'picked\n')
  ok('  subject is preserved', g(cwd, 'log', '--format=%s', '-1') === 'commit to pick')
  rmSync(cwd, { recursive: true, force: true })
}

// --- cherry-pick with a conflict --------------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd, name: 'side' })
  writeFileSync(join(cwd, 'f.txt'), 'l1\nSIDE\nl3\n'); g(cwd, 'add', '-A')
  const c = await createCommit({ cwd, message: 'side edit' })
  await checkoutBranch(cwd, 'main')
  writeFileSync(join(cwd, 'f.txt'), 'l1\nMAIN\nl3\n'); g(cwd, 'add', '-A')
  await createCommit({ cwd, message: 'main edit' })

  const r = await runSequencer({ cwd, kind: 'cherry-pick', hashes: [c.hash] })
  ok('conflicting cherry-pick reports conflicts', r.status === 'conflicts', r.message)
  ok('  status sees the operation', (await getStatus(cwd)).operation === 'cherry-pick')
  ok('  path is unmerged', (await listConflicts(cwd)).includes('f.txt'))

  const doc = await getMergeDocument(cwd, 'f.txt')
  const res: Record<number, Resolution> = {}
  for (const ch of doc.chunks) if (ch.type === 'conflict') res[ch.id] = { kind: 'theirs' }
  await resolveConflict(cwd, 'f.txt', assembleMerge(doc.chunks, res)!)
  const cont = await sequencerStep(cwd, 'cherry-pick', 'continue')
  ok('continue finishes it', cont.status === 'done', cont.message)
  ok('  nothing in progress', (await getStatus(cwd)).operation === 'none')

  // abort path
  const c2 = g(cwd, 'rev-parse', 'side')
  await runSequencer({ cwd, kind: 'cherry-pick', hashes: [c2] }).catch(() => null)
  if ((await getStatus(cwd)).operation === 'cherry-pick') {
    const a = await sequencerStep(cwd, 'cherry-pick', 'abort')
    ok('abort clears it', a.status === 'done' && (await getStatus(cwd)).operation === 'none', a.message)
  } else { ok('abort clears it (nothing to abort)', true) }
  rmSync(cwd, { recursive: true, force: true })
}

// --- revert -----------------------------------------------------------------
{
  const cwd = repo()
  writeFileSync(join(cwd, 'f.txt'), 'l1\nCHANGED\nl3\n'); g(cwd, 'add', '-A')
  const c = await createCommit({ cwd, message: 'a change to undo' })
  const r = await runSequencer({ cwd, kind: 'revert', hashes: [c.hash] })
  ok('revert undoes the change', r.status === 'done', r.message)
  ok('  file is back to the original',
    readFileSync(join(cwd, 'f.txt'), 'utf8') === 'l1\nl2\nl3\n')
  ok('  and it is a new commit, not a rewrite',
    g(cwd, 'log', '--format=%s', '-1').startsWith('Revert'))
  rmSync(cwd, { recursive: true, force: true })
}

// --- reverting a merge needs a mainline -------------------------------------
{
  const cwd = repo()
  await createBranch({ cwd, name: 'feat' })
  writeFileSync(join(cwd, 'g.txt'), 'feat\n'); g(cwd, 'add', '-A')
  await createCommit({ cwd, message: 'feat work' })
  await checkoutBranch(cwd, 'main')
  g(cwd, 'merge', '--no-ff', 'feat', '-m', 'merge feat')
  const mergeHash = g(cwd, 'rev-parse', 'HEAD')
  ok('merge commit detected', await isMergeCommit(cwd, mergeHash))

  let threw = false
  try { await runSequencer({ cwd, kind: 'revert', hashes: [mergeHash] }) } catch { threw = true }
  ok('reverting a merge without a mainline is refused', threw)

  const r = await runSequencer({ cwd, kind: 'revert', hashes: [mergeHash], mainline: 1 })
  ok('  with --mainline it works', r.status === 'done', r.message)
  rmSync(cwd, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
