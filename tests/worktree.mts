import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { getStatus } from '@main/git/status.js'
import { listRefs } from '@main/git/refs.js'
import { discoverRepo, gitDir, gitCommonDir } from '@main/git/repo.js'
import { createCommit } from '@main/git/actions.js'
import { readPatch, stagePartial } from '@main/git/patch.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

/** A repo with a linked worktree checked out on a second branch. */
function setup(): { main: string; linked: string } {
  const base = mkdtempSync(join(tmpdir(), 'wt-'))
  const main = join(base, 'main')
  const linked = join(base, 'linked')
  execFileSync('git', ['init', '-q', '-b', 'main', main])
  const g = (...a: string[]) => execFileSync('git', a, { cwd: main, encoding: 'utf8' })
  g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  writeFileSync(join(main, 'f.txt'), 'l1\nl2\nl3\n')
  g('add', '-A'); g('commit', '-qm', 'base')
  g('branch', 'feature')
  g('worktree', 'add', '-q', linked, 'feature')
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: linked })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: linked })
  return { main, linked }
}

const { main, linked } = setup()
const g = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

// git resolves symlinks in the paths it reports; macOS puts the temp dir
// behind one, so both sides are normalised before comparing.
ok('discoverRepo resolves the linked worktree itself',
  (await discoverRepo(linked)) === realpathSync(linked))

const dir = await gitDir(linked)
const common = await gitCommonDir(linked)
ok('gitDir is the per-worktree directory', dir.includes(join('worktrees', 'linked')), dir)
ok('gitCommonDir is the shared one', common.endsWith('.git') && !common.includes('worktrees'), common)
ok('  and it is absolute', common.startsWith('/') || /^[A-Za-z]:/.test(common), common)
ok('the two differ inside a linked worktree', dir !== common)

// The gap the watcher used to have. Asserted through `--git-path`, which is
// what git itself resolves, rather than the presence of a directory: newer git
// pre-creates a per-worktree `refs/` for per-worktree refs like refs/bisect,
// so testing for its absence passes on one git version and fails on another.
const branchRefPath = g(linked, 'rev-parse', '--git-path', 'refs/heads/feature')
const headPath = g(linked, 'rev-parse', '--git-path', 'HEAD')
ok('a branch ref resolves into the common directory',
  branchRefPath.startsWith(common), branchRefPath)
ok('  while HEAD resolves into the per-worktree one',
  headPath.startsWith(dir), headPath)

// In an ordinary repository the two must coincide, or the watcher would
// attach the same directory twice.
ok('in a normal repo the two are the same path',
  (await gitDir(main)) === (await gitCommonDir(main)),
  `${await gitDir(main)} vs ${await gitCommonDir(main)}`)

const st = await getStatus(linked)
ok('status reports the worktree branch, not the main one', st.branch.name === 'feature', st.branch.name ?? '')

const refs = await listRefs(linked)
ok('HEAD marks the worktree branch',
  refs.local.find((b) => b.isHead)?.name === 'feature',
  refs.local.find((b) => b.isHead)?.name ?? 'none')

// Partial staging and committing must affect only this worktree's branch.
writeFileSync(join(linked, 'f.txt'), 'l1\nEDITED IN WORKTREE\nl3\n')
const patch = await readPatch(linked, 'f.txt', 'worktree')
ok('partial staging works in a worktree', patch !== null && patch.hunks.length > 0)
await stagePartial({
  cwd: linked, path: 'f.txt',
  selection: { hunks: new Map(patch!.hunks.map((_, i) => [i, 'all' as const])) }
})
await createCommit({ cwd: linked, message: 'from the worktree' })
ok('the commit lands on feature', g(linked, 'log', '--format=%s', '-1') === 'from the worktree')
ok('  main is untouched', g(main, 'log', '--format=%s', '-1') === 'base')

// A commit from the sibling worktree must be visible from here, since that is
// exactly what the watcher needs to notice.
writeFileSync(join(main, 'g.txt'), 'from main\n')
execFileSync('git', ['add', '-A'], { cwd: main })
await createCommit({ cwd: main, message: 'from the main worktree' })
const after = await listRefs(linked)
ok('a sibling worktree\'s commit is visible from here',
  after.local.find((b) => b.name === 'main')?.subject === 'from the main worktree',
  after.local.find((b) => b.name === 'main')?.subject ?? 'none')

