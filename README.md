# syenrgit

A desktop Git client. Electron + React + Tailwind v4 + shadcn/ui.

Scope: a Git GUI, not an IDE. Full history/diff browsing, staging, and conflict
resolution — no general-purpose code editing.

## Why Electron (and not Tauri)

The decision hinges on how the app talks to Git, not on the shell:

- We **shell out to the `git` binary** rather than binding libgit2. Hooks,
  credential helpers, LFS, submodules, sparse-checkout and conflict-style
  semantics then behave exactly as they do on the command line, with nothing to
  reimplement and drift out of sync. libgit2's divergence on conflict handling
  in particular is a known source of wrong-side merges.
- With Git in a subprocess, the host language is not the bottleneck, which
  removes Rust's main advantage.
- The diff and merge views are the hard part of the product, and the mature
  implementations are web-based and Chromium-tested. Tauri's system WebView
  (WKWebView on macOS, WebKitGTK on Linux) makes large-diff rendering vary by
  OS version.

## Architecture

```
src/
├── main/                 Node — the only place that runs git
│   ├── git/
│   │   ├── exec.ts       spawn wrapper; base flags, env, error type
│   │   ├── repo.ts       discovery, in-progress operation, conflict labels
│   │   ├── status.ts     `--porcelain=v2 -z` parser
│   │   ├── diff.ts       unified diff parser
│   │   ├── log.ts        commit log, commit detail, name-status
│   │   ├── graph.ts      commit graph lane layout
│   │   ├── refs.ts       branches, remotes, tags, stashes
│   │   └── conflict.ts   index stages 1/2/3, resolution
│   ├── ipc/              typed handlers
│   ├── watcher.ts        debounced fs watch per open repo
│   └── window.ts
├── preload/              contextBridge — the entire renderer surface
├── shared/               types, IPC channel names, merge assembly
│                         (no Node, no DOM)
└── renderer/src/
    ├── styles/tokens/    the design system (see below)
    ├── components/ui/    shadcn/ui — CLI-managed, do not hand-edit
    ├── features/         changes, diff, history, conflict
    └── stores/           zustand (workspace owns the tabs)
```

### Conflict resolution

Conflicts are read from the **index stages**, never by parsing `<<<<<<<`
markers out of the working-tree file:

```
git show :1:path   # merge base
git show :2:path   # ours
git show :3:path   # theirs
```

Marker parsing breaks on nested conflicts, on files whose own content contains
marker-like lines, and on any file the user has already started editing. A
missing stage is meaningful — an add/add conflict has no stage 1 — so
`ConflictStages` models each side as nullable.

Resolving = write the file, then `git add`, which collapses the three stages to
stage 0.

Note that during a **rebase** the sides are swapped relative to a merge: "ours"
is the upstream being replayed onto. `conflictLabels()` derives the labels from
the in-progress operation so the UI never shows them backwards.

### Commit graph

`graph.ts` lays commits out into lanes. A lane is a stable column index holding
the hash it is waiting to reach; lanes are **never compacted mid-graph**, so a
line is straight whenever its endpoints share an index and the renderer only
curves on a real branch or merge. (`git log --graph` compacts instead, which is
fine for a one-shot terminal dump but makes columns jump while scrolling.)

Edges span the band *between* two rows, and a band is only determined once the
row below is known — that is where lanes converge onto a node. So each row's
edges are emitted one iteration late. `laneOrigins[j]` is a list rather than a
scalar because a lane can receive two lines at once: its own continuation from
above plus a merge diagonal from another lane.

The SVG is a single element behind the rows, not one per row, because a per-row
SVG clips every diagonal at its boundary. Its geometry is measured from the
design tokens (`--layout-row-height`, `--graph-lane-width`, ...) via a probe
element, so the graph cannot drift out of alignment with the CSS.

