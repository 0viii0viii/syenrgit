import { describeError } from '@/lib/errors'
import { create } from 'zustand'
import type { FilePatch, PatchSelection } from '@shared/ipc'
import { useHistory } from './history'
import { useRepo } from './repo'

/** A selectable line, addressed the way the patch layer addresses it. */
export interface LineRef {
  hunk: number
  line: number
}

const key = (ref: LineRef): string => `${ref.hunk}:${ref.line}`

interface PatchState {
  /** The file the selection belongs to; cleared when the selection moves. */
  path: string | null
  staged: boolean
  patch: FilePatch | null
  /** Selected line keys, "hunk:line". */
  selected: Set<string>
  busy: boolean
  error: string | null

  load: (root: string, path: string, staged: boolean) => Promise<void>
  clear: () => void
  toggleLine: (ref: LineRef, additive: boolean) => void
  toggleHunk: (hunk: number) => void
  isSelected: (ref: LineRef) => boolean
  /** How many lines of this hunk are picked, and how many are pickable. */
  hunkTally: (hunk: number) => { picked: number; total: number }
  apply: (root: string, action: 'stage' | 'unstage' | 'discard') => Promise<boolean>
}

/** Context lines cannot be staged on their own, so they are never selectable. */
function isChange(line: string): boolean {
  return line.startsWith('+') || line.startsWith('-')
}

export const usePatch = create<PatchState>((set, get) => ({
  path: null,
  staged: false,
  patch: null,
  selected: new Set(),
  busy: false,
  error: null,

  load: async (root, path, staged) => {
    set({ path, staged, patch: null, selected: new Set(), error: null })
    try {
      const patch = await window.api.readPatch(root, path, staged)
      // Guard against a slower response for a file the user already left.
      if (get().path !== path || get().staged !== staged) return
      set({ patch })
    } catch (err) {
      set({ patch: null, error: describeError(err) })
    }
  },

  clear: () => set({ path: null, patch: null, selected: new Set(), error: null }),

  toggleLine: (ref, additive) =>
    set((s) => {
      const next = additive ? new Set(s.selected) : new Set<string>()
      const id = key(ref)
      if (additive && s.selected.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next }
    }),

  toggleHunk: (hunk) =>
    set((s) => {
      const lines = s.patch?.hunks[hunk]?.lines ?? []
      const ids = lines
        .map((line, index) => (isChange(line) ? key({ hunk, line: index }) : null))
        .filter((v): v is string => v !== null)

      const allPicked = ids.length > 0 && ids.every((id) => s.selected.has(id))
      const next = new Set(s.selected)
      for (const id of ids) {
        if (allPicked) next.delete(id)
        else next.add(id)
      }
      return { selected: next }
    }),

  isSelected: (ref) => get().selected.has(key(ref)),

  hunkTally: (hunk) => {
    const { patch, selected } = get()
    const lines = patch?.hunks[hunk]?.lines ?? []
    let picked = 0
    let total = 0
    for (let i = 0; i < lines.length; i++) {
      if (!isChange(lines[i]!)) continue
      total++
      if (selected.has(key({ hunk, line: i }))) picked++
    }
    return { picked, total }
  },

  apply: async (root, action) => {
    const { path, patch, selected } = get()
    if (!path || !patch || selected.size === 0) return false

    // Rebuild the wire format: hunk index -> picked line indices.
    const selection: PatchSelection = {}
    for (const id of selected) {
      const [hunk, line] = id.split(':').map(Number)
      if (hunk === undefined || line === undefined) continue
      const existing = selection[hunk]
      if (Array.isArray(existing)) existing.push(line)
      else selection[hunk] = [line]
    }

    set({ busy: true, error: null })
    try {
      const req = { cwd: root, path, selection }
      if (action === 'stage') await window.api.stagePartial(req)
      else if (action === 'unstage') await window.api.unstagePartial(req)
      else await window.api.discardPartial(req)

      set({ selected: new Set() })
      await Promise.all([useRepo.getState().refresh(), useHistory.getState().load(root)])
      return true
    } catch (err) {
      set({ error: describeError(err) })
      return false
    } finally {
      set({ busy: false })
    }
  }
}))