// --- worktree management ----------------------------------------------------
{
  const { listWorktrees, addWorktree, removeWorktree, parseWorktrees,
          lockWorktree, unlockWorktree, pruneWorktrees } =
    await import('@main/git/worktree.js')

  const list = await listWorktrees(main)
  ok('list finds both worktrees', list.length === 2, String(list.length))
  ok('  the main one is flagged and comes first', list[0]?.isMain === true)
  ok('  the linked one is not', list[1]?.isMain === false)
  ok('  branches are short-named', list.map(w => w.label).sort().join(',') === 'feature,main',
    list.map(w => w.label).join(','))

  // Adding a worktree for a branch already checked out must explain itself.
  let refused = ''
  try {
    await addWorktree({ cwd: main, path: join(main, '..', 'dup'), ref: 'feature' })
  } catch (e) { refused = String(e) }
  ok('adding an already-checked-out branch is explained',
    /only be in one worktree/.test(refused), refused.slice(0, 80))

  // A full ref name must still land ON the branch, not detach. `main` and
  // `feature` are both taken, so this needs a branch nothing has checked out.
  g(main, 'branch', 'spare')
  const onBranch = join(main, '..', 'on-branch')
  await addWorktree({ cwd: main, path: onBranch, ref: 'refs/heads/spare' })
  const branchy = (await listWorktrees(main)).find(w => w.path.endsWith('on-branch'))
  ok('a full ref name checks out the branch rather than detaching',
    branchy?.detached === false && branchy.label === 'spare',
    `detached=${branchy?.detached} label=${branchy?.label}`)
  await removeWorktree({ cwd: main, path: onBranch, force: true })

  // Creating a branch and its worktree in one step.
  const third = join(main, '..', 'third')
  await addWorktree({ cwd: main, path: third, newBranch: 'from-worktree' })
  ok('add -b creates the branch and the worktree',
    (await listWorktrees(main)).length === 3)
  ok('  the branch exists', g(main, 'branch', '--list', 'from-worktree') !== '')

  // Detached.
  const detached = join(main, '..', 'detached')
  await addWorktree({ cwd: main, path: detached, ref: 'HEAD', detach: true })
  const withDetached = await listWorktrees(main)
  const d = withDetached.find(w => w.path.endsWith('detached'))
  ok('a detached worktree reports no branch', d?.detached === true && d.branch === null)
  ok('  and labels itself with the short hash', d?.label.length === 7, d?.label)

  // Removing a clean worktree works; a dirty one is refused.
  await removeWorktree({ cwd: main, path: detached })
  ok('removing a clean worktree works',
    !(await listWorktrees(main)).some(w => w.path.endsWith('detached')))

  writeFileSync(join(third, 'dirty.txt'), 'uncommitted\n')
  let dirtyRefusal = ''
  try { await removeWorktree({ cwd: main, path: third }) } catch (e) { dirtyRefusal = String(e) }
  ok('removing a dirty worktree is refused with a reason',
    /uncommitted changes/.test(dirtyRefusal), dirtyRefusal.slice(0, 70))
  await removeWorktree({ cwd: main, path: third, force: true })
  ok('  and force removes it', !(await listWorktrees(main)).some(w => w.path.endsWith('third')))

  // The main worktree can never be removed.
  let mainRefusal = ''
  try { await removeWorktree({ cwd: main, path: main }) } catch (e) { mainRefusal = String(e) }
  ok('the main working tree cannot be removed',
    /main working tree/.test(mainRefusal), mainRefusal.slice(0, 60))

  // Lock / unlock.
  await lockWorktree(main, linked, 'on a usb drive')
  const lockedList = await listWorktrees(main)
  ok('lock is reported with its reason',
    lockedList.find(w => !w.isMain)?.locked?.reason === 'on a usb drive',
    JSON.stringify(lockedList.find(w => !w.isMain)?.locked))
  await unlockWorktree(main, linked)
  ok('  and unlock clears it',
    (await listWorktrees(main)).find(w => !w.isMain)?.locked === null)

  // Prune notices a directory deleted behind git's back.
  const doomed = join(main, '..', 'doomed')
  await addWorktree({ cwd: main, path: doomed, newBranch: 'doomed-branch' })
  rmSync(doomed, { recursive: true, force: true })
  ok('a vanished worktree is marked prunable',
    (await listWorktrees(main)).find(w => w.path.endsWith('doomed'))?.prunable === true)
  await pruneWorktrees(main)
  ok('  and prune forgets it',
    !(await listWorktrees(main)).some(w => w.path.endsWith('doomed')))

  // Parser edge cases, without touching a repo.
  const parsed = parseWorktrees(
    'worktree /a\nHEAD abc123\nbranch refs/heads/main\n\n' +
    'worktree /b\nHEAD def456\ndetached\nlocked\n\n'
  )
  ok('parser handles a locked entry with no reason',
    parsed[1]?.locked?.reason === '', JSON.stringify(parsed[1]?.locked))
  ok('  and a trailing blank line yields no phantom entry', parsed.length === 2, String(parsed.length))
}

rmSync(join(main, '..'), { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
