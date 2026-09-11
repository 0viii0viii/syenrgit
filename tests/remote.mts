import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listRemotes, fetchRemote, pullCurrent, pushBranch, pushTags, stalePruneCandidates
} from '@main/git/remote.js'
import { createCommit, checkoutBranch, createBranch } from '@main/git/actions.js'
import { listRefs } from '@main/git/refs.js'
import { getStatus } from '@main/git/status.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })

// origin <- clone A, clone B (a second author pushing behind our back)
const base = mkdtempSync(join(tmpdir(), 'net-'))
const origin = join(base, 'origin.git')
execFileSync('git', ['init', '-q', '--bare', origin])

const seed = join(base, 'seed')
execFileSync('git', ['init', '-q', '-b', 'main', seed])
g(seed, 'config', 'user.name', 'T'); g(seed, 'config', 'user.email', 't@t.t')
writeFileSync(join(seed, 'f.txt'), 'one\n')
g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'one')
g(seed, 'remote', 'add', 'origin', origin); g(seed, 'push', '-q', 'origin', 'main')

const A = join(base, 'a')
execFileSync('git', ['clone', '-q', origin, A])
g(A, 'config', 'user.name', 'A'); g(A, 'config', 'user.email', 'a@a.a')

ok('listRemotes finds origin', (await listRemotes(A))[0]?.name === 'origin')

// --- push a new branch with upstream ---------------------------------------
await createBranch({ cwd: A, name: 'feature' })
writeFileSync(join(A, 'g.txt'), 'feature\n')
g(A, 'add', '-A'); await createCommit({ cwd: A, message: 'feature work' })
const msg = await pushBranch({ cwd: A, remote: 'origin', setUpstream: true })
ok('push new branch', /Pushed feature to origin/.test(msg), msg)
ok('  upstream recorded',
  (await listRefs(A)).local.find(b => b.name === 'feature')?.upstream === 'origin/feature')
ok('  origin has it', g(A, 'ls-remote', '--heads', 'origin').includes('refs/heads/feature'))

// --- tags -------------------------------------------------------------------
await checkoutBranch(A, 'main')
g(A, 'tag', '-a', 'v1.0', '-m', 'release 1.0')
g(A, 'tag', 'v1.0-lightweight')
ok('tag is local only', !g(A, 'ls-remote', '--tags', 'origin').includes('v1.0'))
const t1 = await pushTags({ cwd: A, remote: 'origin', tag: 'v1.0' })
ok('push a single tag', g(A, 'ls-remote', '--tags', 'origin').includes('refs/tags/v1.0'), t1)
ok('  and only that one',
  !g(A, 'ls-remote', '--tags', 'origin').includes('v1.0-lightweight'))
await pushTags({ cwd: A, remote: 'origin' })
ok('push all tags', g(A, 'ls-remote', '--tags', 'origin').includes('v1.0-lightweight'))

// --- fetch sees another clone's work ---------------------------------------
const B = join(base, 'b')
execFileSync('git', ['clone', '-q', origin, B])
g(B, 'config', 'user.name', 'B'); g(B, 'config', 'user.email', 'b@b.b')
writeFileSync(join(B, 'h.txt'), 'from b\n')
g(B, 'add', '-A'); await createCommit({ cwd: B, message: 'work from b' })
g(B, 'push', '-q', 'origin', 'main')

await fetchRemote({ cwd: A, remote: 'origin' })
const afterFetch = (await listRefs(A)).local.find(b => b.name === 'main')
ok('fetch reports behind', afterFetch?.behind === 1, `behind=${afterFetch?.behind}`)

// --- pull -------------------------------------------------------------------
const pulled = await pullCurrent({ cwd: A })
ok('pull succeeds', pulled.status === 'pulled', pulled.status)
ok('  and clears behind',
  (await listRefs(A)).local.find(b => b.name === 'main')?.behind === 0)
ok('  second pull is a no-op', (await pullCurrent({ cwd: A })).status === 'up-to-date')

// --- pull with conflicts is an outcome, not a throw -------------------------
writeFileSync(join(B, 'f.txt'), 'b edit\n')
g(B, 'add', '-A'); await createCommit({ cwd: B, message: 'b edits f' })
g(B, 'push', '-q', 'origin', 'main')
writeFileSync(join(A, 'f.txt'), 'a edit\n')
g(A, 'add', '-A'); await createCommit({ cwd: A, message: 'a edits f' })
const conflicted = await pullCurrent({ cwd: A })
ok('conflicting pull reports conflicts', conflicted.status === 'conflicts', conflicted.status)
ok('  status shows the merge', (await getStatus(A)).operation === 'merge')
g(A, 'merge', '--abort')

