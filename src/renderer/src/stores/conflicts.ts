import { create } from 'zustand'

interface ConflictsState {
  /** Whether the conflicted-files dialog is showing. */
  listOpen: boolean
  openList: () => void
  closeList: () => void
}

/**
 * Visibility of the conflicted-files dialog.
 *
 * Its own store rather than local state because two places open it: the
 * transition into a conflicted state opens it by itself, and the Changes
 * header reopens it after it has been dismissed.
 */
export const useConflicts = create<ConflictsState>((set) => ({
  listOpen: false,
  openList: () => set({ listOpen: true }),
  closeList: () => set({ listOpen: false })
}))