History walks `--branches --tags --remotes HEAD`, deliberately not `--all`:
`--all` includes `refs/stash`, and a stash entry is a merge commit, so stashes
would appear in the graph as extra commits with a merge node.

### Refresh scoping

The watcher tags each debounced change as `worktree` or `git`. A worktree write
only invalidates the status and the open diff; only a `.git` write (commit,
checkout, fetch, rebase step) can move history. Reloading a 500-commit log on
every file save would hammer git during a build.

### Repository tabs

Several repositories are open at once, GitKraken-style: a tab per repository
with a `+` to add another, and free switching between them.

The strip is the **top row of the window** — a repository is the outermost
thing in git, with branches, history and files all living inside one, so it
sits above the branch toolbar rather than under it. It doubles as the window
drag region and carries the macOS traffic-light inset, so it renders even with
nothing open; otherwise the window would lose its drag handle and its only
always-available way to open a repository.

The individual stores stay single-repo; `stores/workspace.ts` is the only place
that knows tabs exist. Switching away captures a snapshot of the repo/history stores and
switching back restores it, so a tab returns with its selection, scroll and
loaded history intact.

Adding a tab does not wait on its watcher. Attaching recursive watchers spawns
git and can take long enough that a new tab would visibly appear inactive
before selecting itself.

Every open repo is watched, not just the visible one — but a change to a
background repo only **marks its tab stale** (a dot on the tab) and drops its
snapshot. Reloading a 500-commit history for a repository nobody is looking at
is wasted work, and leaving it silently stale is worse. The watcher therefore
keys its debounce state per repository and tags each push with the root it came
from.

The open tabs are remembered in `localStorage`; on start each remembered path
is re-resolved through `git rev-parse`, because a repository may have been
moved or deleted since the last run. Restore adds every tab but activates only
one — the rest load when first opened.

### Merging and committing

Right-click a branch to check it out or merge it into the current one; the
commit box at the foot of the change list finishes the job. During a merge it
prefills git's own `MERGE_MSG` (minus the commented `Conflicts:` block, which
is guidance for an editor session, not part of the message) and commits the
merge — the same `git commit` either way, since git decides from `MERGE_HEAD`
whether the result has one parent or two.

Conflicts are a normal outcome of `git merge`, not a failure: git exits
non-zero and leaves the merge in progress. Only a refusal to *start* — dirty
worktree, unknown ref, unrelated histories — is an error, and the two are told
apart by whether `MERGE_HEAD` exists afterwards.

Every action reloads status, history and refs rather than patching local
state. A merge or a checkout moves HEAD, refs, the index and the worktree at
once, and guessing at the result is how a git GUI ends up showing something
the repository does not contain.

Hooks stay enabled throughout — running the user's `pre-commit` and
`commit-msg` hooks exactly as the command line would is the whole reason this
app shells out to git.

Taking one side of a whole-file conflict checks that side's index stage first.
When the chosen side deleted the path there is no blob to check out, and
"take ours" means accepting the deletion — `git checkout --ours` fails outright
on a delete/modify conflict.

### Remotes

Fetch, pull and push sit in the branch toolbar, with the ahead/behind counts on
the buttons themselves. Tags are pushed separately — from a tag's context menu,
or "Push all tags" — because cutting a release is not the same act as
publishing the branch it sits on, and `--tags` on a branch push would send
unrelated tags along with it.

Credential prompts are disabled in `exec.ts` so a GUI subprocess can never hang
on a tty that does not exist. The cost is that a remote needing credentials
fails with git's raw plumbing message, so `remote.ts` translates the common
ones — missing credentials, a rejected SSH key, an unreachable host, a
non-fast-forward push — into something a user can act on.

Force push is offered only as `--force-with-lease`. Plain `--force` silently
discards commits someone else pushed in the meantime.

### Rebase

A stopped rebase is driven from the status bar: Continue (disabled until the
conflicts are staged), Skip, Abort. Conflicts resolve through the same merge
editor as a merge — with the sides swapped, since during a rebase "ours" is the
upstream being replayed onto.

