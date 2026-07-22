<!--
PR title should follow Conventional Commits - it becomes the squash commit message.
Examples: feat(terminal): add split panes / fix(explorer): close button alignment
-->

## What

Adds a new `src/modules/repo` module that recursively discovers git repositories (root, submodule, nested) within a workspace, capped by depth, result count, and wall-clock time budgets. A dropdown picker in `WorkspaceSurface` lets users switch between detected repos when multiple are found.

## Why

Workspaces often contain multiple git repositories (monorepos, submodules, nested clones). Without discovery, the app only knows about the workspace root and can't distinguish between repos. This feature is the foundation for scoping terminals, editors, and source-control views to a specific repository.

## How

- **Bounded lazy walk** — `discoverRepositories()` runs only when the workspace root changes (not at startup, not on a timer). It recurses up to `maxDepth: 3` directories, returns at most `maxResults: 20` repos, and hard-aborts after `timeoutSecs: 150ms` via `performance.now()` checks before every directory read.

- **`.git` as directory vs file** — `.git` directories are recognized and added without descending into them. `.git` files (submodule pointers) are read and parsed for `gitdir: <path>`, with relative paths resolved via `@tauri-apps/api/path.join`.

- **Symlink containment** — Both the workspace root and every candidate repo root are canonicalized via `native.canonicalize()`. A `startsWith(realWorkspaceRoot)` check ensures only repos within the workspace boundary are included. A `seenRealPaths` Set deduplicates repos reachable through multiple symlink paths.

- **Repo picker UI** — A `DropdownMenu` in `WorkspaceSurface` (top-right) appears only when 2+ repos are detected. Shows repo name, type badge for submodules/nested, and a checkmark for the active selection.

- **React hook** — `useRepoDiscovery` wraps the async call with sequence-number deduplication (stale-result suppression), cancellation on unmount, and selection preservation across re-discoveries.

- **Zero new dependencies** — Uses only the existing `native` Tauri IPC bridge and `@tauri-apps/api/path` (both already in the project). No `fs.watch`, no polling, no background threads.

## Testing

- [x] `pnpm lint` clean
- [x] `pnpm check-types` clean
- [x] `pnpm test` clean (486/486 tests pass, including 10 new tests for `discoverRepositories`)
- [ ] Manual smoke-test of the affected feature
- [ ] (If UI) tested in `pnpm tauri dev`
- [ ] Platforms tested: macOS
- [ ] Shells tested (if relevant): n/a

### Unit tests (`src/modules/repo/discover.test.ts`)

10 tests covering:
- Empty workspace → `[]`
- Root repo detection
- Canonicalize-based deduplication
- `maxResults` cap
- `maxDepth` cap
- `.git` file (submodule pointer) parsing
- Graceful skip of unreadable directories
- Hidden directory skipping (`.hidden` → skipped, `.git` → processed)
- Sort order (root first, then alphabetical)
- `canonicalize` failure fallback to manual normalization

## Screenshots / GIFs

*(TODO: add screenshot of the repo picker dropdown in a multi-repo workspace)*

## Notes for reviewer

- The 150ms timeout and 20-repo cap are conservative defaults. If workspaces with many repos are common, these may need tuning — they're easy to adjust via `DiscoverOptions`.
- `getRepoName` extracts the basename of the repo root path. For repos with identical directory names (e.g. two `lib/` folders), the name alone won't disambiguate — a follow-up could append the relative parent path.
- The repo picker currently only switches `currentRepoRoot` state. Wiring it to scope terminal/editor/git-history views to the selected repo is left for a follow-up to keep this PR focused.
- `@tauri-apps/api/path.join` returns `Promise<string>` (async), which is why every `join()` call is awaited. This is consistent with Tauri v2's webview API.
- No `src-tauri/` changes in this PR.
