/**
 * Compare two paths for the same location.
 *
 * git reports paths with forward slashes even on Windows, while anything that
 * came from Node or a dialog carries backslashes and may be an 8.3 short name.
 * String equality quietly fails there, and every path-keyed lookup misses.
 *
 * Lives in shared because both the git layer and the UI key on these paths,
 * and two implementations would eventually disagree.
 */
export function samePath(a: string, b: string, platform = process.platform): boolean {
  const normalise = (p: string): string => {
    const forward = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? forward.toLowerCase() : forward
  }
  return normalise(a) === normalise(b)
}
