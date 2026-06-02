# Codebase Map

Generated: 2026-05-28T12:20:50Z | Files: 348 | Described: 0/348
<!-- gsd:codebase-meta {"generatedAt":"2026-05-28T12:20:50Z","fingerprint":"d3065bc98c2c02537e65995a11901c78de64124b","fileCount":348,"truncated":false} -->

### (root)/
- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`
- `CODE_OF_CONDUCT.md`
- `components.json`
- `CONTRIBUTING.md`
- `dev-windows.cmd`
- `index.html`
- `LICENSE`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `README.md`
- `ROADMAP.md`
- `SECURITY.md`
- `settings.html`
- `TERAX.md`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`

### .github/
- `.github/CODEOWNERS`
- `.github/PULL_REQUEST_TEMPLATE.md`

### .github/ISSUE_TEMPLATE/
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`

### .github/workflows/
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

### scripts/
- `scripts/dev-windows.ps1`

### src/
- `src/main.tsx`
- `src/vite-env.d.ts`

### src-tauri/
- `src-tauri/.gitignore`
- `src-tauri/build.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/Info.plist`
- `src-tauri/installer-hooks.nsh`
- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.dev.windows.conf.json`
- `src-tauri/tauri.linux.conf.json`
- `src-tauri/tauri.windows.conf.json`

### src-tauri/capabilities/
- `src-tauri/capabilities/default.json`
- `src-tauri/capabilities/desktop.json`

### src-tauri/icons/
- `src-tauri/icons/icon.icns`

### src-tauri/icons/android/mipmap-anydpi-v26/
- `src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml`

### src-tauri/icons/android/values/
- `src-tauri/icons/android/values/ic_launcher_background.xml`

