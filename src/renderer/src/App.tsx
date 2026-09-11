import { useEffect } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TitleBar } from '@/components/layout/TitleBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { RefTree } from '@/components/layout/RefTree'
import { RepoTabs } from '@/components/layout/RepoTabs'
import { ChangesPanel } from '@/features/changes/ChangesPanel'
import { DiffPanel } from '@/features/diff/DiffView'
import { StagingDiff } from '@/features/diff/StagingDiff'
import { CommitList } from '@/features/history/CommitList'
import { CommitSearchBar } from '@/features/history/CommitSearchBar'
import { HistoryFilter } from '@/features/history/HistoryFilter'
import { CommitDetail } from '@/features/history/CommitDetail'
import { MergeEditor } from '@/features/conflict/MergeEditor'
import { useHistory } from '@/stores/history'
import { useMerge } from '@/stores/merge'
import { useWorkspace } from '@/stores/workspace'
import { useRepo } from '@/stores/repo'

function EmptyState(): React.JSX.Element {
  const openDialog = useWorkspace((s) => s.openDialog)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-default">
      <p className="text-xs text-content-secondary">No repository open</p>
      <Button size="sm" onClick={() => void openDialog()}>
        Open Repository
      </Button>
    </div>
  )
}

function HistoryPane(): React.JSX.Element {
  const fileDiff = useHistory((s) => s.fileDiff)
  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="45%" minSize="20%">
        <CommitDetail />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="55%">
        <DiffPanel diff={fileDiff} placeholder="Select a file from the commit" />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Workspace(): React.JSX.Element {
  const focus = useRepo((s) => s.focus)
  const mergePath = useMerge((s) => s.path)

  return (
    <ResizablePanelGroup orientation="horizontal">
      {/* Refs above, the working tree below. Both are "where am I and what
          have I got", and neither needs the width that history does. */}
      <ResizablePanel defaultSize="16%" minSize="11%" maxSize="30%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="50%" minSize="15%">
            <ErrorBoundary label="The ref list">
              <RefTree />
            </ErrorBoundary>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="50%" minSize="20%">
            <ErrorBoundary label="The change list">
              <ChangesPanel />
            </ErrorBoundary>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />

      {/* The widest pane by default. History is what the app is for, and a
          commit row has to fit refs, a subject, an author and a date before
          the graph even starts — at a third of the window the subject was the
          first thing to be truncated. */}
      <ResizablePanel defaultSize="60%" minSize="28%">
        <ErrorBoundary label="The history">
          <div className="flex h-full min-h-0 flex-col">
            <CommitSearchBar />
            <HistoryFilter />
            <div className="min-h-0 flex-1">
              <CommitList />
            </div>
          </div>
        </ErrorBoundary>
      </ResizablePanel>
      <ResizableHandle />

      {/* One detail pane, shared. It shows whichever of the two lists you last
          selected in, so there is no second diff view to keep in sync. */}
      <ResizablePanel defaultSize="24%" minSize="18%">
        <ErrorBoundary label="This pane">
          {focus === 'changes' ? (
            mergePath ? (
              <MergeEditor />
            ) : (
              <StagingDiff />
            )
          ) : (
            <HistoryPane />
          )}
        </ErrorBoundary>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export function App(): React.JSX.Element {
  const root = useRepo((s) => s.root)
  const refresh = useRepo((s) => s.refresh)
  const loadHistory = useHistory((s) => s.load)
  const restore = useWorkspace((s) => s.restore)
  const markStale = useWorkspace((s) => s.markStale)

  // Reopen the tabs from the last session.
  useEffect(() => {
    void restore()
  }, [restore])

  // A repository can change under us at any time — CLI commits, another GUI, a
  // rebase running in a terminal. Main pushes a debounced, scoped event per
  // watched repo: a worktree write only invalidates the status, while a .git
  // write (commit, checkout, fetch, rebase step) is the only thing that can
  // move history. Changes to a background tab only mark it stale; reloading a
  // repository nobody is looking at is wasted work.
  useEffect(
    () =>
      window.api.onRepoChanged(({ root: changed, scope }) => {
        if (changed !== useRepo.getState().root) {
          markStale(changed)
          return
        }
        void refresh()
        if (scope === 'git') void loadHistory(changed)
      }),
    [refresh, loadHistory, markStale]
  )

  return (
    <div className="flex h-full flex-col">
      <RepoTabs />
      <TitleBar />
      <main className="min-h-0 flex-1">{root ? <Workspace /> : <EmptyState />}</main>
      <StatusBar />
    </div>
  )
}