// --- non-fast-forward push is explained ------------------------------------
let pushErr = ''
try { await pushBranch({ cwd: A, remote: 'origin' }) } catch (e) { pushErr = String(e) }
ok('rejected push explains itself', /Pull before pushing/.test(pushErr), pushErr.slice(0, 90))

// --- prune ------------------------------------------------------------------
g(B, 'push', '-q', 'origin', '--delete', 'feature')
const stale = await stalePruneCandidates(A, 'origin')
ok('prune preview lists the gone branch', stale.some(s => s.includes('feature')), JSON.stringify(stale))
await fetchRemote({ cwd: A, remote: 'origin', prune: true })
ok('  prune removes it', !(await listRefs(A)).remote.some(r => r.name === 'origin/feature'))

// --- a remote that needs credentials fails with something readable ----------
g(A, 'remote', 'add', 'https', 'https://example.invalid/nope.git')
let authErr = ''
try { await fetchRemote({ cwd: A, remote: 'https' }) } catch (e) { authErr = String(e) }
ok('unreachable remote is explained',
  /credential helper|Cannot reach the remote/.test(authErr), authErr.slice(0, 110))

rmSync(base, { recursive: true, force: true })

// --- tags: moving one, and the remote keeping its own copy ----------------
{
  const { createTag, deleteTag, tagExists } = await import('@main/git/actions.js')
  const { pushTags, deleteRemoteTag } = await import('@main/git/remote.js')

  const bare = mkdtempSync(join(tmpdir(), 'tagremote-'))
  execFileSync('git', ['init', '-q', '--bare', bare])
  const work = mkdtempSync(join(tmpdir(), 'tagwork-'))
  execFileSync('git', ['init', '-q', '-b', 'main', work])
  const g = (...a: string[]) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
  g('config', 'user.name', 'T'); g('config', 'user.email', 't@t.t')
  g('config', 'core.autocrlf', 'false')
  g('remote', 'add', 'origin', bare)
  writeFileSync(join(work, 'a.txt'), 'one\n'); g('add', '-A'); g('commit', '-qm', 'first')
  const first = g('rev-parse', 'HEAD').trim()
  writeFileSync(join(work, 'a.txt'), 'two\n'); g('add', '-A'); g('commit', '-qm', 'second')
  const second = g('rev-parse', 'HEAD').trim()
  g('push', '-q', 'origin', 'main')

  await createTag({ cwd: work, name: 'v1', target: first })
  ok('the tag exists here', await tagExists(work, 'v1'), 'v1')
  await pushTags({ cwd: work, remote: 'origin', tag: 'v1' })

  // stderr is dropped: one call below deliberately asks for a ref that is gone.
  const onRemote = (): string =>
    execFileSync('git', ['rev-parse', 'refs/tags/v1'], {
      cwd: bare,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  ok('and on the remote', onRemote() === first, onRemote().slice(0, 7))

  // This is the trap: deleting here leaves the remote's copy untouched.
  await deleteTag(work, 'v1')
  ok('deleting here does not delete there',
    !(await tagExists(work, 'v1')) && onRemote() === first, onRemote().slice(0, 7))

  // Re-cutting the same name and pushing is what the remote rejects, and the
  // message has to say what actually resolves it.
  await createTag({ cwd: work, name: 'v1', target: second })
  let rejected = ''
  try { await pushTags({ cwd: work, remote: 'origin', tag: 'v1' }) }
  catch (err) { rejected = (err as Error).message }
  ok('re-pushing a name the remote still holds is refused',
    rejected !== '', rejected.slice(0, 40))
  ok('  and the message names both ways out',
    /delete it on origin/i.test(rejected) && /force-push/i.test(rejected), rejected.slice(0, 90))

  // Way out one: force.
  await pushTags({ cwd: work, remote: 'origin', tag: 'v1', force: true })
  ok('forcing moves the tag on the remote', onRemote() === second, onRemote().slice(0, 7))

  // Way out two: delete it there, then push clean.
  await deleteRemoteTag(work, 'origin', 'v1')
  let stillThere = true
  try { onRemote() } catch { stillThere = false }
  ok('deleting on the remote removes it there', !stillThere, String(stillThere))
  await pushTags({ cwd: work, remote: 'origin', tag: 'v1' })
  ok('  and the name is free to push again', onRemote() === second, onRemote().slice(0, 7))

  // A local move is just --force on an existing name.
  await createTag({ cwd: work, name: 'v1', target: first, force: true })
  const local = g('rev-parse', 'refs/tags/v1').trim()
  ok('creating an existing tag with force moves it', local === first, local.slice(0, 7))

  rmSync(bare, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