Interactive and non-interactive rebases are **not** distinguished. Since git
2.26 the merge backend is the default and writes `rebase-merge/interactive` for
both, so the marker no longer means what its name says; claiming "Interactive
rebase" for a plain `git rebase` was worse than saying nothing.

### Stash

Stash from the commit box, apply/pop/drop from a stash's context menu.
A conflicting apply is an outcome rather than a failure — but note git leaves
no `MERGE_HEAD` behind for it, so the repository reports no operation in
progress even though there are unmerged paths.

Stashing is not offered mid-merge: git allows it, but restoring a half-finished
merge later is a trap.

### Cherry-pick and revert

Both are git's *sequencer* operations: they replay commits one at a time, stop
on a conflict, and are driven afterwards with the same three verbs as a rebase.
They share one module for that reason, and the status bar drives all three.

Reverting a merge passes `--mainline 1`. Git refuses to revert a merge without
being told which parent is the mainline, because "the change" a merge
introduces depends on which side you read it from; the first parent is the
branch that did the merging in every normal workflow.

### Interactive rebase

Right-click a commit → "Rebase interactively from here". The dialog lists the
commits oldest-first — the order git writes into its todo file — with reorder
arrows and a per-commit action.

git opens the todo in `$GIT_SEQUENCE_EDITOR`, appending the file path to
whatever that variable holds. Pointing it at a copy command therefore replaces
the todo with the plan, with no editor and no helper script on disk. git still
does all the replaying.

`reword` is **not** offered. It opens the commit-message editor, and this app
runs git with no editor so a subprocess can never block on one; offering it
would silently keep the original message, which is worse than not offering it.

A rebase's progress is read from the `rebase-merge` / `rebase-apply`
directories, never from `REBASE_HEAD` — that ref survives a *successful* rebase
containing a squash or fixup, so testing it reports a finished rebase as still
running.

### Deleting refs

Branch deletion offers the unforced and forced forms as separate entries rather
than one with a confirmation: the unforced delete refuses to drop commits that
exist nowhere else, and that refusal is the whole safety of the operation.

Still missing: submodules, worktrees, bisect, and reflog browsing.

### The merge editor

Chunks come from two two-way diffs against the base rather than from
`diff3MergeRegions`, because a 3-pane editor needs the base/ours/theirs ranges
for *every* region — including the auto-merged ones, where the library reports
only the winning side's text.

Chunks are classified into five kinds, and the four decided ones are still
rendered and tinted. A merge tool that folds one side's change silently into
"context" is how people lose work:

| kind | meaning |
|---|---|
| `unchanged` | all three sides agree |
| `ours` / `theirs` | only that side changed — auto-merged |
| `both-same` | both sides made the identical change |
| `conflict` | both changed, differently — needs the user |

Two things that bite:

- **Positions are tracked incrementally, not through a base→side index map.**
  A map is ambiguous at a pure insertion: base index *i* corresponds to both
  "before" and "after" the inserted lines, and resolving that the wrong way
  makes the preceding stable region swallow the insert.
- **"Both" concatenates text, not arrays.** A trailing `''` is the newline that
  terminates the first side, not a blank line. Appending naively puts a
  spurious empty line between the two sides on every conflict that reaches end
  of file — which is every add/add conflict.

Lines are produced with a plain `split('\n')`, so `join('\n')` reproduces the
original bytes exactly and a "no newline at end of file" difference stays
visible to the diff instead of being normalised away.

Non-content conflicts (`add-add` has no base; `deleted-by-us`,
`deleted-by-them` and `binary` cannot merge line-by-line) get a whole-file
decision instead of a chunk list.

The algorithm is checked against git itself: 400 randomised three-way merges,
where every clean merge must be byte-identical to `git merge-file -p` and every
merge git reports as conflicting must be flagged as conflicting here.

### Scoping the graph to a ref

