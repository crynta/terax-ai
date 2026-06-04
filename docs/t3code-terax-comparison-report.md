# T3 Code vs Terax feature and gap report

Date: 2026-06-05

## Purpose

This report inventories T3 Code and Terax, compares the two products, and turns the comparison into an improvement backlog for Terax. The recommendation is to keep Terax as the foundation and borrow selected T3 Code product and architecture ideas without moving Terax to an Electron or Node-owned runtime model.

This is the full research audit. For execution planning, use the shorter companion roadmap in [`terax-agent-runtime-roadmap.md`](./terax-agent-runtime-roadmap.md).

## Executive summary

T3 Code is an agent-first coding workspace. Its strongest areas are project and thread orchestration, provider driver abstraction, remote environment pairing, source-control integrations, and event-driven server architecture.

Terax is a terminal-first native development environment. Its strongest areas are native terminal performance, Rust-owned OS boundaries, Rust-mediated AI tool execution, compact desktop UX, and the current Pi sidebar integration. For Terax, Rust and Tauri remain the better foundation because the app is fundamentally about terminals, shells, files, git, keychain, and safe agent tooling.

The best path is:

1. Keep Terax as the base.
2. Keep Rust as the OS authority.
3. Keep the Pi sidecar constrained.
4. Borrow T3 Code ideas at the product and contract level.
5. Avoid copying T3 Code's Node server ownership model.

Second-pass audit note: T3 Code has deeper product coverage than the first pass made obvious in checkpointing, turn diffs, project scripts, image attachments, provider skills, composer polish, archived threads, review workflows, and remote environment auth. Terax has stronger local-native coverage than the first pass made obvious in terminal lifecycle control, editor features, inline autocomplete, file watching, preview sandboxing, WSL-aware workspace boundaries, local agent notification hooks, and native packaging. Those areas are called out below so the report can be used directly as a product backlog.

Clean-room note: this report is for concept and planning comparison. Borrow ideas, contracts, UX patterns, and risk models only after license review. Do not copy T3 Code implementation code into Terax without an explicit legal and maintainership review.

## Source references

Reviewed revisions:

- T3 Code: `/tmp/pi-github-repos/pingdotgg/t3code` at commit `348a9140e9d352fdcb1779d467b4b68000b61bdf`.
- Terax: `/Users/mehmetcanbudak/Projects/terax-pi` at commit `5e91b45d5a193881e55538ae1f9b86f414abb978` plus the local uncommitted `pi-sidebar` working tree present during this review.

The Terax working tree was dirty during review, so exact reproduction requires the reviewed branch diff or a later committed revision containing those files.

Key T3 Code references:

- `README.md`
- `.docs/architecture.md`
- `.docs/provider-architecture.md`
- `.docs/runtime-modes.md`
- `.docs/remote-architecture.md`
- `.docs/workspace-layout.md`
- `REMOTE.md`
- `docs/source-control-providers.md`
- `docs/environment-auth.md`
- `docs/observability.md`
- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/ProviderDriver.ts`
- `apps/server/src/orchestration/*`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/rpc.ts`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/chat/*`
- `apps/server/src/checkpointing/*`
- `apps/server/src/review/ReviewService.ts`
- `apps/server/src/attachmentStore.ts`
- `packages/shared/src/projectScripts.ts`
- `apps/desktop/package.json`
- `apps/mobile/package.json`

Key Terax references:

- `TERAX.md`
- `docs/pi-runtime.md`
- `docs/pi-session-protocol.md`
- `docs/pi-sidebar-verification.md`
- `docs/pi-sidebar-borrowed-ideas.md`
- `src-tauri/src/modules/*`
- `src-tauri/src/modules/pi/*`
- `sidecars/pi-host/*`
- `src/modules/pi/*`
- `src/modules/sidebar/*`
- `src/modules/terminal/*`
- `src/modules/editor/*`
- `src/modules/source-control/*`
- `src/modules/ai/*`
- `src/modules/editor/lib/autocomplete/*`
- `src-tauri/src/modules/fs/watch.rs`
- `src/modules/preview/PreviewPane.tsx`
- `src/modules/settings/*`
- `src/app/App.tsx`

## Product shape

| Area | T3 Code | Terax | Terax opportunity |
| --- | --- | --- | --- |
| Primary product | Agent-first web GUI for coding agents | Native terminal, editor, git, and AI workspace | Keep terminal-first identity, add stronger agent workspace affordances |
| Desktop shell | Electron app over shared web app | Tauri 2 app with Rust backend | Keep Tauri for size, security, and native process control |
| Web app | First-class hosted and local web app | Vite webview only | Consider optional remote web client later, not required now |
| Mobile | Expo mobile app with pairing and native terminal module | None | Optional long-term companion app, only after remote model exists |
| CLI | `npx t3` server and `t3 serve` flows | Tauri app plus bundled Pi sidecar | Consider a Terax headless environment server only if remote becomes strategic |
| Marketing app | Astro marketing app | Not in current scope | Low priority |

## T3 Code feature inventory

### 1. App surfaces

T3 Code ships as a monorepo with multiple app surfaces:

- `apps/server`: Node.js server and `t3` CLI package.
- `apps/web`: React and Vite web client.
- `apps/desktop`: Electron desktop shell.
- `apps/mobile`: Expo mobile client.
- `apps/marketing`: Astro marketing site.

Source references:

- `.docs/workspace-layout.md`
- `apps/server/package.json`
- `apps/web/package.json`
- `apps/desktop/package.json`
- `apps/mobile/package.json`

### 2. Runtime architecture

T3 Code uses a Node WebSocket server as the runtime boundary. The server owns HTTP, WebSocket RPC, provider sessions, terminals, git, filesystem operations, orchestration, persistence, and static web serving.

Core runtime pieces include:

- WebSocket request and response protocol.
- Typed push envelopes with per-connection sequence numbers.
- Ordered push bus.
- Server readiness gate.
- Queue-backed workers for provider ingestion, provider commands, and checkpointing.
- Runtime receipts for async milestones.
- Effect schemas and typed contracts.

Source references:

- `.docs/architecture.md`
- `.docs/provider-architecture.md`
- `packages/contracts/src/rpc.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/server.ts`
- `apps/server/src/serverLayers.ts`
- `packages/shared/src/DrainableWorker.ts`

### 3. Provider and agent support

T3 Code has a generalized provider instance model. Built-in drivers include:

- Codex
- Claude
- Cursor
- OpenCode

Provider functionality includes:

- Per-driver config schemas.
- Per-instance provider state.
- Provider snapshots and capability checks.
- Text generation helpers for titles, PR descriptions, branches, and summaries.
- Provider maintenance and update capability detection.
- Provider runtime adapters behind a common service contract.
- Per-instance environment isolation, such as Codex home layout handling.

Source references:

- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/ProviderDriver.ts`
- `apps/server/src/provider/Drivers/CodexDriver.ts`
- `apps/server/src/provider/Drivers/ClaudeDriver.ts`
- `apps/server/src/provider/Drivers/CursorDriver.ts`
- `apps/server/src/provider/Drivers/OpenCodeDriver.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`

### 4. Chat, threads, projects, and orchestration

T3 Code treats coding as project and thread orchestration:

- Projects are environment-local and can map to repositories.
- Threads hold messages, turns, runtime sessions, plans, activities, approvals, user-input requests, and checkpoints.
- Draft thread state exists client-side.
- Chat view derives timeline entries, pending approvals, pending user inputs, plan state, work logs, diff summaries, and phase state.
- Proposed plans can be displayed and used for follow-up implementation threads.
- Runtime events are normalized into domain events and projected into read models.

Source references:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/session-logic.ts`
- `apps/web/src/proposedPlan.ts`

### 4.1. Checkpointing, turn diffs, and restore flow

T3 Code's checkpointing system is a major feature that deserves separate attention. It captures workspace state around turns, computes diffs, records changed-file summaries, and supports revert-style workflows.

Important pieces:

- Checkpoint baselines and completed turn checkpoints.
- Hidden Git refs for durable checkpoint state.
- Turn diff and full thread diff queries.
- Changed files tree and diff summary UI.
- Runtime receipts for baseline captured, diff finalized, and turn quiesced.
- Revert commands that can restore thread state to a checkpoint.

Source references:

- `.docs/encyclopedia.md`
- `apps/server/src/checkpointing/*`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/orchestration/Services/RuntimeReceiptBus.ts`
- `apps/web/src/hooks/useTurnDiffSummaries.ts`
- `apps/web/src/components/chat/ChangedFilesTree.tsx`
- `packages/contracts/src/orchestration.ts`

### 4.2. Composer, attachments, skills, and plans

T3 Code's chat composer and transcript have several product details Terax should study:

- Image attachments with server-side attachment storage and HTTP serving.
- Model picker with provider instances, model metadata, and provider icons.
- Provider skills surfaced in the composer.
- Slash command parsing and composer command menu.
- Traits picker.
- Context window meter.
- Terminal context chips and pending terminal contexts.
- Pending approval and pending user-input panels.
- Proposed plan cards and follow-up implementation threads.
- Work log and activity timeline rendering.
- Archived threads and archived settings page.

Source references:

- `apps/server/src/attachmentStore.ts`
- `apps/server/src/attachmentPaths.ts`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- `apps/web/src/components/chat/ContextWindowMeter.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`
- `apps/web/src/components/chat/ProposedPlanCard.tsx`
- `apps/web/src/routes/settings.archived.tsx`
- `packages/contracts/src/orchestration.ts`

### 5. Terminal functionality

T3 Code includes terminal support, but the terminal is secondary to the agent thread model:

- Server-side terminal RPC over WebSocket.
- Terminal open, attach, write, resize, clear, restart, close.
- Terminal events and metadata streams.
- Browser xterm rendering.
- Thread terminal drawer.
- Mobile native terminal module.
- Terminal sessions tied to threads and environments.

Source references:

- `packages/contracts/src/terminal.ts`
- `apps/server/src/terminal/*`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/terminalSessionState.ts`
- `apps/mobile/modules/t3-terminal/README.md`

### 6. Source control, VCS, and PR workflows

T3 Code has strong source-control ambition:

- GitHub, GitLab, Bitbucket, and Azure DevOps source-control integrations.
- Clone repositories from providers or arbitrary Git URLs.
- Publish local repositories.
- Create and inspect PRs or MRs.
- Resolve PR references.
- Prepare pull-request review threads.
- Git workflow service and VCS driver foundation.
- Worktree and branch selection in the chat toolbar.
- Git status broadcasting.
- Pull, ref listing, create worktree, remove worktree, create ref, switch ref, init.
- Review diff preview and review feedback service for PR-oriented workflows.
- Project scripts that can be run from the chat surface and triggered around worktree creation.

Source references:

- `docs/source-control-providers.md`
- `packages/contracts/src/git.ts`
- `packages/contracts/src/sourceControl.ts`
- `packages/contracts/src/vcs.ts`
- `apps/server/src/git/GitWorkflowService.ts`
- `apps/server/src/vcs/*`
- `apps/server/src/sourceControl/*`
- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/lib/vcsStatusState.ts`
- `apps/server/src/review/ReviewService.ts`
- `packages/shared/src/projectScripts.ts`
- `apps/web/src/components/ProjectScriptsControl.tsx`

### 7. Remote access and environment model

T3 Code has a much more complete remote strategy:

- Execution environments as first-class runtime owners.
- Known environments saved per client.
- Access endpoints for direct WebSocket, tunnel, or SSH-forwarded access.
- Advertised endpoints with reachability hints.
- Tailscale endpoint provider.
- Hosted web pairing URL model.
- Browser session and bearer token exchange.
- WebSocket tickets.
- OAuth-shaped scopes.
- Desktop-managed SSH launch and local port forwarding.
- Mobile QR pairing.

Source references:

- `.docs/remote-architecture.md`
- `REMOTE.md`
- `docs/environment-auth.md`
- `packages/contracts/src/environment.ts`
- `packages/contracts/src/environmentHttp.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/remoteAccess.ts`
- `packages/shared/src/advertisedEndpoint.ts`
- `apps/server/src/auth/*`
- `apps/desktop/src/ssh/*`
- `apps/mobile/app/pair.tsx`
- `apps/web/src/hostedPairing.ts`

### 8. Approval and safety modes

T3 Code has runtime modes and provider-native approval handling:

- Full access mode maps to provider settings like no approval and full sandbox access.
- Supervised mode maps to on-request approval and workspace-write sandbox.
- Approval requests are represented as orchestration activities.
- Approval responses are persisted as commands and routed to providers.
- Pending approval state is projected for the UI.

Source references:

- `.docs/runtime-modes.md`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/persistence/Services/ProjectionPendingApprovals.ts`

### 9. Diagnostics and observability

T3 Code has mature server observability:

- Pretty logs to stdout.
- Completed spans written to local NDJSON trace file.
- Optional OTLP trace and metric export.
- Trace diagnostics UI.
- Process diagnostics and resource history.
- Runtime warnings and errors represented in orchestration activity.

Source references:

- `docs/observability.md`
- `apps/server/src/observability/*`
- `apps/server/src/diagnostics/TraceDiagnostics.ts`
- `apps/server/src/diagnostics/ProcessDiagnostics.ts`
- `apps/server/src/diagnostics/ProcessResourceMonitor.ts`
- `apps/web/src/routes/settings.diagnostics.tsx`

### 10. Settings and configuration

T3 Code centralizes server-authoritative settings:

- Provider instance configs.
- Keybindings.
- Project grouping and sidebar settings.
- Thread preview count and sort order.
- Runtime mode and interaction mode choices.
- Provider refresh and update flows.
- Desktop update status.

Source references:

- `packages/contracts/src/settings.ts`
- `apps/server/src/serverSettings.ts`
- `apps/web/src/hooks/useSettings.ts`
- `apps/web/src/routes/settings.*.tsx`
- `apps/web/src/components/Sidebar.tsx`

### 11. UI and UX patterns

T3 Code has a rich agent workspace UI:

- Project and thread sidebar with grouping, sorting, search, status indicators, jump shortcuts, DnD, and update/provider pills.
- Chat view with timeline, composer, pending approvals, pending user input, images, plan sidebar, terminal drawer, right panel sheet, and banners.
- Branch toolbar with environment, branch, worktree, and PR context controls.
- Command palette.
- Settings surfaces for providers, source control, connections, diagnostics, general settings, keybindings, and archived items.
- Desktop update prompts.

Source references:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/routes/settings.*.tsx`

### 12. Build, test, and release

T3 Code has a large CI and release surface:

- `vp` and `vite-plus` based scripts.
- Typecheck, lint, tests.
- Cross-platform Electron desktop artifacts.
- GitHub release workflow.
- Mobile EAS preview workflow.
- PR size and vouch workflows.
- Desktop smoke tests.
- Many unit and integration tests across web, server, contracts, shared, and scripts.

Source references:

- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/mobile-eas-preview.yml`
- `scripts/*`
- `apps/desktop/scripts/*`

## Terax feature inventory

### 1. App surface and architecture

Terax is a native desktop app using Tauri 2, Rust, React, TypeScript, xterm.js, and CodeMirror. It targets macOS, Linux, and Windows.

Key characteristics:

- Rust owns filesystem, shell, PTY, git, workspace authorization, keychain, networking, and process lifecycle.
- React owns UI, terminal rendering, editor rendering, settings, and panels.
- The webview does not touch OS surfaces directly.
- Pi integration uses a Node sidecar, but the sidecar is not the OS authority.

Source references:

- `TERAX.md`
- `src-tauri/src/lib.rs`
- `src-tauri/src/modules/*`
- `src/app/App.tsx`
- `package.json`
- `src-tauri/Cargo.toml`

### 2. Terminal and PTY functionality

Terax has a stronger native-terminal foundation than T3 Code:

- Long-lived PTY sessions via `portable-pty`.
- xterm.js with WebGL rendering.
- Split panes and multi-tab terminal stack.
- Tabs stay mounted while hidden so terminals and dev servers keep streaming.
- OSC 7 cwd tracking.
- OSC 133 prompt boundary tracking.
- Unix shell init injection for zsh, bash, and fish.
- Windows PowerShell profile integration.
- ConPTY spawn lock for Windows stability.
- Windows Job Object cleanup for descendant processes.
- Private terminal tabs.
- Shell one-shot commands for AI tools.
- Persistent shell sessions for agents.
- Background shell processes with bounded ring-buffer logs.
- Local and WSL workspace support.

Source references:

- `TERAX.md`
- `src-tauri/src/modules/pty/*`
- `src-tauri/src/modules/pty/scripts/*`
- `src-tauri/src/modules/shell/*`
- `src/modules/terminal/*`
- `src/modules/tabs/*`
- `src/modules/statusbar/CwdBreadcrumb.tsx`

### 3. Editor, file explorer, preview, and markdown

Terax has a native developer workspace around the terminal:

- CodeMirror 6 editor tabs.
- Vim mode.
- Language support and multiple code themes.
- AI diff tabs with side-by-side review.
- Git diff tabs.
- File explorer with icons, fuzzy search, keyboard navigation, inline rename, and context actions.
- File read, write, create, rename, delete, search, grep, and glob through Rust.
- Markdown preview tabs.
- Dev-server preview tabs with localhost detection.
- Preview iframe sandboxing and background release to reduce memory use.
- Command palette.
- Inline AI autocomplete in the editor.
- File watching to avoid stale buffers.
- Color swatches for theme editing.
- Large or unsupported file handling.

Source references:

- `src/modules/editor/*`
- `src/modules/explorer/*`
- `src/modules/markdown/*`
- `src/modules/preview/*`
- `src/modules/command-palette/*`
- `src/modules/editor/lib/autocomplete/*`
- `src/modules/editor/lib/colorSwatches.ts`
- `src-tauri/src/modules/fs/*`
- `src-tauri/src/modules/fs/watch.rs`

### 4. Git and source control

Terax has strong local git operations but lacks T3 Code's remote provider workflows.

Current functionality includes:

- Git status.
- Git diff and file diff content.
- Stage and unstage.
- Discard.
- Commit.
- Fetch.
- Pull with fast-forward only.
- Push.
- Log.
- Show commit.
- Per-file commit diff.
- Git panel snapshot.
- Git repository resolution.
- Remote URL detection.
- Git history graph and commit file diff tabs.

Missing compared with T3 Code:

- GitHub, GitLab, Bitbucket, and Azure DevOps provider integrations.
- Clone from provider UI.
- Publish repository UI.
- Create PR or MR UI.
- Checkout PR branch UI.
- Review-thread flow.
- Server-side VCS abstraction.
- Worktree creation and switching UI like T3 Code.

Source references:

- `TERAX.md`
- `src-tauri/src/modules/git/*`
- `src/modules/source-control/*`
- `src/modules/git-history/*`
- `src/modules/editor/GitDiffPane.tsx`

### 5. AI subsystem

Terax has a broad BYOK AI subsystem independent of Pi:

- Vercel AI SDK v6.
- Cloud providers: OpenAI, Anthropic, Google, xAI, Cerebras, Groq.
- OpenAI-compatible custom endpoints.
- Local providers: LM Studio, MLX, Ollama.
- OS keychain storage for API keys.
- Sessions persisted through Tauri store.
- Composer with text, attachments, voice, and selection context.
- Inline editor autocomplete backed by selected AI providers.
- Token usage, cost, and context compaction utilities.
- Snippets, slash commands, and sub-agents for reusable prompt fragments and tool bundles.
- Live terminal and editor context bridge.
- Agent tools for file reading, listing, searching, grep, writing, directory creation, rename, delete, command execution, shell sessions, and background shell processes.
- Approval pause for mutating and shell tools.
- AI diff tabs and per-hunk accept or reject.
- Sub-agents with tool subsets.
- Mini AI window.
- Local agent notifications.

Source references:

- `TERAX.md`
- `src/modules/ai/*`
- `src/modules/ai/config.ts`
- `src/modules/ai/lib/agent.ts`
- `src/modules/ai/tools/tools.ts`
- `src/modules/ai/lib/security.ts`
- `src/modules/ai/lib/compact.ts`
- `src/modules/ai/lib/snippets.ts`
- `src/modules/ai/lib/slashCommands.ts`
- `src/modules/ai/agents/*`
- `src/modules/editor/lib/autocomplete/*`
- `src/modules/agents/*`
- `src/modules/editor/AiDiffPane.tsx`
- `src-tauri/src/modules/secrets.rs`

### 6. Pi sidebar functionality

Terax's Pi sidebar is a focused Pi integration with a local Rust authority boundary:

- Node Pi sidecar using `@earendil-works/pi-*` packages.
- Rust launches the sidecar and talks to it over newline-delimited JSON-RPC 2.0.
- Methods include `ping`, `status`, `info`, `diagnostics`, `models.list`, `sessions.list`, `sessions.create`, `sessions.send`, `sessions.resume`, `sessions.tool.respond`, `sessions.rename`, `sessions.delete`, `sessions.stop`, and `shutdown`.
- Real Pi SDK `AgentSession` objects.
- Pi SDK JSONL conversation persistence.
- Rust-owned metadata and event persistence in `pi-sessions.json`.
- Session restore and resume after app or sidecar restart.
- Streaming `session.event` notifications.
- Thinking level forwarding.
- Regeneration branch metadata.
- Runtime prewarm when sidebar opens.
- Idle shutdown policy.
- Diagnostics card.
- Runtime card.
- Session list.
- Transcript.
- Composer.
- Context bar.
- Local agents card.
- Notifications bridge.
- Code surface can be sidebar, floating window, or workspace tab.

Source references:

- `docs/pi-runtime.md`
- `docs/pi-session-protocol.md`
- `docs/pi-sidebar-verification.md`
- `sidecars/pi-host/*`
- `src-tauri/src/modules/pi/*`
- `src/modules/pi/PiPanel.tsx`
- `src/modules/pi/components/*`
- `src/modules/pi/lib/*`
- `src/app/codeSurface.ts`

### 7. Pi tool safety and approval model

Terax has a stronger local authority boundary here because the Pi sidecar is not trusted with OS ownership and Rust mediates OS operations.

Current model:

- Pi tools are overridden as Terax custom tools.
- Enabled tools are `read`, `ls`, `grep`, `find`, `bash`, `edit`, and `write`.
- Tool execution routes back to Rust with reverse JSON-RPC `nativeTools.execute`.
- Rust validates session id, cwd, and workspace environment.
- Rust checks workspace authorization.
- WSL sessions preserve workspace identity and fail closed where local shell execution would cross the boundary.
- Rust applies sensitive-path policy.
- Grep and find skip sensitive paths.
- `bash`, `edit`, and `write` require explicit approval through `sessions.tool.respond`.
- Provider keys are resolved by Rust and are not passed through sidecar process environment.
- Diagnostics return booleans and labels, not secrets.

Source references:

- `docs/pi-runtime.md`
- `docs/pi-session-protocol.md`
- `docs/pi-sidebar-verification.md`
- `sidecars/pi-host/native-tools.js`
- `sidecars/pi-host/sessions.js`
- `src-tauri/src/modules/pi/native_tools.rs`
- `src-tauri/src/modules/pi/host.rs`
- `src-tauri/src/modules/workspace.rs`

### 8. Local CLI agent launcher

Terax's Pi sidebar can detect and launch local coding agents in visible terminals:

- Claude Code
- Codex
- Cursor Agent
- OpenCode
- Pi
- Gemini CLI
- Antigravity

Launch posture is conservative:

- Claude Code starts with plan mode.
- Codex starts read-only with on-request approval.
- Cursor Agent starts in plan mode.
- Pi starts with read/search-only tools.
- OpenCode uses a temporary HOME/XDG config and Terax-owned read-only permissions.
- Prompt handoff is shell-quoted and visible.
- No hidden agent process is spawned for local CLI launches.

Source references:

- `docs/pi-runtime.md`
- `src/modules/pi/lib/local-agents.ts`
- `src/modules/pi/components/PiLocalAgentsCard.tsx`
- `src-tauri/src/modules/pty/agent_detect.rs`
- `src/modules/agents/*`

### 9. Security model

Terax's main local safety advantage is its ownership boundary:

- Rust owns OS access.
- Workspace authorization gates file, git, shell, and Pi session cwd.
- Keyring stores secrets.
- Linux key fallback is explicitly platform-gated.
- Net proxy has SSRF guards.
- AI sensitive-path deny-list applies to reads and writes.
- Pi sidecar is launched with a minimal environment.
- Pi sidecar cannot call Terax-owned terminal, git, file, editor, shell, or SQLite method families directly.
- Shell and mutation approvals happen in Terax UI before Rust execution.

Source references:

- `TERAX.md`
- `src-tauri/src/modules/workspace.rs`
- `src-tauri/src/modules/secrets.rs`
- `src-tauri/src/modules/net.rs`
- `src/modules/ai/lib/security.ts`
- `src-tauri/src/modules/pi/*`
- `docs/pi-sidebar-verification.md`

### 10. Settings, themes, updater, and UI shell

Terax has a strong native desktop UI shell:

- Settings window.
- Models settings with BYOK providers and custom endpoints.
- General settings.
- Themes settings.
- Shortcuts settings.
- Agents settings.
- Custom theme engine.
- Built-in themes.
- Background images.
- Tauri updater UI.
- Compact sidebars and activity rail.
- Custom titlebar and window controls where needed.
- Header, tab bar, status bar, AI tools indicator, and cwd breadcrumb.

Source references:

- `TERAX.md`
- `src/settings/*`
- `src/modules/settings/*`
- `src/modules/theme/*`
- `src/modules/updater/*`
- `src/modules/sidebar/*`
- `src/modules/header/*`
- `src/modules/statusbar/*`

### 11. Build, packaging, and tests

Terax's build and test surface includes:

- pnpm for frontend.
- Vite and TypeScript.
- Vitest.
- Tauri build.
- Rust cargo tests and clippy.
- Sidecar bundle build.
- Bundled Node runtime for Pi host.
- Pi host smoke test.
- Tauri configs for macOS, Linux, and Windows.
- Updater configuration.

Source references:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `scripts/build-node-runtime.mjs`
- `scripts/build-pi-host-bundle.mjs`
- `scripts/smoke-pi-host-bundle.mjs`
- `docs/pi-sidebar-verification.md`

## Head-to-head comparison

| Capability | T3 Code | Terax today | Recommendation |
| --- | --- | --- | --- |
| Native terminal quality | Medium | Strong | Keep investing here |
| OS authority boundary | Node server owns most surfaces | Rust owns OS surfaces | Keep Terax model |
| Provider abstraction | Strong driver SPI | Mixed: AI SDK config plus Pi sidecar | Add Rust-first runtime driver abstraction |
| Agent orchestration | Strong event model | Pi session events plus AI chat store | Add unified Terax event model |
| Checkpoints and turn diffs | Strong checkpoint, diff, revert model | AI diff and git diff exist, but no turn checkpoint model | Add lightweight checkpoints after event core |
| Composer depth | Strong attachments, skills, slash commands, context meter | Strong AI composer, snippets, voice, selections, approvals | Merge T3-style context and pending panels into Terax UX |
| Session and thread UX | Strong project/thread sidebar | Pi sessions are functional but narrower | Borrow sorting, search, grouping, archive, unread |
| Remote environments | Strong architecture | Local and WSL oriented | Borrow model carefully after Pi stabilizes |
| Source-control providers | Strong | Local git only | Add provider integrations incrementally |
| Project scripts | Integrated into chat workflows | Not a first-class surface | Add safe workspace task runner later |
| Worktrees | Stronger in chat context | Limited | Add worktree picker and safe branch flows |
| PR workflows | Strong | Missing | Add GitHub first, then GitLab |
| Observability | Strong traces and diagnostics | Basic app and Pi diagnostics | Add trace bundle and process diagnostics |
| Mobile | Exists | Missing | Long-term optional |
| Desktop footprint | Heavier Electron | Lighter Tauri | Preserve Tauri footprint advantage |
| Tool safety | Provider-native modes | Rust-mediated OS operations | Preserve Rust mediation and add clearer modes |
| Local CLI agent launch | Provider runtime integrated | Safe visible launcher | Keep Terax posture, improve management |
| Editor and terminal productivity | Secondary to chat | Strong terminal, editor, autocomplete, preview | Keep investing here as the differentiator |
| UI density and native feel | Good agent workspace | Good terminal desktop | Merge best ideas selectively |

## What Terax should borrow from T3 Code

Implementation order matters. Start with runtime health, Pi receipts, and pure Pi projection helpers before introducing any generalized runtime-driver abstraction. A driver layer should be extracted from observed duplication, not designed ahead of evidence.

### 1. Provider driver abstraction

T3 Code's `ProviderDriver` pattern is worth borrowing conceptually, but it should not be the first implementation slice. Terax should not copy the code or move provider ownership to Node. After the health model, receipts, and Pi projections stabilize, define a Terax-native abstraction such as `AgentRuntimeDriver` with:

- Stable driver id.
- Runtime health snapshot.
- Model catalog snapshot.
- Session create or attach.
- Send prompt.
- Stop prompt.
- Approval response.
- Event stream.
- Text-generation helper capabilities.
- Update or install hint capabilities.

Use this for:

- Pi sidecar runtime.
- Existing Terax AI SDK agent runtime.
- Local CLI agent visible-launch metadata.
- Future direct Codex or Claude adapters if needed.

Priority: P2, after runtime health, receipts, and Pi projection helpers prove the shape.

### 2. Unified event and projection model

T3 Code's orchestration model is useful because it separates raw provider events from UI read models. Terax should add a smaller version:

- `session.created`
- `turn.started`
- `message.added`
- `reasoning.delta`
- `output.delta`
- `tool.started`
- `tool.approval.requested`
- `tool.approval.responded`
- `tool.result`
- `turn.completed`
- `turn.stopped`
- `session.error`
- `runtime.receipt`

Use projections for:

- Session list rows.
- Transcript rendering.
- Notifications.
- Pending approvals.
- Diagnostics.
- Unread counts.

Priority: P1.

### 3. Runtime receipts

T3 Code's `RuntimeReceiptBus` idea is valuable. Terax should add explicit receipts for Pi and later generic agent sessions:

- Prompt accepted.
- First token received.
- Tool approval opened.
- Tool approval resolved.
- Tool execution completed.
- Turn quiescent.
- Session persisted.
- Sidecar idle-safe.

This improves testing and removes timing-based UI assumptions.

Priority: P1.

### 4. Checkpoint and turn diff workflow

T3 Code's checkpoint model is one of its highest-value agent features. Terax should add a smaller Rust-owned variant after the event core exists:

- Capture a baseline before an agent turn that can mutate files.
- Capture a completion checkpoint after the turn quiesces.
- Compute changed-file summaries for the transcript.
- Let users inspect per-turn diffs.
- Let users revert a turn through a reviewed git operation.
- Keep checkpoint refs and cleanup in Rust, not in the Pi sidecar.

Hard edge cases to design before implementation:

- Dirty worktrees before the agent turn starts.
- Untracked files created before and during the turn.
- Ignored files and generated artifacts.
- Binary files and large files.
- Non-git workspaces.
- Partial accepts from AI diff tabs.
- Revert conflicts after the user edits files manually.
- WSL path normalization and host versus guest git execution.
- Cleanup of stale checkpoint refs after crashes.

Priority: P1 after the event core, otherwise P2.

### 5. Composer and context upgrades

T3 Code's composer is broader than a prompt box. Terax should fold selected ideas into the Pi and built-in AI surfaces:

- Context window meter in the Pi panel.
- Pending approval panel that stays visible near the composer.
- Pending user-input panel for agent questions.
- Image attachment support for Pi when the selected model supports images.
- Slash command menu shared with snippets and sub-agents.
- Terminal context chips with expiry and source labels.
- Proposed plan cards that can spawn a guarded implementation session.

Priority: P1 for context and pending panels, P2 for image attachments and proposed-plan flow.

### 6. Richer session sidebar

Borrow from T3 Code's sidebar UX:

- Session search.
- Sort by last activity and created time.
- Group by workspace or repository.
- Archive sessions.
- Pin sessions.
- Unread badges.
- Status pills.
- Keyboard shortcuts for recent sessions.
- Context menu actions.
- Optional compact preview count.

Priority: P1.

### 7. Branch and worktree context

T3 Code's branch toolbar is one of the most useful product ideas. Terax should add a compact run-context bar for Pi and AI sessions:

- Current branch.
- Current worktree.
- Workspace mode: current checkout or generated worktree.
- Active terminal cwd.
- Active file.
- Private terminal indicator.
- PR reference if detected.

Priority: P1.

### 8. Source-control provider workflows

Terax already has local git. The next step is hosted source-control workflows:

- GitHub auth detection through `gh` CLI.
- GitHub PR create from current branch.
- Open existing PR for current branch.
- Checkout PR branch locally.
- Generate PR title and body using Terax AI.
- GitLab after GitHub.
- Bitbucket and Azure DevOps later.

Priority: P2.

### 9. Remote environment model

T3 Code has a strong model that Terax can borrow later:

- Execution environment id.
- Known environment records.
- Access endpoints.
- Pairing token.
- WebSocket ticket.
- Advertised endpoints.
- Tailscale endpoint detection.
- SSH launch and port forward.

For Terax, this should be implemented only if Terax wants remote workspaces. It must keep Rust as the environment authority.

Priority: P3.

### 10. Observability and support bundle

Borrow T3 Code's observability mindset:

- Local NDJSON trace file.
- Span or event records for terminal, shell, git, Pi sidecar, and AI operations.
- Process diagnostics.
- Resource history.
- Redacted support bundle export.
- Settings diagnostics page.

Priority: P2.

### 11. Provider maintenance and health

T3 Code's provider health checks are useful. Terax should expose health by provider and local CLI:

- Installed binary path.
- Version.
- Auth present.
- Model catalog loaded.
- Update available when detectable.
- Required setup action.
- Last runtime error.
- Safe launch posture.

Priority: P1 for Pi sidebar, P2 globally.

### 12. Mobile companion, only after remote exists

T3 Code already has mobile pairing. Terax should not chase mobile until remote environments are real. If added later, the first mobile surface should be:

- Pair to desktop environment.
- View running terminals and agent status.
- Approve or deny pending tools.
- Read transcripts.
- Send follow-up prompts.

Priority: P4.

## What Terax should not borrow

Do not borrow these parts directly:

1. Electron as the base desktop shell.
2. A Node server that owns filesystem, shell, git, terminal, and process execution.
3. Full-access defaults for agent runtime.
4. Provider-native file and shell execution without Rust mediation.
5. Broad remote server work before the local Pi sidebar is stable.
6. Large event-sourcing rewrite before the current session model is locked down.
7. Mobile before remote auth and pairing are well designed.
8. Code copying from T3 Code where licensing or design ownership is unclear.

## Prioritized Terax improvement backlog

### P0: Finish and harden the current Pi sidebar

Goal: Make the current Pi sidebar reliable enough to ship.

Tasks:

- Fix known sidecar protocol and test flakes.
- Ensure `pnpm test` passes in normal parallel mode.
- Ensure `pnpm build:sidecars` and `pnpm smoke:pi-host` pass.
- Keep stdout strictly JSON-RPC.
- Expand diagnostics to show exact provider and sidecar state without secrets.
- Ensure partial custom endpoints do not enable unusable model choices.
- Verify restart, stop, resume, approval, denial, and stale approval behavior.
- Keep local CLI agent launches safe and visible.

References:

- `docs/pi-sidebar-verification.md`
- `docs/pi-sidebar-borrowed-ideas.md`

### P1: Add Terax runtime health model

Goal: Make agent runtime state visible and actionable.

Suggested data model:

```ts
type RuntimeHealth = {
  id: string;
  label: string;
  kind: "pi-sidecar" | "local-cli" | "ai-sdk";
  installed: boolean | null;
  authenticated: boolean | null;
  modelReady: boolean | null;
  ready: boolean;
  error: string | null;
  actions: Array<"install" | "authenticate" | "choose-model" | "restart" | "open-docs">;
};
```

Use it in:

- Pi diagnostics.
- Models settings.
- Agents settings.
- Header notification surfaces.

### P1: Build a small Terax agent event core

Goal: Unify Pi sidebar, built-in AI agent, and local CLI notifications around common event semantics.

Start small:

- Define shared event types.
- Normalize Pi events into the shared shape.
- Normalize AI SDK agent metadata into the shared shape.
- Keep persistence simple.
- Add receipt events for deterministic tests.

Do not start with a full T3-sized event sourcing system.

### P1: Add Pi composer and context upgrades

Goal: Make the Pi composer as capable as the main Terax AI composer while keeping Pi-specific safety.

Tasks:

- Add a context window meter and model context warning.
- Show terminal context chips with cwd, privacy, and expiry state.
- Keep pending approval requests visible near the composer.
- Add a pending user-input panel for provider questions if Pi exposes them.
- Share snippets and slash commands with the main AI composer where safe.
- Add image attachments only after provider capability detection is reliable.

### P1: Improve Pi session UX

Goal: Make Pi sessions feel like a coding workspace, not only a transcript list.

Tasks:

- Add search.
- Add archive.
- Add pin.
- Add grouping by workspace or repository.
- Add sort by updated time.
- Add status pills and unread counts.
- Add context menu actions.
- Add keyboard navigation.
- Add title generation for new sessions.

### P1: Add branch/worktree context to Pi

Goal: Give agents better execution context and make it visible to users.

Tasks:

- Show branch in Pi context bar.
- Show repository name.
- Show worktree path when present.
- Add action to open a guarded worktree session.
- Let the agent propose branch names but require user confirmation.

### P2: Add lightweight turn checkpoints

Goal: Let users inspect and undo agent file changes per turn.

Tasks:

- Capture a baseline before approved mutating tools run.
- Capture a completion checkpoint when the turn is quiescent.
- Store checkpoint metadata in Rust-owned session state.
- Render changed-file summaries in the transcript.
- Open per-turn diff tabs.
- Add revert with explicit confirmation.

### P2: Add GitHub PR workflow first

Goal: Close the biggest source-control gap without building every provider at once.

Tasks:

- Detect `gh` availability and auth.
- Detect current branch's PR.
- Create PR from current branch.
- Open PR in browser.
- Generate PR title and body from commits or diff.
- Checkout PR by URL or number.
- Add GitLab later using same abstraction.

### P2: Add observability and support bundle

Goal: Make bugs easier to diagnose.

Tasks:

- Add local trace NDJSON.
- Redact secrets by default.
- Add process and sidecar stderr summaries.
- Add Pi session lifecycle trace records.
- Add support bundle export.
- Add diagnostics settings page.

### P2: Add project scripts and safe task runner

Goal: Borrow T3 Code's project-script affordance without letting agents run arbitrary hidden tasks.

Tasks:

- Detect common scripts from package manifests and local config.
- Let users pin trusted workspace scripts.
- Run scripts in visible terminals by default.
- Allow agents to suggest scripts, but require user confirmation.
- Keep per-workspace script config separate from provider auth.

### P2: Add provider and local CLI maintenance UX

Goal: Make setup and updates less mysterious.

Tasks:

- Show binary version when available.
- Show install docs link.
- Show update command or app-supported update action.
- Show auth status without secrets.
- Show model catalog health.
- Show safe launch command preview.

### P3: Design remote environment support

Goal: Decide if remote is strategic before implementation.

Minimum design questions:

- Is Terax desktop always the client, or can Terax expose a remote environment server?
- Does Rust run on the remote machine and expose a narrow RPC surface?
- How are pairing tokens created and revoked?
- How are workspace permissions scoped?
- How does WSL map into remote environments?
- How are terminal streams multiplexed?
- How are approvals delivered across devices?

Borrow T3 Code's vocabulary, but design a Rust-owned Terax protocol.

### P4: Mobile companion

Only after remote support exists:

- View sessions.
- Receive notifications.
- Approve tool calls.
- Send prompts.
- Inspect terminal output.

## Suggested roadmap

### Phase 1: Ship the current Pi sidebar

Work:

- Stabilize sidecar tests.
- Finish diagnostics.
- Verify packaging.
- Improve model picker correctness.
- Run manual smoke from `docs/pi-sidebar-verification.md`.

Success metrics:

- `pnpm test`, `pnpm build:sidecars`, and `pnpm smoke:pi-host` pass on the branch.
- Pi session restore survives app restart with a persisted SDK session file.
- Approve, deny, stop, resume, and stale approval paths have deterministic tests.
- Diagnostics show provider, model, sidecar, session store, and tool-boundary state without secrets.

### Phase 2: Make sessions and composer feel first-class

Work:

- Add runtime health rows.
- Add Pi receipts.
- Add pure Pi projection helpers with tests.
- Add search, archive, pin, sort, group, and unread.
- Add session health badges and better error surfaces.
- Add context meter, terminal context chips, pending approval panel, and shared snippets.

Success metrics:

- Session list and transcript can be derived from stored events in pure tests.
- Approval receipt tests do not depend on timers or polling.
- Users can find, archive, pin, and restore Pi sessions without losing transcript history.
- The composer always shows the active cwd, privacy state, model context state, and pending approval state.

### Phase 3: Stabilize the event core before abstraction

Work:

- Normalize Pi events, built-in AI agent events, and local CLI notification events into a shared minimal shape.
- Keep persistence simple and Rust-owned where OS operations are involved.
- Document the event and receipt vocabulary.
- Defer `AgentRuntimeDriver` until repeated adapter code exists.

Success metrics:

- Pi, built-in AI, and local CLI notifications share status labels and unread behavior.
- Adding a new event type requires a schema test and a projection test.
- No generalized driver layer is introduced without at least two real implementations using it.

### Phase 4: Add checkpoints, worktrees, and git provider workflow

Work:

- Add baseline and completion checkpoints for mutating agent turns.
- Handle dirty worktrees, untracked files, binary files, non-git workspaces, partial accepts, and revert conflicts.
- Add turn changed-file summaries and diff tabs.
- Add GitHub detection.
- Add PR create and open.
- Add branch and worktree UX.
- Add AI-generated PR copy.

Success metrics:

- Turn diff works when the workspace is already dirty before the agent starts.
- Revert fails safely with a clear conflict message when files changed after the turn.
- Non-git workspaces degrade to transcript-only change summaries instead of crashing.
- GitHub PR detection works for authenticated and unauthenticated `gh` states.

### Phase 5: Evaluate remote environments

Work:

- Write a Terax remote architecture doc.
- Prototype Rust environment server and desktop pairing.
- Add Tailscale or SSH only after the model is clear.

Success metrics:

- Pairing has explicit token lifetime, revocation, and scope rules.
- Remote terminal streams do not bypass workspace authorization.
- Remote approval delivery preserves the same Rust-mediated tool boundary as local use.

## Suggested next ten tickets

Use this as the first execution slice after the current branch compiles and tests cleanly:

1. Add Pi runtime health rows for provider, model, sidecar, session store, and local CLI agents.
2. Add explicit Pi receipts for prompt accepted, first output, approval opened, approval resolved, turn quiesced, and session persisted.
3. Move Pi transcript/session-list derivation behind a pure projection helper with tests.
4. Add Pi session search, archive, pin, and updated-time sorting.
5. Add context meter and terminal context chips to the Pi composer.
6. Add a sticky pending approval panel next to the composer.
7. Add branch and repository summary to the Pi context bar.
8. Add GitHub CLI auth detection and current-branch PR detection to source control.
9. Add local trace records for Pi sidecar lifecycle and native tool execution.
10. Write a short `docs/terax-agent-runtime.md` design before adding a generalized runtime driver layer.

## Architecture guardrails for Terax

Keep these invariants while borrowing from T3 Code:

1. Rust owns OS operations.
2. Sidecars are capability-limited workers, not authority boundaries.
3. Secrets stay in keychain or Rust-owned memory.
4. Agent file, shell, and mutation tools route through Rust.
5. Workspace authorization is enforced before runtime creation and before tool execution.
6. Provider diagnostics expose presence and status, not secrets.
7. UI state should be derived from validated events where possible.
8. Do not add heavy dependencies unless they clearly improve the product.
9. Keep terminal performance and bundle size as product constraints.
10. Do not sacrifice local native quality to chase remote or mobile surfaces too early.

## Final recommendation

Do not fork T3 Code as the base for Terax. Continue from Terax and selectively borrow T3 Code's stronger product concepts:

- Provider driver abstraction.
- Event projection model.
- Runtime receipts.
- Checkpoint and turn diff workflow.
- Composer, context, and attachment UX.
- Session and thread UX.
- Branch and worktree context.
- Source-control provider workflows.
- Remote environment vocabulary.
- Observability and diagnostics.

Terax's Rust and Tauri architecture is the better foundation for a lightweight AI-native terminal with a local OS authority boundary. T3 Code should be treated as a reference implementation for agent workspace ideas, not as the runtime base.