### src-tauri/src/
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`

### src-tauri/src/modules/
- `src-tauri/src/modules/agent.rs`
- `src-tauri/src/modules/mod.rs`
- `src-tauri/src/modules/net.rs`
- `src-tauri/src/modules/proc.rs`
- `src-tauri/src/modules/secrets.rs`
- `src-tauri/src/modules/workspace.rs`

### src-tauri/src/modules/fs/
- `src-tauri/src/modules/fs/file.rs`
- `src-tauri/src/modules/fs/grep.rs`
- `src-tauri/src/modules/fs/mod.rs`
- `src-tauri/src/modules/fs/mutate.rs`
- `src-tauri/src/modules/fs/search.rs`
- `src-tauri/src/modules/fs/tree.rs`
- `src-tauri/src/modules/fs/watch.rs`

### src-tauri/src/modules/git/
- `src-tauri/src/modules/git/commands.rs`
- `src-tauri/src/modules/git/errors.rs`
- `src-tauri/src/modules/git/mod.rs`
- `src-tauri/src/modules/git/operations.rs`
- `src-tauri/src/modules/git/parser.rs`
- `src-tauri/src/modules/git/process.rs`
- `src-tauri/src/modules/git/types.rs`
- `src-tauri/src/modules/git/utils.rs`

### src-tauri/src/modules/pty/
- `src-tauri/src/modules/pty/agent_detect.rs`
- `src-tauri/src/modules/pty/da_filter.rs`
- `src-tauri/src/modules/pty/job.rs`
- `src-tauri/src/modules/pty/mod.rs`
- `src-tauri/src/modules/pty/session.rs`
- `src-tauri/src/modules/pty/shell_init.rs`

### src-tauri/src/modules/pty/scripts/
- `src-tauri/src/modules/pty/scripts/bashrc.bash`
- `src-tauri/src/modules/pty/scripts/init.fish`
- `src-tauri/src/modules/pty/scripts/profile.ps1`
- `src-tauri/src/modules/pty/scripts/zlogin.zsh`
- `src-tauri/src/modules/pty/scripts/zprofile.zsh`
- `src-tauri/src/modules/pty/scripts/zshenv.zsh`
- `src-tauri/src/modules/pty/scripts/zshrc.zsh`

### src-tauri/src/modules/shell/
- `src-tauri/src/modules/shell/background.rs`
- `src-tauri/src/modules/shell/mod.rs`
- `src-tauri/src/modules/shell/ringbuffer.rs`
- `src-tauri/src/modules/shell/session.rs`

### src-tauri/tests/
- `src-tauri/tests/fs_search.rs`
- `src-tauri/tests/git_operations.rs`
- `src-tauri/tests/shell_background.rs`

### src-tauri/tests/common/
- `src-tauri/tests/common/mod.rs`

### src/app/
- `src/app/App.tsx`

### src/components/
- `src/components/WindowControls.tsx`

### src/components/ai-elements/
- `src/components/ai-elements/chat-code-lezer.ts`
- `src/components/ai-elements/chat-code.tsx`
- `src/components/ai-elements/context.tsx`
- `src/components/ai-elements/conversation.tsx`
- `src/components/ai-elements/markdown-code.tsx`
- `src/components/ai-elements/message.tsx`
- `src/components/ai-elements/reasoning.tsx`
- `src/components/ai-elements/shimmer.tsx`
- `src/components/ai-elements/snippet.tsx`
- `src/components/ai-elements/tool.tsx`

### src/components/ui/
- *(39 files: 39 .tsx)*

### src/lib/
- `src/lib/fonts.ts`
- `src/lib/launchDir.ts`
- `src/lib/platform.ts`
- `src/lib/shellQuote.test.ts`
- `src/lib/shellQuote.ts`
- `src/lib/use-mobile.ts`
- `src/lib/useZoom.ts`
- `src/lib/utils.ts`

### src/modules/agents/
- `src/modules/agents/index.ts`

### src/modules/agents/components/
- `src/modules/agents/components/AgentNotificationsBridge.tsx`
- `src/modules/agents/components/AgentToast.tsx`
- `src/modules/agents/components/NotificationBell.tsx`

### src/modules/agents/lib/
- `src/modules/agents/lib/agentIcon.tsx`
- `src/modules/agents/lib/notify.ts`
- `src/modules/agents/lib/review.ts`
- `src/modules/agents/lib/route.ts`
- `src/modules/agents/lib/types.ts`
- `src/modules/agents/lib/useWindowFocus.ts`

### src/modules/agents/store/
- `src/modules/agents/store/agentStore.ts`
- `src/modules/agents/store/managedAgentsStore.ts`

### src/modules/ai/
- `src/modules/ai/config.ts`
- `src/modules/ai/index.ts`

### src/modules/ai/agents/
- `src/modules/ai/agents/registry.ts`
- `src/modules/ai/agents/runSubagent.ts`

### src/modules/ai/components/
- `src/modules/ai/components/AgentRunBridge.tsx`
- `src/modules/ai/components/AgentStatusPill.tsx`
- `src/modules/ai/components/AgentSwitcher.tsx`
- `src/modules/ai/components/AiChat.tsx`
- `src/modules/ai/components/AiInputBar.layout.test.ts`
- `src/modules/ai/components/AiInputBar.tsx`
- `src/modules/ai/components/AiMiniWindow.tsx`
- `src/modules/ai/components/AiStatusBarControls.tsx`
- `src/modules/ai/components/AiToolApproval.tsx`
- `src/modules/ai/components/FilePicker.tsx`
- `src/modules/ai/components/lazy.tsx`
- `src/modules/ai/components/LocalAgentNotificationsBridge.tsx`
- `src/modules/ai/components/PlanDiffReview.tsx`
- `src/modules/ai/components/SelectionAskAi.tsx`
- `src/modules/ai/components/SnippetPicker.tsx`
- `src/modules/ai/components/TodoStrip.tsx`

### src/modules/ai/hooks/
- `src/modules/ai/hooks/useWhisperRecording.ts`
- `src/modules/ai/hooks/useWorkspaceFiles.ts`

### src/modules/ai/lib/
- `src/modules/ai/lib/agent.ts`
- `src/modules/ai/lib/agents.ts`
- `src/modules/ai/lib/compact.ts`
- `src/modules/ai/lib/composer.tsx`
- `src/modules/ai/lib/keyring.ts`
- `src/modules/ai/lib/miniWindowGeometry.test.ts`
- `src/modules/ai/lib/miniWindowGeometry.ts`
- `src/modules/ai/lib/modelPrefs.ts`
- `src/modules/ai/lib/native.ts`
- `src/modules/ai/lib/placeholders.ts`
- `src/modules/ai/lib/proxyFetch.ts`
- `src/modules/ai/lib/redact.ts`
- `src/modules/ai/lib/security.test.ts`
- `src/modules/ai/lib/security.ts`
- `src/modules/ai/lib/sessions.ts`
- `src/modules/ai/lib/slashCommands.ts`
- `src/modules/ai/lib/snippets.ts`
- `src/modules/ai/lib/todos.ts`
- `src/modules/ai/lib/transport.ts`
- `src/modules/ai/lib/useMiniWindowGeometry.ts`

### src/modules/ai/store/
- `src/modules/ai/store/agentsStore.ts`
- `src/modules/ai/store/chatStore.ts`
- `src/modules/ai/store/planStore.ts`
- `src/modules/ai/store/snippetsStore.ts`
- `src/modules/ai/store/todoStore.ts`

### src/modules/ai/tools/
- `src/modules/ai/tools/agent.ts`
- `src/modules/ai/tools/context.ts`
- `src/modules/ai/tools/edit.ts`
- `src/modules/ai/tools/fs.ts`
- `src/modules/ai/tools/search.ts`
- `src/modules/ai/tools/shell.ts`
- `src/modules/ai/tools/subagent.ts`
- `src/modules/ai/tools/terminal.ts`
- `src/modules/ai/tools/todo.ts`
- `src/modules/ai/tools/tools.ts`

### src/modules/editor/
- `src/modules/editor/AiDiffPane.tsx`
- `src/modules/editor/AiDiffStack.tsx`
- `src/modules/editor/AiDiffStackLazy.tsx`
- `src/modules/editor/EditorPane.tsx`
- `src/modules/editor/EditorStack.tsx`
- `src/modules/editor/EditorStackLazy.tsx`
- `src/modules/editor/GitDiffPane.tsx`
- `src/modules/editor/GitDiffStack.tsx`
- `src/modules/editor/GitDiffStackLazy.tsx`
- `src/modules/editor/index.ts`
- `src/modules/editor/NewEditorDialog.tsx`

### src/modules/editor/lib/
- `src/modules/editor/lib/colorSwatches.ts`
- `src/modules/editor/lib/diffCache.ts`
- `src/modules/editor/lib/extensions.ts`
- `src/modules/editor/lib/languageResolver.ts`
- `src/modules/editor/lib/themes.ts`
- `src/modules/editor/lib/useDocument.ts`
- `src/modules/editor/lib/vim.ts`

### src/modules/editor/lib/autocomplete/
- `src/modules/editor/lib/autocomplete/inlineExtension.ts`
- `src/modules/editor/lib/autocomplete/prompt.ts`
- `src/modules/editor/lib/autocomplete/provider.ts`

### src/modules/explorer/
- `src/modules/explorer/ExplorerSearch.tsx`
- `src/modules/explorer/FileExplorer.tsx`
- `src/modules/explorer/index.ts`
- `src/modules/explorer/InlineInput.tsx`
- `src/modules/explorer/TreeRow.tsx`

### src/modules/explorer/lib/
- `src/modules/explorer/lib/constants.ts`
- `src/modules/explorer/lib/contextActions.ts`
- `src/modules/explorer/lib/fileIcons.ts`
- `src/modules/explorer/lib/folderIcons.ts`
- `src/modules/explorer/lib/iconResolver.ts`
- `src/modules/explorer/lib/menuItemClass.ts`
- `src/modules/explorer/lib/useFileTree.ts`
- `src/modules/explorer/lib/watch.ts`

### src/modules/git-history/
- `src/modules/git-history/GitHistoryPane.tsx`
- `src/modules/git-history/GitHistoryStack.tsx`
- `src/modules/git-history/GitHistoryStackLazy.tsx`
- `src/modules/git-history/GraphRail.tsx`
- `src/modules/git-history/index.ts`

### src/modules/git-history/lib/
- `src/modules/git-history/lib/graph.ts`
- `src/modules/git-history/lib/remoteWebUrl.ts`

### src/modules/header/
- `src/modules/header/Header.tsx`
- `src/modules/header/index.ts`
- `src/modules/header/SearchInline.tsx`

### src/modules/markdown/
- `src/modules/markdown/index.ts`
- `src/modules/markdown/MarkdownPreviewPane.tsx`
- `src/modules/markdown/MarkdownStack.tsx`

### src/modules/preview/
- `src/modules/preview/index.ts`
- `src/modules/preview/PreviewAddressBar.tsx`
- `src/modules/preview/PreviewPane.test.ts`
- `src/modules/preview/PreviewPane.tsx`
- `src/modules/preview/PreviewStack.tsx`

### src/modules/settings/
- `src/modules/settings/openSettingsWindow.ts`
- `src/modules/settings/preferences.ts`
- `src/modules/settings/store.ts`

### src/modules/shortcuts/
- `src/modules/shortcuts/index.ts`
- `src/modules/shortcuts/shortcuts.ts`
- `src/modules/shortcuts/ShortcutsDialog.tsx`

### src/modules/shortcuts/lib/
- `src/modules/shortcuts/lib/useGlobalShortcuts.ts`

### src/modules/sidebar/
- `src/modules/sidebar/index.ts`
- `src/modules/sidebar/SidebarRail.tsx`
- `src/modules/sidebar/types.ts`

### src/modules/source-control/
- `src/modules/source-control/index.ts`
- `src/modules/source-control/SourceControlPanel.tsx`
- `src/modules/source-control/SourceControlPanelLazy.tsx`
- `src/modules/source-control/useSourceControl.ts`
- `src/modules/source-control/useSourceControlPanel.ts`

### src/modules/statusbar/
- `src/modules/statusbar/AiTools.tsx`
- `src/modules/statusbar/CwdBreadcrumb.tsx`
- `src/modules/statusbar/index.ts`
- `src/modules/statusbar/StatusBar.tsx`
- `src/modules/statusbar/WorkspaceEnvSelector.tsx`

### src/modules/statusbar/lib/
- `src/modules/statusbar/lib/pathUtils.ts`

### src/modules/tabs/
- `src/modules/tabs/index.ts`
- `src/modules/tabs/TabBar.tsx`

### src/modules/tabs/lib/
- `src/modules/tabs/lib/useTabs.ts`
- `src/modules/tabs/lib/useWorkspaceCwd.ts`

### src/modules/terminal/
- `src/modules/terminal/index.ts`
- `src/modules/terminal/PaneTreeView.tsx`
- `src/modules/terminal/TerminalPane.tsx`
- `src/modules/terminal/TerminalStack.tsx`

### src/modules/terminal/lib/
- `src/modules/terminal/lib/dormantRing.ts`
- `src/modules/terminal/lib/keymap.test.ts`
- `src/modules/terminal/lib/keymap.ts`
- `src/modules/terminal/lib/osc-handlers.test.ts`
- `src/modules/terminal/lib/osc-handlers.ts`
- `src/modules/terminal/lib/panes.ts`
- `src/modules/terminal/lib/pty-bridge.ts`
- `src/modules/terminal/lib/rendererPool.ts`
- `src/modules/terminal/lib/useTerminalSession.ts`

### src/modules/theme/
- `src/modules/theme/applyTheme.ts`
- `src/modules/theme/bgImageStore.ts`
- `src/modules/theme/customThemes.ts`
- `src/modules/theme/index.ts`
- `src/modules/theme/SurfaceLayer.tsx`
- `src/modules/theme/themeFiles.ts`
- `src/modules/theme/ThemeProvider.tsx`
- `src/modules/theme/types.ts`
- `src/modules/theme/validateTheme.ts`

### src/modules/theme/themes/
- `src/modules/theme/themes/caffeine.ts`
- `src/modules/theme/themes/catppuccin.ts`
- `src/modules/theme/themes/claude.ts`
- `src/modules/theme/themes/gruvbox.ts`
- `src/modules/theme/themes/index.ts`
- `src/modules/theme/themes/nord.ts`
- `src/modules/theme/themes/rose-pine.ts`
- `src/modules/theme/themes/sage.ts`
- `src/modules/theme/themes/terax-default.ts`
- `src/modules/theme/themes/tide.ts`
- `src/modules/theme/themes/tokyo-night.ts`

### src/modules/updater/
- `src/modules/updater/index.ts`
- `src/modules/updater/UpdaterDialog.tsx`
- `src/modules/updater/useUpdater.ts`

### src/modules/workspace/
- `src/modules/workspace/env.ts`
- `src/modules/workspace/index.ts`

### src/settings/
- `src/settings/main.tsx`
- `src/settings/SettingsApp.tsx`

### src/settings/components/
- `src/settings/components/ProviderIcon.tsx`
- `src/settings/components/ProviderKeyCard.tsx`
- `src/settings/components/SectionHeader.tsx`
- `src/settings/components/SettingRow.tsx`

### src/settings/sections/
- `src/settings/sections/AboutSection.tsx`
- `src/settings/sections/AgentsSection.tsx`
- `src/settings/sections/GeneralSection.tsx`
- `src/settings/sections/ModelsSection.tsx`
- `src/settings/sections/ShortcutsSection.tsx`
- `src/settings/sections/ThemesSection.tsx`

### src/styles/
- `src/styles/code-highlight.css`
- `src/styles/fonts.css`
- `src/styles/globals.css`
- `src/styles/terminalTheme.ts`
- `src/styles/tokens.ts`
