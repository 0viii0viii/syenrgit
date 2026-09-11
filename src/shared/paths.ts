/**
 * Compare two paths for the same location.
 *
 * git reports paths with forward slashes even on Windows, while anything from
 * Node or a dialog carries backslashes and may be an 8.3 short name. String
 * equality quietly fails there, and every path-keyed lookup misses.
 *
 * Lives in shared because both the git layer and the UI key on these paths,
 * and two implementations would eventually disagree. That means it runs in the
 * renderer too, where `process` does not exist — so the platform is inferred
 * from the paths themselves rather than read from the environment.
 */

/** A drive letter or a backslash means this came from Windows. */
const WINDOWS_PATH = /^[A-Za-z]:|\\/

function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function samePath(a: string, b: string): boolean {
  const left = normalise(a)
  const right = normalise(b)
  if (left === right) return true

  // Case only differs on Windows, where the same directory is reported with
  // different capitalisation by git and by Node. Comparing case-insensitively
  // everywhere would call /tmp/A and /tmp/a the same path on Linux, where they
  // are two directories.
  if (WINDOWS_PATH.test(a) || WINDOWS_PATH.test(b)) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return false
}