Clicking a branch or tag in the ref tree limits the commit graph to what is
reachable from it — plain click solos a ref, cmd/ctrl-click adds one so two
branches can be compared in a single graph, and clicking the soloed ref again
clears back to everything. A chip bar above the list shows what is in scope;
it is not rendered at all when nothing is filtered, since a permanent "showing
everything" row costs a row of height to say nothing.

Two modes sit in that bar. **Reachable** shows every commit the selected refs
can reach; **Only on these** shows the commits unique to them — the "what's new
on this branch" view.

The naive way to build the second one, `git log <ref> --not --branches --tags
--remotes`, returns nothing for any branch that has been pushed: its own
remote-tracking counterpart contains the same commits. So a ref's counterpart
travels with it, in both directions, and the exclusion is expressed as
`--exclude` patterns in front of `--glob` rather than by enumerating every
other ref by name — a repo with thousands of branches would otherwise blow up
argv. The excludes have to be repeated before each glob, since git resets them.

An empty result there is a real answer — the branch is fully merged — so the
list says so rather than reading like a failure. Dropping the last ref also
disarms the mode: with no filter it has nothing to mean, and leaving it armed
would silently change what the next filter shows.

The scope is a list of **full** ref names (`refs/heads/x`, `refs/tags/v1`), not
short names, because a tag and a branch can share a short name and `git log`
would have to guess.

Clicking a ref also switches to the History tab: filtering has no effect on the
Changes view, so without that the click looks like it did nothing.

A scoped ref can vanish while it is still selected — the branch gets deleted,
the tag removed, the remote pruned. `git log` then fails on an unknown
revision, so the store drops the filter and reloads the full graph rather than
leaving a stale list sitting behind an error.

### Virtualization

Every unbounded list is windowed with `@tanstack/react-virtual`: the commit
history, the changed-file list, the ref tree, and the diff. Rows are fixed
heights read from the design tokens, so `estimateSize` is exact and no row is
ever measured after mount.

Three things that are not obvious:

- **The graph SVG is windowed too.** It stays sized to the full list, but only
  the rows in view emit paths and nodes. Edge emission starts one row earlier
  than node emission, because a row's edges are drawn in the band *below* it —
  without the extra row the topmost visible commit has no line arriving into it.
- **The diff's width cannot come from its contents.** Only the visible lines are
  mounted, so the container is sized from the longest line and the measured
  monospace character advance; otherwise the horizontal scrollbar would resize
  on every scroll. The line-number gutter is likewise sized from the widest
  line number actually present — a fixed width collides the two columns once
  files reach four digits.
- **Sticky section headers need `rangeExtractor`.** The pinned header is
  normally scrolled out of the window, so it is forced into the rendered set
  explicitly or it would vanish while its own group is still on screen.

Sections in the ref tree are tracked as an opt-in expanded set rather than an
opt-out collapsed one: remote section ids are derived from remote names, so a
collapsed-by-default list cannot enumerate them, and a repo with thousands of
remote-tracking branches should not expand them unasked.

## Design tokens

Three layers, each referencing only the one below it:

| Layer         | File                           | Contains                                                                                       |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1. Primitives | `styles/tokens/primitives.css` | The only literal values in the codebase — palette ramps, spacing, radii, type scale, motion    |
| 2. Semantic   | `styles/tokens/semantic.css`   | Roles (`--surface-raised`, `--content-secondary`) + the shadcn variable contract               |
| 3. Domain     | `styles/tokens/git.css`        | Git meaning — diff add/delete, conflict base/ours/theirs, file status, ref badges, graph lanes |

`globals.css` bridges them into Tailwind with `@theme inline`, which keeps the
`var()` at the use site. So `.bg-diff-add-bg` compiles to
`background-color: var(--diff-add-bg)` and the `.dark` overrides in layer 2 and
3 apply with no utility regeneration.

**Rules**

