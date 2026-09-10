import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  splitPatch, buildPatch, stagePartial, unstagePartial, discardPartial, discardFile,
  type Selection
} from '@main/git/patch.js'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, x = '') => { console.log(c ? '  ok  ' : ' FAIL ', l, x); c ? pass++ : fail++ }

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
const staged = (cwd: string, path: string) => {
  try { return execFileSync('git', ['show', `:${path}`], { cwd, encoding: 'utf8' }) }
  catch { return '<not in index>' }
}
const worktree = (cwd: string, path: string) => readFileSync(join(cwd, path), 'utf8')

/** A file committed as `base`, then edited to `edited` in the worktree. */
function repo(base: string, edited: string, path = 'f.txt'): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ps-'))
  g(cwd, 'init', '-q', '-b', 'main'); g(cwd, 'config', 'user.name', 'T'); g(cwd, 'config', 'user.email', 't@t.t')
  // LF fixtures are compared byte-for-byte; Git for Windows would
  // otherwise rewrite them to CRLF on checkout.
  g(cwd, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(cwd, path), base)
  g(cwd, 'add', '-A'); g(cwd, 'commit', '-qm', 'base')
  writeFileSync(join(cwd, path), edited)
  return cwd
}

const all = (n: number): Selection => ({
  hunks: new Map(Array.from({ length: n }, (_, i) => [i, 'all' as const]))
})
const pick = (hunk: number, lines: number[]): Selection => ({
  hunks: new Map([[hunk, new Set(lines)]])
})

