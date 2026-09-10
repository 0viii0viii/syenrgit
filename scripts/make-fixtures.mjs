#!/usr/bin/env node
/**
 * Build throwaway repositories for exercising the app by hand.
 *
 * Everything lands under fixtures/ (gitignored) so it can be deleted or
 * regenerated freely. Re-running wipes and rebuilds.
 *
 *   pnpm fixtures            # rebuild all
 *   pnpm fixtures conflicts  # rebuild one
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve('fixtures')

/** Commit timestamps march forward from here so relative times look real. */
let clock = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 90

/**
 * Deterministic jitter for commit spacing. A fixed step would land every
 * commit inside the same day, and the relative-time column would read "2mo"
 * all the way down — useless for eyeballing that column.
 */
let seed = 0x2f6e2b1
const step = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  const hours = 2 + (seed % 40)
  return hours * 60 * 60
}

const AUTHORS = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Grace Hopper', 'grace@example.com'],
  ['Alan Turing', 'alan@example.com']
]

function makeRepo(dir) {
  const cwd = join(ROOT, dir)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })

  const git = (...args) => {
    // Advance the clock on every call so commits are ordered and spread out
    // rather than all landing on the same second.
    clock += step()
    const stamp = new Date(clock * 1000).toISOString()
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: stamp,
        GIT_COMMITTER_DATE: stamp,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null'
      }
    })
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', AUTHORS[0][0])
  git('config', 'user.email', AUTHORS[0][1])

  const write = (path, body) => {
    const full = join(cwd, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  const remove = (path) => existsSync(join(cwd, path)) && unlinkSync(join(cwd, path))

  const commit = (message, author = 0) => {
    git('config', 'user.name', AUTHORS[author][0])
    git('config', 'user.email', AUTHORS[author][1])
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', message)
  }

  return { cwd, git, write, remove, commit }
}

const lines = (n, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n'

// ---------------------------------------------------------------------------

function buildWebapp() {
  const { cwd, git, write, remove, commit } = makeRepo('webapp')

  write('README.md', '# webapp\n\nA sample project.\n')
  write('src/index.js', "import { start } from './server.js'\n\nstart(3000)\n")
  write('src/server.js', lines(30, 'server'))
  commit('Initial commit')

  write('src/auth.js', lines(20, 'auth'))
  commit('Add auth module', 1)
  write('src/db.js', lines(25, 'db'))
  commit('Add database layer')
  git('tag', 'v1.0.0')

  // A branch that merges back — two lanes and a merge node.
  git('checkout', '-q', '-b', 'feature/search')
  write('src/search.js', lines(40, 'search'))
  commit('Add search index', 2)
  write('src/search.js', lines(45, 'search'))
  commit('Tune search ranking', 2)

  git('checkout', '-q', 'main')
  write('src/server.js', lines(34, 'server'))
  commit('Handle keep-alive', 1)
  git('merge', '-q', '--no-ff', 'feature/search', '-m', 'Merge search into main')
  git('tag', 'v1.1.0')

  // A branch that stays open — a lane that never closes.
  git('checkout', '-q', '-b', 'feature/auth')
  write('src/auth.js', lines(28, 'auth'))
  commit('Support refresh tokens', 1)
  write('src/auth.js', lines(31, 'auth'))
  commit('Reject expired refresh tokens', 1)

  // A long-lived develop branch, so the graph keeps three lanes for a while.
  git('checkout', '-q', 'main')
  git('checkout', '-q', '-b', 'develop')
  for (let i = 0; i < 4; i++) {
    write(`src/mod${i}.js`, lines(12, `mod${i}`))
    commit(`Extract module ${i}`, i % 3)
  }

  git('checkout', '-q', 'main')
  write('src/db.js', lines(30, 'db'))
  commit('Add connection pooling', 2)

  // A hotfix that merges into main, crossing lanes.
  git('checkout', '-q', '-b', 'hotfix/login-crash')
  write('src/auth.js', lines(26, 'auth'))
  commit('Fix crash on empty password', 1)
  git('checkout', '-q', 'main')
  git('merge', '-q', '--no-ff', 'hotfix/login-crash', '-m', 'Merge hotfix/login-crash')
  git('tag', '-a', 'v1.2.0', '-m', 'Release 1.2.0')

  // A big file, for the virtualized diff.
  write('data/report.csv', lines(3000, 'row'))
  commit('Add generated report')
  write(
    'data/report.csv',
    Array.from({ length: 3000 }, (_, i) =>
      i % 3 === 0 ? `row ${i + 1} CHANGED` : i % 50 === 0 ? 'x'.repeat(400) : `row ${i + 1}`
    ).join('\n') + '\n'
  )
  commit('Regenerate report')

  // Binary content.
  write('assets/logo.bin', Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)))
  commit('Add logo')

  // A remote, so the ref tree has remote-tracking branches and ahead/behind.
  const remote = join(ROOT, 'webapp-remote.git')
  rmSync(remote, { recursive: true, force: true })
  execFileSync('git', ['init', '-q', '--bare', remote])
  git('remote', 'add', 'origin', remote)
  git('push', '-q', 'origin', 'main', 'develop', 'feature/auth')
  git('branch', '-q', '--set-upstream-to=origin/main', 'main')

  // Two commits after the push: main is ahead by 2.
  write('src/index.js', "import { start } from './server.js'\n\nstart(process.env.PORT ?? 3000)\n")
  commit('Read port from the environment')
  write('CHANGELOG.md', '# Changelog\n\n## 1.2.0\n- Fix login crash\n')
  commit('Start a changelog', 2)

  // Stashes.
  write('src/server.js', lines(40, 'server'))
  git('stash', 'push', '-q', '-m', 'WIP: request timeouts')
  write('src/db.js', lines(36, 'db'))
  git('stash', 'push', '-q', '-m', 'WIP: retry on deadlock')

  // A dirty working tree covering every file state the change list renders.
  git('mv', 'src/db.js', 'src/database.js')
  write('src/database.js', lines(32, 'db'))
  write('src/auth.js', lines(33, 'auth'))
  git('add', 'src/auth.js')
  write('src/server.js', lines(38, 'server'))
  remove('README.md')
  write('notes.txt', 'scratch notes, not committed\n')
  write('tmp/debug.log', 'log line\n')

  return cwd
}

