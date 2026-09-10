import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, GitError } from './exec.js'
import { listConflicts } from './conflict.js'
import { isRebaseInProgress, type RebaseOutcome } from './rebase.js'

/**
 * What to do with one commit during an interactive rebase.
 *
 * `reword` is deliberately absent: it opens the commit-message editor, and
 * this app runs git with `core.editor=true` so a GUI subprocess can never
 * block on one. Offering it would silently keep the original message, which
 * is worse than not offering it.
 */
export type TodoAction = 'pick' | 'squash' | 'fixup' | 'edit' | 'drop'

export interface TodoEntry {
  hash: string
  shortHash: string
  subject: string
  action: TodoAction
}

/**
 * The commits an interactive rebase would replay, oldest first — the order
 * git itself writes into the todo file.
 */
export async function buildTodo(cwd: string, base: string): Promise<TodoEntry[]> {
  const raw = await git(
    ['log', '--reverse', '--format=%H%x1f%s', `${base}..HEAD`],
    { cwd }
  )
  const entries: TodoEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [hash, subject] = line.split('\x1f')
    if (!hash) continue
    entries.push({
      hash,
      shortHash: hash.slice(0, 7),
      subject: subject ?? '',
      action: 'pick'
    })
  }
  return entries
}

/** Render a plan as a git todo file. */
export function renderTodo(entries: TodoEntry[]): string {
  const lines = entries
    .filter((e) => e.action !== 'drop')
    .map((e) => `${e.action} ${e.hash} ${e.subject}`)
  // A todo with nothing in it aborts the rebase; git wants an explicit noop.
  return (lines.length > 0 ? lines : ['noop']).join('\n') + '\n'
}

/**
 * The first entry cannot be a squash or fixup — there is nothing before it to
 * squash into, and git refuses the whole todo rather than the one line.
 */
export function validateTodo(entries: TodoEntry[]): string | null {
  const kept = entries.filter((e) => e.action !== 'drop')
  const first = kept[0]
  if (first && (first.action === 'squash' || first.action === 'fixup')) {
    return `"${first.action}" cannot be the first commit — there is nothing before it to combine with.`
  }
  if (kept.length === 0) return null
  return null
}

/**
 * Run an interactive rebase against a prepared plan.
 *
 * git opens the todo file in `$GIT_SEQUENCE_EDITOR`, appending the file path
 * to whatever that variable contains. Pointing it at a copy command therefore
 * replaces the todo with ours — no editor, no script on disk beyond the plan
 * itself, and git still does all the replaying.
 */
export async function runInteractiveRebase(
  cwd: string,
  base: string,
  entries: TodoEntry[]
): Promise<RebaseOutcome> {
  const problem = validateTodo(entries)
  if (problem) throw new Error(problem)

  const dir = await mkdtemp(join(tmpdir(), 'syenrgit-todo-'))
  const todoPath = join(dir, 'todo')
  await writeFile(todoPath, renderTodo(entries), 'utf8')

  // Git runs this through its own shell — `sh` even on Windows, where Git for
  // Windows ships one — so `cmd /c copy` is not reachable and backslashes
  // would be read as escapes. Forward slashes work on both platforms.
  const copy = `cp '${todoPath.replace(/\\/g, '/')}'`

  try {
    await git(['rebase', '--interactive', base], {
      cwd,
      env: {
        GIT_SEQUENCE_EDITOR: copy,
        // squash combines messages through the editor; core.editor=true keeps
        // git's own pre-filled combination rather than blocking.
        GIT_EDITOR: 'true'
      }
    })
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (await isRebaseInProgress(cwd)) {
      const conflicts = await listConflicts(cwd)
      return conflicts.length > 0
        ? { status: 'conflicts', message: 'Rebase stopped on a conflict' }
        : { status: 'stopped', message: 'Rebase stopped — edit the commit, then continue' }
    }
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  if (await isRebaseInProgress(cwd)) {
    return { status: 'stopped', message: 'Rebase paused' }
  }
  const dropped = entries.filter((e) => e.action === 'drop').length
  const combined = entries.filter((e) => e.action === 'squash' || e.action === 'fixup').length
  const parts = [
    dropped > 0 ? `${dropped} dropped` : null,
    combined > 0 ? `${combined} combined` : null
  ].filter(Boolean)
  return {
    status: 'rebased',
    message: parts.length > 0 ? `Rebase finished — ${parts.join(', ')}` : 'Rebase finished'
  }
}