// --- patch construction, without touching a repo -----------------------------
{
  const raw = [
    'diff --git a/f.txt b/f.txt',
    'index 111..222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,3 @@ section',
    ' keep',
    '-old',
    '+new',
    ' tail'
  ].join('\n')
  const patch = splitPatch(raw)
  ok('splitPatch finds the hunk', patch?.hunks.length === 1)
  ok('  header is preserved verbatim', patch?.header.includes('index 111..222 100644') === true)
  ok('  section heading survives', patch?.hunks[0]?.header.endsWith('section') === true)

  // Selecting only the '+' must drop nothing and keep the '-' as context.
  const onlyAdd = buildPatch(patch!, pick(0, [2]))
  ok('selecting only the addition keeps the deletion as context',
    onlyAdd?.includes('\n old\n') === true, JSON.stringify(onlyAdd?.split('\n').slice(4)))
  ok('  and recounts the header',
    onlyAdd?.includes('@@ -1,3 +1,4 @@') === true,
    onlyAdd?.split('\n').find(l => l.startsWith('@@')))

  // Selecting only the '-' must drop the '+' entirely.
  const onlyDelete = buildPatch(patch!, pick(0, [1]))
  ok('selecting only the deletion drops the addition',
    onlyDelete?.includes('+new') === false)
  ok('  and recounts the header',
    onlyDelete?.includes('@@ -1,3 +1,2 @@') === true,
    onlyDelete?.split('\n').find(l => l.startsWith('@@')))

  ok('an empty selection yields no patch', buildPatch(patch!, { hunks: new Map() }) === null)
  ok('a context-only selection yields no patch', buildPatch(patch!, pick(0, [0, 3])) === null)
  ok('binary diffs are refused', splitPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n') === null)
}

// --- staging one hunk out of several ----------------------------------------
{
  const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const edited = base.replace('line 3', 'CHANGED 3').replace('line 20', 'CHANGED 20')
  const cwd = repo(base, edited)

  // With --unified=0 each edit is its own hunk.
  await stagePartial({ cwd, path: 'f.txt', selection: { hunks: new Map([[0, 'all']]) } })

  const idx = staged(cwd, 'f.txt')
  ok('first hunk is staged', idx.includes('CHANGED 3'))
  ok('  second hunk is not', !idx.includes('CHANGED 20'))
  ok('  the worktree is untouched', worktree(cwd, 'f.txt') === edited)
  ok('  git agrees the file is partly staged',
    g(cwd, 'status', '--porcelain').trim().startsWith('MM'), g(cwd, 'status', '--porcelain').trim())

  // Now stage the rest and confirm the index matches the worktree exactly.
  await stagePartial({ cwd, path: 'f.txt', selection: all(4) })
  ok('staging the rest makes index == worktree', staged(cwd, 'f.txt') === edited)
  rmSync(cwd, { recursive: true, force: true })
}

// --- staging individual lines within one hunk -------------------------------
{
  const base = 'a\nb\nc\n'
  const edited = 'a\nB1\nB2\nc\n'      // one line replaced by two
  const cwd = repo(base, edited)

  const raw = execFileSync('git', ['diff', '--unified=0', '--no-color', '--', 'f.txt'],
    { cwd, encoding: 'utf8' })
  const lines = splitPatch(raw)!.hunks[0]!.lines
  const addIndexes = lines.map((l, i) => l.startsWith('+') ? i : -1).filter(i => i >= 0)

  // Take the deletion and only the FIRST of the two added lines.
  const deleteIndex = lines.findIndex(l => l.startsWith('-'))
  await stagePartial({
    cwd, path: 'f.txt',
    selection: { hunks: new Map([[0, new Set([deleteIndex, addIndexes[0]!])]]) }
  })
  ok('line-level staging takes exactly what was picked',
    staged(cwd, 'f.txt') === 'a\nB1\nc\n', JSON.stringify(staged(cwd, 'f.txt')))
  ok('  worktree still has both lines', worktree(cwd, 'f.txt') === edited)
  rmSync(cwd, { recursive: true, force: true })
}

// --- unstage a hunk ----------------------------------------------------------
{
  const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const edited = base.replace('line 3', 'CHANGED 3').replace('line 20', 'CHANGED 20')
  const cwd = repo(base, edited)
  g(cwd, 'add', 'f.txt')
  ok('setup: everything staged', staged(cwd, 'f.txt') === edited)

  await unstagePartial({ cwd, path: 'f.txt', selection: { hunks: new Map([[0, 'all']]) } })
  const idx = staged(cwd, 'f.txt')
  ok('unstaging one hunk reverts just it', !idx.includes('CHANGED 3'), JSON.stringify(idx.split('\n')[2]))
  ok('  the other stays staged', idx.includes('CHANGED 20'))
  ok('  the worktree is untouched', worktree(cwd, 'f.txt') === edited)
  rmSync(cwd, { recursive: true, force: true })
}

// --- discard --------------------------------------------------------------
{
  const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const edited = base.replace('line 3', 'CHANGED 3').replace('line 20', 'CHANGED 20')
  const cwd = repo(base, edited)

  await discardPartial({ cwd, path: 'f.txt', selection: { hunks: new Map([[0, 'all']]) } })
  const wt = worktree(cwd, 'f.txt')
  ok('discarding a hunk reverts it in the worktree', !wt.includes('CHANGED 3'))
  ok('  and leaves the other edit alone', wt.includes('CHANGED 20'))
  rmSync(cwd, { recursive: true, force: true })
}

// --- whole-file discard, tracked and untracked -------------------------------
{
  const cwd = repo('original\n', 'modified\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'new file\n')

  await discardFile(cwd, 'f.txt')
  ok('discardFile restores a tracked file', worktree(cwd, 'f.txt') === 'original\n')

  await discardFile(cwd, 'untracked.txt')
  ok('  and removes an untracked one', !existsSync(join(cwd, 'untracked.txt')))
  rmSync(cwd, { recursive: true, force: true })
}

// --- files without a trailing newline ---------------------------------------
{
  const cwd = repo('a\nb\nc\n', 'a\nB\nc')   // edited AND lost its final newline
  await stagePartial({ cwd, path: 'f.txt', selection: all(4) })
  ok('a missing trailing newline round-trips', staged(cwd, 'f.txt') === 'a\nB\nc',
    JSON.stringify(staged(cwd, 'f.txt')))
  rmSync(cwd, { recursive: true, force: true })
}

// --- a new file ---------------------------------------------------------------
{
  const cwd = mkdtempSync(join(tmpdir(), 'ps-new-'))
  g(cwd, 'init', '-q', '-b', 'main'); g(cwd, 'config', 'user.name', 'T'); g(cwd, 'config', 'user.email', 't@t.t')
  writeFileSync(join(cwd, 'seed.txt'), 'seed\n'); g(cwd, 'add', '-A'); g(cwd, 'commit', '-qm', 'seed')
  writeFileSync(join(cwd, 'added.txt'), 'one\ntwo\nthree\n')
  // An untracked file has no diff until it is intent-to-add.
  g(cwd, 'add', '--intent-to-add', 'added.txt')
  await stagePartial({ cwd, path: 'added.txt',
    selection: { hunks: new Map([[0, new Set([0])]]) } })
  ok('partially staging a new file takes only the picked line',
    staged(cwd, 'added.txt') === 'one\n', JSON.stringify(staged(cwd, 'added.txt')))
  rmSync(cwd, { recursive: true, force: true })
}

// --- randomised: staging a subset must never lose or invent content ---------
{
  let mulberry = 0x9e3779b9
  const rng = (): number => {
    mulberry |= 0
    mulberry = (mulberry + 0x6d2b79f5) | 0
    let t = Math.imul(mulberry ^ (mulberry >>> 15), 1 | mulberry)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  let trials = 0
  let complete = 0
  let reverted = 0
  const failures: string[] = []

  for (let n = 0; n < 60; n++) {
    const size = 8 + Math.floor(rng() * 20)
    const base = Array.from({ length: size }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const editedLines = base.split('\n')
    // Mutate a scattering of lines: replace, insert, delete.
    for (let e = 0; e < 1 + Math.floor(rng() * 5); e++) {
      const at = Math.floor(rng() * Math.max(1, editedLines.length - 1))
      const op = rng()
      if (op < 0.45) editedLines[at] = `EDITED ${at}`
      else if (op < 0.75) editedLines.splice(at, 0, `INSERTED ${at}`)
      else if (editedLines.length > 2) editedLines.splice(at, 1)
    }
    const edited = editedLines.join('\n')
    if (edited === base) continue

    const cwd = repo(base, edited)
    trials++
    try {
      const raw = execFileSync('git', ['diff', '--unified=0', '--no-color', '--', 'f.txt'],
        { cwd, encoding: 'utf8' })
      const patch = splitPatch(raw)
      if (!patch) { rmSync(cwd, { recursive: true, force: true }); continue }

      // Pick a random subset of hunks.
      const chosen = new Map<number, Set<number> | 'all'>()
      for (let h = 0; h < patch.hunks.length; h++) if (rng() < 0.5) chosen.set(h, 'all')
      if (chosen.size === 0) chosen.set(0, 'all')

      await stagePartial({ cwd, path: 'f.txt', selection: { hunks: chosen } })
      const partial = staged(cwd, 'f.txt')

      // Invariant 1: staging the remainder must reproduce the worktree exactly.
      const remaining = splitPatch(
        execFileSync('git', ['diff', '--unified=0', '--no-color', '--', 'f.txt'],
          { cwd, encoding: 'utf8' })
      )
      if (remaining) {
        await stagePartial({
          cwd, path: 'f.txt',
          selection: { hunks: new Map(remaining.hunks.map((_, i) => [i, 'all' as const])) }
        })
      }
      if (staged(cwd, 'f.txt') === edited) complete++
      else failures.push(`trial ${n}: staging everything did not reproduce the worktree`)

      // Invariant 2: unstaging everything must return the index to HEAD.
      const full = splitPatch(
        execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--', 'f.txt'],
          { cwd, encoding: 'utf8' })
      )
      if (full) {
        await unstagePartial({
          cwd, path: 'f.txt',
          selection: { hunks: new Map(full.hunks.map((_, i) => [i, 'all' as const])) }
        })
      }
      if (staged(cwd, 'f.txt') === base) reverted++
      else failures.push(`trial ${n}: unstaging everything did not return to HEAD`)

      void partial
    } catch (err) {
      failures.push(`trial ${n}: threw ${String(err).slice(0, 90)}`)
    }
    rmSync(cwd, { recursive: true, force: true })
  }

  ok(`randomised: staging the remainder reproduces the worktree (${complete}/${trials})`,
    complete === trials)
  ok(`randomised: unstaging everything returns to HEAD (${reverted}/${trials})`,
    reverted === trials)
  for (const f of failures.slice(0, 4)) console.log('      -', f)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