// ---------------------------------------------------------------------------

function buildConflicts() {
  const { cwd, git, write, remove, commit } = makeRepo('conflicts')

  write('config.yml', lines(30, 'setting'))
  write('shared.txt', 'kept by both\n')
  write('dropped-by-them.txt', 'original\n')
  write('dropped-by-us.txt', 'original\n')
  write('icon.bin', Buffer.from(Array.from({ length: 256 }, (_, i) => i)))
  commit('Base configuration')

  git('checkout', '-q', '-b', 'incoming')
  {
    const l = lines(30, 'setting').split('\n')
    l[2] = 'setting 3 — changed on incoming only' // auto-merges from theirs
    l[9] = 'setting 10 — incoming wins?' // real conflict
    l[19] = 'setting 20 — same edit on both' // auto-merges, both identical
    l[24] = 'setting 25 — incoming' // second real conflict
    write('config.yml', l.join('\n'))
  }
  write('dropped-by-us.txt', 'modified on incoming\n')
  remove('dropped-by-them.txt')
  write('icon.bin', Buffer.from(Array.from({ length: 256 }, (_, i) => 255 - i)))
  write('new-file.txt', 'added on incoming\n')
  commit('Work on the incoming branch', 1)

  git('checkout', '-q', 'main')
  {
    const l = lines(30, 'setting').split('\n')
    l[5] = 'setting 6 — changed on main only' // auto-merges from ours
    l[9] = 'setting 10 — main wins?' // real conflict
    l[19] = 'setting 20 — same edit on both' // identical to incoming
    l[24] = 'setting 25 — main' // second real conflict
    write('config.yml', l.join('\n'))
  }
  write('dropped-by-them.txt', 'modified on main\n')
  remove('dropped-by-us.txt')
  write('icon.bin', Buffer.from(Array.from({ length: 256 }, () => 7)))
  write('new-file.txt', 'added on main\n')
  commit('Work on main', 2)

  // Park the repo mid-merge so the merge editor has something to open.
  try {
    git('merge', 'incoming')
  } catch {
    /* the conflict is the point */
  }

  return cwd
}

// ---------------------------------------------------------------------------

function buildTiny() {
  const { cwd, write, commit } = makeRepo('tiny')
  write('hello.txt', 'hello\n')
  commit('Say hello')
  write('hello.txt', 'hello, world\n')
  commit('Add the world')
  write('scratch.txt', 'uncommitted\n')
  return cwd
}

// ---------------------------------------------------------------------------

const BUILDERS = { webapp: buildWebapp, conflicts: buildConflicts, tiny: buildTiny }

const requested = process.argv.slice(2)
const names = requested.length > 0 ? requested : Object.keys(BUILDERS)

for (const name of names) {
  const build = BUILDERS[name]
  if (!build) {
    console.error(`unknown fixture "${name}" — try: ${Object.keys(BUILDERS).join(', ')}`)
    process.exit(1)
  }
  mkdirSync(ROOT, { recursive: true })
  const dir = build()
  console.log(`  ${name.padEnd(10)} ${dir}`)
}

console.log('\nOpen these with the + button in the tab strip.')
