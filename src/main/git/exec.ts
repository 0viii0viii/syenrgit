import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitRunOptions {
  cwd: string
  /** Treat these exit codes as success (e.g. 1 from `git diff --quiet`). */
  okExitCodes?: number[]
  /** Return the raw Buffer instead of a decoded string. */
  buffer?: boolean
  maxBuffer?: number
  timeoutMs?: number
  /** Extra environment for this call, merged over the base environment. */
  env?: NodeJS.ProcessEnv
  /**
   * Text to write to the process's stdin. Used for `git apply -`, where the
   * patch would otherwise have to be written to a temporary file.
   */
  stdin?: string
}

/**
 * Flags applied to every invocation.
 *
 * We deliberately shell out to the `git` binary rather than binding libgit2:
 * hooks, credential helpers, LFS, submodules and — critically for the merge
 * editor — conflict-style semantics all behave exactly as they do on the
 * command line, with no reimplementation to drift out of sync.
 */
const BASE_ARGS = [
  // Never block on a credential/editor prompt inside a GUI subprocess.
  '-c',
  'core.editor=true',
  '-c',
  'core.pager=cat',
  // Paths as raw bytes, no octal escaping — we decode them ourselves.
  '-c',
  'core.quotepath=false',
  // Deterministic output regardless of user config.
  '-c',
  'color.ui=false'
]

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    // A GUI has no tty for askpass to attach to; fail fast instead of hanging.
    GIT_ASKPASS: process.env.GIT_ASKPASS ?? 'true'
  }
}

/**
 * Feed a patch to git over stdin.
 *
 * `execFile` cannot write to a child's stdin, so this path uses `spawn`. It is
 * separate rather than replacing `run` because every other call is a plain
 * request/response and gains nothing from the extra plumbing.
 */
async function runWithStdin(
  args: string[],
  opts: GitRunOptions & { stdin: string }
): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = [...BASE_ARGS, ...args]

  return new Promise((resolve, reject) => {
    const child = spawn('git', fullArgs, {
      cwd: opts.cwd,
      env: { ...baseEnv(), ...opts.env },
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || opts.okExitCodes?.includes(code ?? -1)) {
        resolve({ stdout, stderr })
      } else {
        reject(new GitError(stderr.trim() || `git ${args[0] ?? ''} failed`, fullArgs, code, stderr))
      }
    })

    // A patch larger than the pipe buffer would deadlock if we waited for the
    // process to exit before finishing the write, so end() is called at once.
    child.stdin.end(opts.stdin, 'utf8')
  })
}

async function run(
  args: string[],
  opts: GitRunOptions
): Promise<{ stdout: string | Buffer; stderr: string }> {
  if (opts.stdin !== undefined) {
    return runWithStdin(args, opts as GitRunOptions & { stdin: string })
  }
  const fullArgs = [...BASE_ARGS, ...args]
  try {
    const { stdout, stderr } = await execFileAsync('git', fullArgs, {
      cwd: opts.cwd,
      env: { ...baseEnv(), ...opts.env },
      maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
      timeout: opts.timeoutMs ?? 0,
      encoding: opts.buffer ? 'buffer' : 'utf8',
      windowsHide: true
    } as never)
    return { stdout: stdout as string | Buffer, stderr: String(stderr ?? '') }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string
      stdout?: string | Buffer
      stderr?: string | Buffer
    }
    const exitCode = typeof e.code === 'number' ? e.code : null
    if (exitCode !== null && opts.okExitCodes?.includes(exitCode)) {
      return {
        stdout: (e.stdout ?? '') as string | Buffer,
        stderr: String(e.stderr ?? '')
      }
    }
    const stderr = String(e.stderr ?? e.message ?? '')
    throw new GitError(
      stderr.trim() || `git ${args[0] ?? ''} failed`,
      fullArgs,
      exitCode,
      stderr
    )
  }
}

/** Run git and return stdout as a UTF-8 string with the trailing newline kept. */
export async function git(args: string[], opts: GitRunOptions): Promise<string> {
  const { stdout } = await run(args, { ...opts, buffer: false })
  return stdout as string
}

/** Run git and return stdout with any single trailing newline stripped. */
export async function gitLine(args: string[], opts: GitRunOptions): Promise<string> {
  return (await git(args, opts)).replace(/\n$/, '')
}

/** Run git and return raw stdout bytes — use for blob contents. */
export async function gitBuffer(args: string[], opts: GitRunOptions): Promise<Buffer> {
  const { stdout } = await run(args, { ...opts, buffer: true })
  return stdout as Buffer
}

/**
 * Split NUL-delimited output. Git's `-z` modes emit a trailing NUL, which would
 * otherwise yield a spurious empty final field.
 */
export function splitNul(raw: string): string[] {
  const out = raw.split('\0')
  if (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}
