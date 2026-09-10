import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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

// The gap the watcher used to have.
ok('branches live only in the common directory',
  !existsSync(join(dir, 'refs')) && existsSync(join(common, 'refs')))

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

rmSync(join(main, '..'), { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
