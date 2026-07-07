# Pi sidebar merge conflict audit

Generated on 2026-07-07 and refreshed after the updater key rotation verifier from local `pi-sidebar` head `41670621e7151ff5fdcb5525c8420f06cd3604f8` against `origin/main` at `78a0b3dd79554ad4af89e61d97004f3475cd9953`.

## Commands used

```bash
git fetch origin main
git rev-parse HEAD origin/main
git rev-list --left-right --count origin/main...HEAD
git merge-tree --write-tree HEAD origin/main > /tmp/merge-tree-pi-sidebar-updater-verifier.txt 2>&1
gh workflow view CI --repo crynta/terax-ai --yaml
gh workflow list --repo crynta/terax-ai --limit 50
gh workflow list --repo mehmetcanbudak/terax-ai --limit 50
gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 20
gh run list --repo mehmetcanbudak/terax-ai --limit 10
gh workflow run CI --repo mehmetcanbudak/terax-ai --ref pi-sidebar
gh workflow run CI --repo crynta/terax-ai --ref pi-sidebar
gh pr checks 964 --repo crynta/terax-ai
```

## Result

`git merge-tree --write-tree HEAD origin/main` still exits `1` with 99 conflicted paths. This is not a safe local auto-merge. The conflicts span GitHub Actions, package and lock files, Rust backend modules, the app shell, legacy AI surfaces, command palette, editor, explorer, header, sidebar, status bar, tabs, terminal, theme, settings, styles, and Vite config.

CI is also externally blocked for this fork PR:

- Base repo CI is active, but the current base/default `.github/workflows/ci.yml` has only `pull_request` and `push` triggers for `main`; it has no `workflow_dispatch` trigger until maintainers accept or merge this branch's workflow update.
- `gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 20` returns no runs.
- `gh workflow list --repo mehmetcanbudak/terax-ai --limit 50` and `gh run list --repo mehmetcanbudak/terax-ai --limit 10` return no fork workflows or runs.
- Dispatch probes remain blocked: the fork returns "could not find any workflows named CI"; the base repo returns HTTP 403 "Must have admin rights to Repository" for manual dispatch from this account.
- `gh pr checks 964 --repo crynta/terax-ai` shows CodeRabbit pass/skipped only, with no GitHub Actions checks visible.
- Recent `main` CI runs on `crynta/terax-ai` are green, but that is not proof for PR #964.

## Conflicted paths

```text
.github/workflows/ci.yml
biome.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
src-tauri/Cargo.lock
src-tauri/Cargo.toml
src-tauri/Info.plist
src-tauri/src/lib.rs
src-tauri/src/modules/agent.rs
src-tauri/src/modules/fs/grep.rs
src-tauri/src/modules/fs/mutate.rs
src-tauri/src/modules/fs/search.rs
src-tauri/src/modules/fs/tree.rs
src-tauri/src/modules/git/operations.rs
src-tauri/src/modules/mod.rs
src-tauri/src/modules/proc/job.rs
src-tauri/src/modules/proc/mod.rs
src-tauri/src/modules/pty/agent_detect.rs
src-tauri/src/modules/pty/mod.rs
src-tauri/src/modules/pty/session.rs
src-tauri/src/modules/workspace.rs
src-tauri/tests/fs_search.rs
src/app/App.tsx
src/components/ai-elements/context.tsx
src/components/ai-elements/shimmer.tsx
src/components/ui/breadcrumb.tsx
src/lib/use-mobile.ts
src/modules/agents/components/AgentNotificationsBridge.tsx
src/modules/agents/components/AgentToast.tsx
src/modules/agents/components/NotificationBell.tsx
src/modules/agents/lib/agentIcon.tsx
src/modules/ai/components/AgentRunBridge.tsx
src/modules/ai/components/AgentStatusPill.tsx
src/modules/ai/components/AiChat.tsx
src/modules/ai/components/AiInputBar.tsx
src/modules/ai/components/AiMiniWindow.tsx
src/modules/ai/components/AiStatusBarControls.tsx
src/modules/ai/components/SelectionAskAi.tsx
src/modules/ai/components/lazy.tsx
src/modules/ai/index.ts
src/modules/ai/lib/composer.tsx
src/modules/ai/lib/transport.ts
src/modules/ai/store/chatStore.ts
src/modules/command-palette/CommandPalette.tsx
src/modules/command-palette/commands.ts
src/modules/command-palette/index.ts
src/modules/command-palette/useWorkspaceFileSearch.ts
src/modules/editor/AiDiffPane.tsx
src/modules/editor/AiDiffStackLazy.tsx
src/modules/editor/EditorPane.tsx
src/modules/editor/EditorStack.tsx
src/modules/editor/EditorStackLazy.tsx
src/modules/editor/GitDiffPane.tsx
src/modules/editor/GitDiffStackLazy.tsx
src/modules/editor/NewEditorDialog.tsx
src/modules/editor/lib/autocomplete/inlineExtension.ts
src/modules/editor/lib/extensions.ts
src/modules/editor/lib/languageResolver.ts
src/modules/editor/lib/themes.ts
src/modules/editor/lib/useDocument.ts
src/modules/explorer/ExplorerSearch.tsx
src/modules/explorer/FileExplorer.tsx
src/modules/explorer/TreeRow.tsx
src/modules/header/Header.tsx
src/modules/header/SearchInline.tsx
src/modules/markdown/MarkdownPreviewPane.tsx
src/modules/markdown/index.ts
src/modules/preview/index.ts
src/modules/settings/store.ts
src/modules/shortcuts/ShortcutsDialog.tsx
src/modules/shortcuts/index.ts
src/modules/sidebar/SidebarRail.tsx
src/modules/sidebar/index.ts
src/modules/source-control/SourceControlPanel.tsx
src/modules/statusbar/AiTools.tsx
src/modules/statusbar/CwdBreadcrumb.tsx
src/modules/statusbar/StatusBar.tsx
src/modules/tabs/TabBar.tsx
src/modules/tabs/index.ts
src/modules/tabs/lib/useTabs.ts
src/modules/terminal/PaneTreeView.tsx
src/modules/terminal/TerminalPane.tsx
src/modules/terminal/TerminalStack.tsx
src/modules/terminal/index.ts
src/modules/terminal/lib/dormantRing.ts
src/modules/terminal/lib/rendererPool.ts
src/modules/terminal/lib/useTerminalSession.ts
src/modules/theme/ThemeProvider.tsx
src/modules/theme/index.ts
src/settings/SettingsApp.tsx
src/settings/components/ProviderIcon.tsx
src/settings/main.tsx
src/settings/sections/GeneralSection.tsx
src/settings/sections/ModelsSection.tsx
src/settings/sections/ShortcutsSection.tsx
src/settings/sections/ThemesSection.tsx
src/styles/globals.css
vite.config.ts
```

## Maintainer resolution path

1. Reconcile PR #964 with current `main` in a maintainer-owned branch or worktree.
2. Preserve the webview-native Pi boundary: no Node Pi sidecar, no `sidecars/pi-host`, and no model-visible tool execution outside `pi_agent_tool_execute`.
3. Re-run the local verification matrix from `docs/pi-sidebar-release-readiness.md` after conflict resolution.
4. Trigger base-repo CI so the Linux e2e job can run `e2e/specs/pi-approval.e2e.mjs` through `tauri-driver`.
