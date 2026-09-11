import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useMerge } from '@/stores/merge'
import { MergeEditor } from './MergeEditor'

/**
 * The merge editor, as a window of its own.
 *
 * Three columns of code do not fit in a side panel — at the pane's default
 * width each column was about a hundred and thirty pixels, which is a dozen
 * characters. Resolving a conflict is a task you do from start to finish, so
 * it gets the screen for as long as it takes and gives it back afterwards.
 */
export function MergeDialog(): React.JSX.Element {
  const path = useMerge((s) => s.path)
  const close = useMerge((s) => s.close)

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        // Clicking away is not a decision about a half-resolved merge, and
        // closing discards every resolution made so far. Escape and the
        // explicit Cancel remain, because trapping the user is worse.
        onInteractOutside={(e) => e.preventDefault()}
        // Both max-widths: the base class and the `sm:` one are different
        // variants, so overriding only the base leaves the dialog clamped to
        // 32rem on every screen this app actually runs on.
        className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Resolve conflicts in {path ?? ''}</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a side for each conflicting region, then mark the file resolved.
        </DialogDescription>
        <MergeEditor />
      </DialogContent>
    </Dialog>
  )
}