- Components use Tailwind utilities (`bg-surface-default`, `text-status-added`).
- Components never reference `--p-*` primitives.
- Applying a visual design = rewriting layer 1 and the mapping in layer 2.
  Component files should not need to change.

## Installing

Download an installer from the [releases page](https://github.com/0viii0viii/syenrgit/releases).

- **Windows** — `syenrgit-<version>-win-x64.exe`, a per-user NSIS installer, so
  it needs no administrator rights.
- **macOS** — `syenrgit-<version>-mac-<arch>.dmg`. Pick `arm64` for Apple
  silicon, `x64` for Intel.

Neither build is code-signed yet, so both operating systems will warn on first
launch. On Windows, choose "More info" then "Run anyway"; on macOS,
right-click the app and choose Open, or run
`xattr -dr com.apple.quarantine /Applications/syenrgit.app`.

The app checks GitHub for a new release shortly after launch and every six
hours, downloads it in the background, and offers "Restart to update" in the
status bar. On macOS this only works from `/Applications` — Squirrel refuses to
swap a bundle running from elsewhere — and the app says so instead of
downloading an update it cannot install.

## Test repositories

```
pnpm fixtures              # build all three
pnpm fixtures conflicts    # rebuild just one
```

Throwaway repos land in `fixtures/` (gitignored), so they can be deleted or
regenerated at any time. Open them with the `+` in the tab strip.

| repo | what it exercises |
|---|---|
| `webapp` | ~25 commits over three months, five branches, three merges, three tags, a remote with `main` ahead by 2, two stashes, and a working tree covering every file state — staged, unstaged, renamed, deleted, untracked. Includes a 3000-line file with a large diff and a binary file. |
| `conflicts` | Parked mid-merge with all five conflict kinds: a content conflict (two real conflicts plus one region auto-merged from each side and one both sides changed identically), add/add, delete/modify in both directions, and a binary conflict. |
| `tiny` | Two commits. Useful when testing tabs. |

Commit timestamps are spread across the window with deterministic jitter —
a fixed step would land every commit inside the same day and the relative-time
column would read "2mo" all the way down.

## Commands

```
pnpm dev           # electron-vite dev server with HMR
pnpm build         # typecheck + bundle + token check
pnpm test          # integration suites against real repositories
pnpm typecheck     # main and renderer are checked separately
pnpm check:tokens  # see below (needs a build first)
pnpm icon          # regenerate build/icon.png
pnpm build:win     # package a Windows installer locally
pnpm build:mac     # package a macOS dmg locally
```

`pnpm test` runs everything in `tests/`. They are integration tests by
necessity: each suite builds throwaway repositories in the OS temp directory
and drives the real `git` binary, which is the only honest way to check code
whose entire job is talking to git. The merge suite goes further and diffs its
output against `git merge-file` across 400 randomised three-way merges.

## Releasing

Push a tag and the release workflow packages both platforms and uploads them
to a GitHub release:

```
npm version patch    # or minor / major — commits and tags
git push --follow-tags
```

`electron-builder` writes `latest.yml` (Windows) and `latest-mac.yml` (macOS)
alongside the installers. Those manifests are what `electron-updater` reads, so
they must land in the same release as the binaries — which is why both
platforms publish into one draft.

`check:tokens` fails the build when a component uses a Tailwind utility that
generates no CSS. This catches a failure mode specific to a token-driven design
system: a semantic token exists (`--accent-bg`) but was never bridged into
`@theme inline` (`--color-accent-bg`), so `bg-accent-bg` compiles to nothing.
Types pass, the build passes, and the element just renders unstyled.

`exactOptionalPropertyTypes` is on for `src/main` and off for the renderer,
because shadcn/ui components are CLI-regenerated and Radix's prop types are not
written against that flag.

Add shadcn components with `pnpm dlx shadcn@latest add <name>` — they land in
`src/renderer/src/components/ui/` and inherit the token system automatically.
