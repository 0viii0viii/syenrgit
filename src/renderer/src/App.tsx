import { useEffect } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { TitleBar } from '@/components/layout/TitleBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { RefTree } from '@/components/layout/RefTree'
import { RepoTabs } from '@/components/layout/RepoTabs'
import { ChangeList } from '@/features/changes/ChangeList'
import { CommitBox } from '@/features/changes/CommitBox'
import { DiffPanel } from '@/features/diff/DiffView'
import { StagingDiff } from '@/features/diff/StagingDiff'
import { CommitList } from '@/features/history/CommitList'
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
  const tab = useRepo((s) => s.tab)
  const setTab = useRepo((s) => s.setTab)
  const mergePath = useMerge((s) => s.path)

  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize="18%" minSize="12%" maxSize="32%">
        <RefTree />
      </ResizablePanel>
      <ResizableHandle />

      <ResizablePanel defaultSize="38%" minSize="22%">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'changes' | 'history')}
          className="flex h-full min-h-0 flex-col gap-0"
        >
          <TabsList className="h-7 w-full shrink-0 justify-start rounded-none border-b border-border-subtle bg-surface-app p-0">
            <TabsTrigger value="changes" className="h-7 rounded-none px-3 text-xs">
              Changes
            </TabsTrigger>
            <TabsTrigger value="history" className="h-7 rounded-none px-3 text-xs">
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="changes" className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <ChangeList />
            </div>
            <CommitBox />
          </TabsContent>
          <TabsContent value="history" className="flex min-h-0 flex-1 flex-col">
            <HistoryFilter />
            <div className="min-h-0 flex-1">
              <CommitList />
            </div>
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <ResizableHandle />

      <ResizablePanel defaultSize="44%">
        {tab === 'changes' ? (
          mergePath ? (
            <MergeEditor />
          ) : (
            <StagingDiff />
          )
        ) : (
          <HistoryPane />
        )}
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
