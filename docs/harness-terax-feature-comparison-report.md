# Harness to Terax feature comparison and Rust migration report

Date: 2026-06-06

## Scope

This report compares the current Terax repository with `/Users/mehmetcanbudak/Projects/harness`, which is the current Harness/Forma fork of T3 Code.

- Terax repository: `/Users/mehmetcanbudak/Projects/terax-pi`
- Terax branch observed: `pi-sidebar`
- Terax commit observed: `c466908`
- Harness repository: `/Users/mehmetcanbudak/Projects/harness`
- Harness branch observed: `tests`
- Harness commit observed: `1c53f019`
- Harness worktree state observed: dirty, including `bun.lock` modifications and untracked `.omc/`, `DESIGN.md`, and `apps/server/.omc/`
- Method: code and documentation inspection only. The applications were not run.

Confidence is high for repository structure, declared contracts, and source-level capabilities. Confidence is medium for runtime behavior that depends on executing the apps, provider SDKs, or external CLIs.

Second-pass audit note: after the first draft, I rechecked the Harness server, contracts, web components, shared packages, and the Terax module tree. The main conclusion did not change, but the report now explicitly covers several smaller Harness surfaces that were underweighted in the first pass: image attachments, provider status/model catalog, project scripts, repository identity, keybindings, editor launchers, preview feedback annotations, VCS abstraction, desktop update state, and migration/test depth.

Final design audit note: I also rechecked Harness and Terax frontend docs and source for colors, tokens, fonts, UI primitives, icons, animation, reduced motion, editor theming, terminal theming, and accessibility requirements. The report now treats design-system migration as its own workstream rather than folding it into generic "workbench UI" notes.

## Executive conclusion

Terax should stay Rust and Tauri. Harness should be treated as a feature and product reference, not as an architecture to copy wholesale.

Harness has strong concepts that Terax should port:

- A durable orchestration model with commands, events, projections, thread shells, turn queues, session lifecycle, approvals, user input, proposed plans, and replay.
- A provider adapter layer that normalizes Codex, Claude, Cursor, OpenCode, and ACP-style runtimes into canonical runtime events.
- Hidden-Git-ref checkpoints, turn diffs, checkpoint summaries, and revert flows.
- Rich Git and source-control workflows: stacked actions, branch/worktree management, PR creation, repository discovery, clone, and publish.
- A component preview harness that can bootstrap `.forma/preview` files, run isolated Vite previews, expose scenarios, controls, mocks, and feedback.
- A dense desktop-style workbench: project/thread sidebar, central chat, bottom composer, expandable right workspace panel, files/diffs/preview/terminal panes, settings, and command palette.
- A detailed frontend reproduction contract: semantic CSS tokens, exact theme families, DM Sans and SF Mono font stacks, motion durations/easings, reduced-motion behavior, component states, icon strategy, scroll ownership, and fixed workbench geometry.
- Remote access and pairing mechanics for reaching a local agent server from another device.
- Image attachment persistence, provider status/model catalog surfaces, project setup scripts, repository identity, keyboard command contracts, editor openers, and preview feedback annotations.

Terax has important strengths that should remain the foundation:

- Rust owns OS access, process spawning, filesystem boundaries, Git, shell, net, secrets, and PTY lifecycle.
- Tauri keeps the desktop shell lighter than Electron.
- The terminal subsystem is more central, with portable-pty, OSC 7/133 shell integration, dormant session buffering, and renderer pooling.
- Terax already has broad BYOK/local model support, Pi SDK sidecar integration, Rust-mediated tool approvals, MCP, artifacts, workflow canvas, model compare, keychain storage, workspace path safety, and SSRF/network guards.
- Terax already has WSL workspace support, background shell sessions, terminal coding-agent detection/notifications, image/text/selection attachments, voice input, app updater, shortcuts, themes, and an artifact inbox surface.
- Terax already has a strong local design foundation: Tailwind v4 plus shadcn tokens, Inter Variable UI font, JetBrains/Nerd-font-aware monospace fallback, custom `.terax-theme` files, CodeMirror theme mapping, xterm token bridging, app chrome theming, and reduced-motion CSS.
- Terax product direction explicitly avoids account dependence, telemetry defaults, and heavy IDE scope.

The best migration path is to port Harness features as Rust-owned domain contracts and UI patterns, then map existing Terax Pi/AI sessions into those contracts before adding more external provider adapters.

## One-line product comparison

Harness/Forma is a web and Electron desktop workbench for coding agents, currently centered on Codex and Claude with Cursor and OpenCode adapter work present in the server.

Terax is a Rust/Tauri terminal-first AI development environment with a native PTY backend, workspace-aware tools, local/cloud BYOK models, Pi session integration, artifacts, MCP, and a security-first OS boundary.

## High-priority migration ranking

| Rank | Feature | Harness value | Terax status | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | Orchestration event core | Durable commands, events, projections, replay, thread shells | Terax has Pi and AI sessions, but no comparable repo-wide event ledger | Build a Rust domain core first, then adapt Pi sessions into it |
| 2 | Canonical provider runtime | Normalized event stream across Codex, Claude, Cursor, OpenCode, ACP | Terax has direct AI SDK and Pi paths, but provider lifecycles are not unified like Harness | Add a provider-runtime event schema in Rust/TS contracts |
| 3 | Turn queue, approvals, user input, plans | Handles busy sessions, queued turns, pending approvals/questions, proposed plans | Terax has approvals and plan mode concepts, but not the same queue/projection model | Port after event core so state is durable and replayable |
| 4 | Checkpoints and diffs | Hidden Git refs for pre/post turn checkpoints, summaries, patch view, revert | Terax has Git status/history but no equivalent checkpoint store | Implement Rust Git-ref checkpoints with explicit restore safeguards |
| 5 | Workbench UI composition | Dense sidebar, central chat, bottom composer, right workspace panel | Terax has terminal/editor/explorer/preview/tabs/status modules | Borrow layout ideas while keeping terminal-first Terax identity |
| 6 | Design tokens, colors, fonts, and motion | Formal design contract with semantic tokens, theme families, runtime font scaling, motion tokens, and state matrix | Terax already has Tailwind/shadcn tokens, custom themes, Inter, monospace detection, CodeMirror/xterm theming, and reduced motion | Preserve Terax's theme engine and borrow Harness's token discipline, state coverage, font-scale UX, and motion timing |
| 7 | Git stacked actions and PRs | Commit, push, PR, worktree, branch, provider discovery | Terax has source-control basics | Add layered Git workflows incrementally, starting GitHub CLI only |
| 8 | Component preview harness | Isolated scenario/control/mock preview runtime | Terax has iframe preview and artifacts | Port as optional preview capability, with Rust path/auth ownership |
| 9 | Local agent commands and skills | Parses local markdown agents/commands and expands arguments | Terax has skills/snippets mentioned in product docs | Add inventory parsing and composer integration |
| 10 | Remote pairing | Pairing link/token/QR, session auth, remote-reachable mode | Terax has desktop-first local app and no account requirement | Optional, disabled by default, with strict threat model |
| 11 | Project setup and repository identity | Per-project scripts, setup-on-worktree hooks, repository identity cache | Terax has workspace registry and Git resolve, but not the same project-script surface | Add after orchestration and worktree support |
| 12 | Provider catalog/status and model options | Provider install/auth/version status, model aliases, custom models, provider skills/slash commands | Terax has broad model discovery and provider settings | Borrow status/catalog UX, not Harness provider defaults |
| 13 | Keybindings and editor openers | Command-aware keybinding schema and open-in-editor targets | Terax has shortcuts and editor tabs | Borrow command contract ideas where Terax shortcuts need expansion |

## Feature inventory matrix

| Area | Harness/Forma | Terax today | Port decision |
| --- | --- | --- | --- |
| Desktop shell | Electron desktop app plus local Bun/Node server | Tauri 2 with Rust backend | Do not port Electron. Keep Tauri/Rust. |
| Backend authority | TypeScript Effect server owns orchestration, terminal, Git, preview, source control | Rust owns OS access and exposes Tauri invoke commands | Port concepts, not Node server authority. |
| Orchestration | Commands, events, projections, snapshots, replay, receipts, queue reactors | Pi sessions and AI sessions have state, but not a unified event ledger | Port as Rust domain layer. |
| Provider adapters | Codex, Claude, OpenCode, Cursor, ACP runtime normalization | AI SDK providers and Pi sidecar, broad model support | Add canonical provider runtime contract, map Terax providers into it. |
| Approvals/user input | Pending approvals/questions are first-class events and thread shell fields | Tool approval exists for AI/Pi tools | Unify and persist approval/user-input lifecycle. |
| Turn queue | Busy-session aware queue, promote/pause/resume/remove | Not equivalent | Port after orchestration. |
| Checkpoints | Hidden Git-ref capture/restore/diff per turn | No equivalent checkpoint store | Port carefully in Rust with restore warnings. |
| Git and PRs | Stacked actions, branch/worktree/PR, gh/glab support | Source-control module has status/fetch/pull/push basics | Port Git workflows in stages. |
| Preview | Component harness, scenarios, controls, mocks, runtime bootstrap | Iframe preview plus artifact previews | Port component preview as optional feature. |
| Terminal | node-pty sessions, history persistence, activity tracking | portable-pty, shell integration, ring buffers, renderer pool | Keep Terax terminal. Borrow history/activity ideas only. |
| Workspace files | Root-bound file read/write with version conflict checks | Rust workspace registry and safe path policy | Borrow version conflict semantics if useful. |
| Composer | Rich command menu, model/mode switching, terminal/context attachments, skills | Terax has AI composer/session tooling | Borrow command UX and state layout. |
| Sidebar/workbench | Project/thread grouping, status, DnD, command palette, settings | Terax has explorer/tabs/status modules | Borrow dense workbench layout. |
| Design tokens/colors | Semantic CSS tokens, multiple theme families, composer-specific fill/border/shadow tokens, generated hue/saturation themes | Tailwind v4/shadcn semantic tokens, OKLCH light/dark defaults, built-in and custom theme files | Keep Terax engine; borrow Harness state matrix and token coverage. |
| Fonts/typography | DM Sans UI stack, SF Mono code stack, runtime UI/code font-size settings | Inter Variable UI font, JetBrains/Nerd-font-aware monospace fallback, CodeMirror font styling | Keep Terax fonts unless product direction changes; add font scaling if needed. |
| Motion/animation | 120 ms micro, 200 ms UI, 260 ms modal/sheet tokens, reduced-motion rules | Motion package, 120 ms micro transitions, spring floating windows, CSS collapsible keyframes, global reduced motion | Normalize Terax motion into explicit reusable tokens. |
| UI primitives/icons | Base UI primitives, icon-first controls, currentColor SVG strategy, symbols/custom/VS Code icons | shadcn/radix-luma primitives, hugeicons, Material/Catppuccin file icons | Do not copy component code wholesale. Borrow state coverage and icon affordance rules. |
| Editor/terminal theming | Monaco/diff/xterm surfaces consume app theme and font settings | CodeMirror themes, code highlight tokens, terminal tokens bridged to xterm | Keep Terax CodeMirror/xterm bridge; add orchestration-aware diff/checkpoint theming. |
| Image attachments | Data URL image uploads are normalized, size checked, persisted, and replayed in messages/queues | Terax composer already supports image, text-file, and selection attachments | Keep Terax attachment model, add durable orchestration-backed image metadata if needed. |
| Provider catalog | Provider install/auth/version/status, model options, custom models, provider skills and slash commands | Terax has BYOK/local provider discovery and model preferences | Borrow status and model-option presentation. |
| Project setup | Project scripts, setup script runner, repository identity cache, environment descriptors | Terax has workspace env and WSL support | Port only if threads/worktrees become durable projects. |
| Keybindings/editor openers | Static and script command keybindings, editor launch target list | Terax has shortcuts and editor surfaces | Borrow command schema, not Harness visual implementation. |
| Remote access | Pairing link/token/QR and session auth | No equivalent default | Optional, explicit enable only. |
| Settings | Client/server settings for UI, providers, notifications, cleanup, grouping | Terax has theme/settings areas | Borrow structured preference model. |
| Desktop updates | Electron update state, channel, download/install flow, architecture warnings | Terax uses Tauri updater | Borrow UX state-machine ideas only. |
| Observability | Analytics and OTLP proxy are wired in server | Terax product says no telemetry/account | Do not port telemetry defaults. Local diagnostics only. |
| Artifacts/MCP/model compare/workflow | Not the Harness center of gravity | Terax already has strong modules | Keep as Terax differentiators. |

## Harness subsystem inventory

### Monorepo and runtime

Harness is a Bun workspace with `apps/desktop`, `apps/marketing`, `apps/server`, `apps/web`, and shared packages. The root package uses Bun 1.3.11 and Node `^24.13.1`. The server package exposes the `forma` CLI and depends on Effect, node-pty, `effect-codex-app-server`, `@anthropic-ai/claude-agent-sdk`, and `@opencode-ai/sdk`.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/package.json:1-91`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/package.json:1-57`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/package.json:1-69`
- `/Users/mehmetcanbudak/Projects/harness/apps/desktop/src/main.ts:1-320`

Port value:

- Useful: packaging ideas, local backend bootstrap, update channel concepts, safeStorage-style secret protection.
- Do not port: Electron process model, Node as OS authority, web server as the privileged boundary.

### Orchestration domain

Harness has a full orchestration contract. Threads have projects, model selection, runtime mode, interaction mode, branch, worktree path, latest turn, queued turns, activities, checkpoints, session status, messages, and proposed plans. Commands cover project/thread create, fork, archive, delete, runtime/mode changes, turn start/interrupt, approval response, user input response, queue removal/resume, checkpoint revert, and session stop. Domain events are sequenced and carry metadata/correlation.

The server uses an orchestration engine with an in-memory read model, command queue, event store, projections, receipts, and pubsub. Reactors then listen for orchestration events and drive provider sessions, checkpoints, turn queue behavior, deletion, and runtime ingestion.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:20-27`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:137-145`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:388-420`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:523-759`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:899-928`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:1033-1145`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:1168-1310`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/Layers/OrchestrationEngine.ts:73-83`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/Layers/OrchestrationEngine.ts:136-190`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/Layers/OrchestrationEngine.ts:272-303`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/turnQueue.ts:47-68`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/turnQueue.ts:90-145`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/turnQueue.ts:164-224`

Terax migration:

- Create a Rust orchestration domain with explicit commands, events, projections, and a thread shell.
- Start with Terax Pi sessions as the first provider source.
- Keep the event schema serializable to TypeScript so React can subscribe to a single durable state stream.
- Gate the persistence decision. SQLite is a likely fit for events and projections, but it is a new dependency and should be accepted deliberately.

### Provider runtime and adapters

Harness separates provider behavior from orchestration. Provider adapters implement `startSession`, `sendTurn`, `interrupt`, approval response, user-input response, stop, list/read sessions, rollback, and event streaming. Provider runtime events normalize session/thread/turn/item lifecycle, tool calls, approvals, user questions, warnings, and errors.

Harness includes adapters for:

- Codex through `effect-codex-app-server`
- Claude through `@anthropic-ai/claude-agent-sdk`
- OpenCode through `@opencode-ai/sdk/v2`
- Cursor through ACP over `cursor agent acp`
- Generic ACP runtime process handling

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/provider.ts:26-58`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/provider.ts:61-72`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/provider.ts:92-123`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/providerRuntime.ts:20-30`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/providerRuntime.ts:51-78`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/providerRuntime.ts:112-154`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/providerRuntime.ts:156-205`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Services/ProviderAdapter.ts:45-126`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/ProviderService.ts:144-220`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/CodexAdapter.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/CursorAdapter.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/Layers/AcpSessionRuntime.ts`

Terax migration:

- Define a canonical provider runtime event contract in Terax.
- Map the existing Pi sidecar session events into that contract first.
- Map Terax AI SDK agent runs into the same contract second.
- Add direct Claude/Codex/Cursor/OpenCode adapters only after the normalized lifecycle is stable.
- Keep provider child processes and SDK sidecars behind Rust-mediated tools, cwd validation, approval policy, and workspace path checks.

### Provider catalog, model options, and image attachments

Harness also has provider catalog/status surfaces separate from runtime adapters. Server config exposes provider installed/auth/version/status, freshness, models, provider slash commands, and provider skills. Model contracts define provider option descriptors, custom model normalization, default models, and provider/model aliases. Built-in provider sources are ordered as Codex, Claude, OpenCode, and Cursor.

Harness supports image attachments in chat turns. Upload attachments are validated as image data URLs, size checked, assigned safe per-thread IDs, persisted to an attachment directory, and then represented as durable attachment metadata on messages and queued turns. The web UI renders image previews and expanded image dialogs. The composer also exposes context-window usage feedback.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/server.ts:36-113`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/server.ts:128-211`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/model.ts:5-52`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/model.ts:123-198`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/builtInProviderCatalog.ts:22-49`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/provider/providerSnapshot.ts:111-209`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:170-199`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:653-674`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/attachmentStore.ts:21-96`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/Normalizer.ts:70-141`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ExpandedImageDialog.tsx:26-123`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ContextWindowMeter.tsx:16-137`

Terax migration:

- Terax already has provider discovery, model preferences, image/text/selection attachments, voice input, and session persistence. Do not replace those.
- Borrow Harness's provider status shape: installed, auth status, version, freshness, model list, provider commands, and skills.
- If Terax adds durable orchestration threads, store attachment metadata in the orchestration layer and keep file bytes under Rust-owned app data.
- Keep Terax's existing secret/path safeguards for any attachment-derived file access.

### Approvals, user input, proposed plans, and turn queues

Harness treats approvals, user questions, and proposed plans as first-class orchestration state. The thread shell exposes pending approvals, pending user input, actionable plans, queue counts, and session status. Turn queue logic decides whether a turn starts immediately or is queued, and supports remove, pause, resume, and promotion.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:237-263`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:323-385`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:444-469`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:523-759`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/ProviderRuntimeIngestion.ts:31-48`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/ProviderRuntimeIngestion.ts:208-260`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/ProviderCommandReactor.ts:34-44`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/ProviderCommandReactor.ts:261-316`

Terax migration:

- Preserve Terax approval safety rules, but make approval prompts durable orchestration entities.
- Add user-input requests as a separate state type from tool approvals.
- Add proposed plan state that can be accepted, rejected, or used as context for the next turn.
- Add a turn queue only after the session event model exists, otherwise queue state will be brittle.

### Checkpoints, diffs, and revert

Harness checkpointing stores hidden Git refs. Capture uses a temporary Git index, `git add -A`, `git write-tree`, `git commit-tree`, and `git update-ref`. Restore uses `git restore`, `git clean`, and `git reset`. Diffs are generated with `git diff --patch --minimal --no-color` and parsed with `@pierre/diffs`.

Checkpoint reactors capture pre-turn and post-turn states, compute diff summaries, persist blobs, handle pending settlements, and coordinate provider conversation rollback during checkpoint revert.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.ts:1-9`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.ts:91-178`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.ts:185-221`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.ts:223-254`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.ts:257-273`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Diffs.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/CheckpointReactor.ts:89-97`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/CheckpointReactor.ts:148-194`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/CheckpointReactor.ts:237-260`

Terax migration:

- Implement checkpoint capture and diff in Rust around Git CLI or gitoxide/libgit2 after a storage decision.
- Keep restore as an explicit destructive operation with a clear changed-files preview.
- Do not let provider adapters restore files directly.
- Attach checkpoint IDs to Terax turns, activities, and model responses.

### Git, source control, worktrees, and PRs

Harness has rich Git contracts. It supports branch/worktree/PR schemas, stacked actions such as commit, push, create PR, commit-push, and commit-push-PR, plus PR preparation/listing and source-control provider discovery. GitHub and GitLab providers use CLI-backed discovery/auth and can create/clone/publish repositories.

Harness also generates AI commit and branch suggestions from staged summaries and patches, then runs commit/push/PR flows with progress phases.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/git.ts:9-18`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/git.ts:82-104`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/git.ts:118-180`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/sourceControl.ts:6-13`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/sourceControl.ts:25-37`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/sourceControl.ts:68-104`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/sourceControl.ts:107-152`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/git/Layers/GitManager.ts:1062-1106`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/git/Layers/GitManager.ts:1109-1220`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/git/Layers/GitManager.ts:1222-1319`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/git/Layers/GitManager.ts:1321-1380`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/sourceControl/Layers/SourceControlRepositoryService.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/sourceControl/Layers/GitHubSourceControlProvider.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/sourceControl/Layers/GitLabSourceControlProvider.ts`

Terax migration:

- Start by expanding Rust Git commands for branch/worktree and PR-ready metadata.
- Add GitHub CLI integration before GitLab/Azure/Bitbucket.
- Reuse Terax keychain/secrets handling for tokens and auth status.
- Keep AI commit/branch suggestion optional and visibly editable.
- Add worktree creation only after workspace registry safety checks cover generated worktree paths.

### Component preview harness

Harness preview is not just an iframe. It discovers framework type, component files, path aliases, and monorepo package context. It can bootstrap `.forma/preview/config.ts`, `wrapper.tsx`, and `mocks.ts`. It creates a temporary runtime workspace, launches Vite, renders a component preview shell, supports scenarios, controls, overrides, environment values, module mocks, and runtime feedback.

The preview harness also includes a feedback overlay. It can target elements or selected text, capture bounding boxes, computed styles, accessibility text, nearby text/elements, React component metadata, source file hints, scenario scope, viewport scope, and unsent/sent annotation state.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/preview.ts:13-23`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/preview.ts:30-50`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/preview.ts:53-168`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/preview.ts:170-257`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:107-124`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:223-304`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:306-320`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:392-452`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:455-535`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/Layers/PreviewManager.ts:566-715`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/runtime.tsx:1-18`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/runtime.tsx:94-143`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/runtime.tsx:145-170`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/runtime.tsx:192-212`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/runtime.tsx:230-260`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/feedback/types.ts:1-62`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/feedback/PreviewFeedbackOverlay.tsx:27-38`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/feedback/PreviewFeedbackOverlay.tsx:80-161`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/preview/harness/feedback/PreviewFeedbackOverlay.tsx:163-191`

Terax migration:

- Keep Terax iframe sandbox and artifact preview model.
- Add component preview as a workspace feature, not as the main preview replacement.
- Rust should own target path validation, runtime token issuance, port management, and process lifecycle.
- A Node/Vite sidecar is acceptable for bundling if it is unprivileged and temporary.
- Integrate preview feedback with Terax artifacts and AI context. Feedback should become structured context for the agent, not a telemetry channel.

### Terminal

Harness terminal management uses node-pty, session snapshots, output events, restart/close, history caps, history persistence, environment filtering, subprocess activity detection, and session eviction.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/terminal.ts:4-20`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/terminal.ts:37-95`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/terminal.ts:103-153`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:48-55`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:189-301`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:350-450`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:452-635`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:665-680`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:906-1019`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/terminal/Layers/Manager.ts:1128-1220`

Terax migration:

- Do not replace Terax terminal internals. Terax already uses Rust portable-pty, xterm WebGL, OSC 7/133 integration, dormant session rings, and renderer pooling.
- Borrow only history persistence, terminal activity indicators, restart semantics, and sanitized history contracts if they improve Terax UX.

### Workspace filesystem and local agents

Harness workspace services read and write files inside the workspace root, enforce size and binary checks, compute SHA-256 versions, and use expected-version conflict detection. It also indexes workspace entries with ignored directories and protected path settings.

Harness shared local-agent utilities parse markdown frontmatter skills and commands, expand `$ARGUMENTS` and positional placeholders, and expose local agent inventory contracts.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/workspace/Layers/WorkspaceFileSystem.ts:66-133`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/workspace/Layers/WorkspaceFileSystem.ts:136-241`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/workspace/Layers/WorkspaceEntries.ts:27-41`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/workspace/Layers/WorkspaceEntries.ts:203-220`
- `/Users/mehmetcanbudak/Projects/harness/packages/shared/src/localAgents.ts:78-147`
- `/Users/mehmetcanbudak/Projects/harness/packages/shared/src/localAgents.ts:149-225`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/localAgents.ts:11-38`

Terax migration:

- Terax already has Rust workspace registry and path safety. Add expected-version write conflict checks where editor and AI edits share files.
- Add local agent/command parsing to Terax composer, but use Terax skill/snippet concepts and local policy rather than copying Harness parser behavior blindly.

### Environment, project setup, keybindings, editor launchers, and VCS abstraction

Harness models an execution environment separately from a project/thread. Environment descriptors include platform OS, architecture, server version, and capabilities. Repository identity is resolved from Git remotes, normalized, cached, and attached to projects. Projects can define scripts, including setup scripts that run in a terminal when a worktree/thread is created.

Harness also has a command-aware keybinding schema. Commands include sidebar, terminal, diff, command palette, chat, editor favorite, Git actions, model picker jumps, thread jumps, and dynamic `script.<id>.run` commands. Editor launcher contracts include Cursor, Trae, Kiro, VS Code, VS Code Insiders, VSCodium, Zed, Antigravity, IntelliJ IDEA, and file manager targets.

The VCS contract is broader than only Git. It models drivers as `git`, `jj`, or `unknown`, exposes freshness sources, driver capabilities, repository identity, workspace file lists, remotes, and typed process/detection errors.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/environment.ts:5-33`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/environment.ts:36-78`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/orchestration.ts:201-231`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/project/Layers/ProjectSetupScriptRunner.ts:11-69`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/project/Layers/RepositoryIdentityResolver.ts:11-67`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/project/Layers/RepositoryIdentityResolver.ts:69-147`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/keybindings.ts:4-20`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/keybindings.ts:37-88`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/keybindings.ts:99-173`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/editor.ts:4-45`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/vcs.ts:5-31`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/vcs.ts:33-60`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/vcs.ts:62-155`

Terax migration:

- Keep Terax workspace registry, WSL support, and Rust Git authority.
- Add repository identity and project scripts only when durable projects/threads/worktrees exist.
- Port the keybinding command schema idea, but map it to Terax's existing shortcuts and command palette.
- Editor openers can be useful for "open in external editor", but should remain secondary to Terax's own editor.
- Consider `jj` only as a future VCS abstraction. Do not widen the Rust Git surface until the Git-backed features are stable.

### Web UI, sidebar, composer, and workspace panel

Harness web UI is a dense workbench. The central chat view coordinates active thread state, runtime mode, interaction mode, turn queue, proposed plans, settings, right panel, terminal state, and local dispatch. The composer supports provider/model controls, plan/ask/default modes, slash commands, local agents, skills, pending approvals, pending user input, terminal context, code context, and model picker. The workspace panel can render files/diffs/preview/terminal-like surfaces as a right sheet or resizable sidebar.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:5-9`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:75-99`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:121-132`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ChatComposer.tsx:201-241`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ChatComposer.tsx:248-353`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ChatComposer.tsx:624-720`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/ChatView.tsx:433-760`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/WorkspacePanelHost.tsx:14-105`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/WorkspacePanel.tsx:24-40`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/Sidebar.tsx:1-200`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/Sidebar.tsx:211-263`

Note: `DESIGN.md` was untracked in the observed Harness worktree. It is useful as a current product reference, but less authoritative than tracked source files.

Terax migration:

- Borrow the workbench composition, but do not make Terax a chat-first clone.
- Keep terminal/editor/preview as first-class surfaces.
- Add a richer composer command menu for model/mode/context/skills.
- Add thread/project grouping and status indicators if orchestration threads become durable.
- Use Terax's existing design system and frontend constraints rather than copying Harness visual code.

### Frontend design system, tokens, typography, and motion

Harness has a much more explicit frontend reproduction contract than Terax's current docs. The untracked `DESIGN.md` says a reproduction agent must preserve the three-pane workbench geometry, component nesting, semantic CSS tokens, typography scale, fixed dimensions, breakpoints, radii, borders, shadows, scroll ownership, overflow behavior, focus-visible, keyboard, drag-region, reduced-motion, safe-area/window-controls behavior, and a full state matrix covering empty, active, running, queued, approval, pending input, plan follow-up, disconnected/error, unavailable files, panel open/closed, and settings states.

The Harness token system is centered on `apps/web/src/index.css`. It defines Tailwind v4 theme aliases, semantic color tokens, radius aliases, UI and code text sizes, composer-specific fill/border/shadow/banner/footer variables, and motion variables. Static theme families are documented as `light`, `noir`, `dawn`, `dusk`, `midnight`, `stone`, `blueberry`, and `cosmic`. The runtime theme code also supports generated theme settings with mode, hue, saturation, high-contrast handling, terminal palettes, Monaco theme selection, diff theme family, desktop theme, icon theme, and dynamic CSS variables.

Typography differs from Terax. Harness uses `DM Sans` for UI and an `SF Mono`/Consolas/Menlo code stack. It also has runtime interface settings that clamp and apply UI font size, code font size, terminal font size, and macOS font smoothing through CSS custom properties. Terax currently uses Inter Variable and a JetBrains/Nerd-font-aware fallback; the migration should borrow Harness's font-scaling settings pattern, not necessarily its font family.

Motion is also more centralized in Harness. Constants and CSS variables define 120 ms micro motion, 200 ms UI motion, 260 ms modal/sheet motion, cubic-bezier easings, modal backdrop/popup classes, floating surface classes, sheet slide classes, and micro fade classes. `DESIGN.md` requires reduced motion to suppress transform movement and loader animations. Terax already has reduced motion and many 120 ms transitions, but it should centralize those into explicit shared tokens before porting many Harness states.

Harness UI primitives are componentized around Base UI and shared `components/ui` wrappers. Button styling encodes icon sizing, `currentColor` SVG inheritance, coarse-pointer hit-target expansion, focus-visible rings, disabled opacity, active scale, and dense size variants. Dialog/menu/sheet/command primitives reuse the motion classes. Switch has small stretch/translate micro-interactions. The design docs require icon-first controls, tooltips for non-obvious icons, compact symbol sizes, and avoiding large decorative cards.

Harness also applies design settings to developer surfaces. Terminal palettes are generated from theme mode, terminal font size is derived from code font scale, Monaco/diff surfaces use app theme and interface settings, and the theme bootstrap applies theme, app icon, and interface settings before render to avoid visual flashes.

Terax migration:

- Keep Terax's existing Tailwind/shadcn token base, Inter/JetBrains font strategy, theme file format, xterm bridge, CodeMirror theme mapping, and low-glare terminal-first identity.
- Borrow Harness's design checklist: explicit state matrix, scroll ownership rules, focus/keyboard/reduced-motion coverage, icon affordance rules, fixed dimensions, and density.
- Add shared Terax motion tokens for micro/UI/modal timing before introducing many new popovers, sheets, queue panels, or plan states.
- Add UI/code/terminal font-size settings if Terax wants Harness-level accessibility and density control.
- Do not copy Harness's static palettes, composer gradients, DM Sans default, or Base UI component code wholesale unless a deliberate product decision changes Terax's visual language.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:100-119`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:121-132`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:1444-1509`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:1737-1773`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:1804-1848`
- `/Users/mehmetcanbudak/Projects/harness/DESIGN.md:1852-1878`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/index.css:7-46`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/index.css:62-85`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/index.css:87-153`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/theme.ts:22-57`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/theme.ts:64-89`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/theme.ts:224-420`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/interfaceAppearance.ts:18-48`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/interfaceAppearance.ts:50-90`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/lib/motion.ts:7-91`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/ui/button.tsx:10-49`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/ui/dialog.tsx:24-91`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/ui/switch.tsx:7-25`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/themeBootstrap.ts:1-25`

### Remote access and auth

Harness documents remote access for another device on a trusted private network. It supports desktop remote toggle or `forma serve`, pairing links, one-time tokens, QR code flow, `forma auth`, session-based access, and auth access status streams. Auth policies include desktop-managed local, loopback browser, remote reachable, and unsafe no auth.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/REMOTE.md:1-87`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/auth.ts:28-33`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/auth.ts:49-70`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/auth.ts:95-129`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/auth.ts:139-180`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/auth.ts:183-241`

Terax migration:

- Treat remote access as optional and off by default.
- Keep local-first and no-account product posture.
- Require explicit bind address, pairing token, expiry, and session revocation.
- Reuse Terax SSRF/network safety thinking for remote server exposure.

### Settings, desktop notifications, updates, and observability

Harness has structured client and server settings: app icon, auto plan sidebar, archive/delete confirmations, desktop approval/user-input notifications, font sizes, favorite models, sidebar grouping/sorting, timestamp formats, provider settings, and thread environment mode.

Harness desktop IPC also exposes saved environment registry/secrets, server exposure mode, folder picker, native confirmation, theme setting, context menu, external links, thread attention notifications, and update state. Update state tracks enabled/disabled, channel, current/available/downloaded version, download percent, architecture, error context, and retry ability. The Electron app has a substantial updater state machine, but Terax should only borrow UX/state ideas because Terax already uses the Tauri updater.

Harness also wires analytics and observability/OTLP proxy services in the server. It has local tracing/log directory contracts too, which are more compatible with Terax than analytics.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/settings.ts:13-35`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/settings.ts:44-88`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/settings.ts:132-178`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/settings.ts:185-220`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/ipc.ts:110-188`
- `/Users/mehmetcanbudak/Projects/harness/packages/contracts/src/ipc.ts:205-238`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/desktopUpdate.logic.ts:5-109`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/server.ts:1-90`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/ws.ts:142-170`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/ws.ts:174-179`

Terax migration:

- Borrow structured settings and notification categories.
- Borrow update UX state where it improves the Tauri updater UI.
- Do not port telemetry or analytics as default behavior.
- If diagnostics are needed, make them local, visible, and exportable by the user.

### Persistence, migrations, and test surface

Harness has an unusually explicit persistence evolution surface for an app of this shape. The server migrations cover orchestration events, command receipts, checkpoint diff blobs, provider session runtime, projections, runtime modes, message attachments, proposed plans, archived threads, snapshot lookup indexes, auth access management, shell summaries, turn queue, preview project config/state, fork lineage, and model-option canonicalization. The repository also contains a broad test surface across contracts, orchestration, provider adapters, checkpointing, Git, source control, preview, auth, terminal, workspace, and UI logic.

The second-pass file count found 282 Harness paths matching `*test*` and 140 Terax paths matching `*test*`. This is only a rough filesystem signal, not a coverage measurement. It still matters because Harness's implementation style tends to lock behavior with focused tests around contracts, deciders, reactors, migrations, and UI logic.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/003_CheckpointDiffBlobs.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/005_Projections.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/013_ProjectionThreadProposedPlans.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/020_AuthAccessManagement.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/026_ProjectionThreadTurnQueue.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/027_ProjectionProjectPreviewConfig.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/persistence/Migrations/029_ProjectionThreadsForkLineage.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/orchestration/decider.queue.test.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/server/src/checkpointing/Layers/CheckpointStore.test.ts`
- `/Users/mehmetcanbudak/Projects/harness/apps/web/src/components/chat/ComposerQueuedTurnsPanel.test.tsx`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/workflow/lib/workflowExecution.test.ts`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/git/operations/tests.rs`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/pi/PiChatPanel.test.tsx`

Terax migration:

- Treat Harness tests as implementation guidance when porting behavior: start with contracts/deciders before UI.
- Add Rust tests for event append/projection, checkpoint safety, workspace authorization, and restore edge cases.
- Add React tests for queue/approval/user-input/proposed-plan rendering.
- Do not port Harness migration files directly. Use them as a checklist for state evolution concerns.

## Terax current coverage and strengths

### Rust/Tauri OS boundary

Terax's project documentation says Rust owns all OS access, including PTY, filesystem, Git, shell, workspace, network, and secrets. The Tauri invoke handler registers PTY, Pi, MCP, artifacts, model compare, filesystem, Git, shell, workspace, agent, secrets, and network commands. This is the right boundary to preserve.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:41-52`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/lib.rs:177-332`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/Cargo.toml:1-100`
- `/Users/mehmetcanbudak/Projects/terax-pi/package.json:1-143`

### Product direction

Terax positions itself as a terminal-first AI-native workspace, not a heavy IDE, account service, or telemetry-dependent app. Users want fast terminal-first work with AI, editor, source control, preview, BYOK, and local model options.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/PRODUCT.md:9`
- `/Users/mehmetcanbudak/Projects/terax-pi/PRODUCT.md:13`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:7`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:17-25`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:31-35`

### Frontend design, themes, typography, and motion

Terax should not discard its current design system to copy Harness. The existing Terax frontend already uses Tailwind v4, shadcn/radix-luma primitives, a semantic CSS token layer, OKLCH light/dark defaults, Inter Variable for the UI, a JetBrains/Nerd-font-aware monospace fallback for editor/terminal surfaces, and a custom theme engine that writes CSS variables into the document.

The Terax theme system is more file-backed and user-extensible than Harness's generated hue/saturation theme preference. A Terax theme can define semantic UI colors, sidebar colors, radius, terminal colors, and editor theme mappings. Built-in themes include `terax-default`, `claude`, `tokyo-night`, `nord`, `tide`, `sage`, `catppuccin`, `gruvbox`, `rose-pine`, and `caffeine`; user themes are `.terax-theme` JSON files under the app config themes directory and are validated before use.

Terax also already bridges theme tokens into the most important developer surfaces:

- xterm consumes `--terminal-*` tokens through `readTerminalTokens()` and `buildTerminalTheme()`.
- CodeMirror consumes a detected monospace stack, transparent surface styling, semantic selection/cursor/panel colors, and prebuilt editor themes.
- Global code highlight CSS uses token variables for syntax categories.
- Borderless window chrome, app background, and `theme-color` metadata are synced through the theme provider.

Motion is present but less centralized than Harness. Terax uses `motion/react` for AI/status/search/floating-window interactions, 120 ms micro fades in several components, 320/32 spring settings for floating AI/Pi windows, CSS collapsible keyframes at 180 ms/140 ms, and a global `prefers-reduced-motion` rule that disables animation, scroll behavior, and transitions. The migration should turn those recurring timings into named app motion tokens before adding many Harness-style states.

Accessibility and product fit matter here. Terax product docs make WCAG AA, focus visibility, labels, keyboard access, reduced motion, low-glare themes, and screen-reader labels for icon-heavy controls core requirements, not polish. Any Harness UI port should be checked against that baseline.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:79-80`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:93`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:113-119`
- `/Users/mehmetcanbudak/Projects/terax-pi/PRODUCT.md:25-33`
- `/Users/mehmetcanbudak/Projects/terax-pi/package.json:52-55`
- `/Users/mehmetcanbudak/Projects/terax-pi/package.json:94-115`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/globals.css:11-52`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/globals.css:54-145`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/globals.css:174-196`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/globals.css:337-377`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/fonts.css:1-22`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/tokens.ts:1-76`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/styles/terminalTheme.ts:1-29`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/types.ts:1-79`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/applyTheme.ts:1-108`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/ThemeProvider.tsx:46-94`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/ThemeProvider.tsx:96-213`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/themes/index.ts:1-38`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/themeFiles.ts:8-65`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/themeFiles.ts:68-109`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/validateTheme.ts:12-40`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/theme/validateTheme.ts:68-154`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/lib/fonts.ts:1-55`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/editor/lib/extensions.ts:24-95`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/editor/lib/themes.ts:1-23`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/components/AiChatMessage.tsx:390-398`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/components/AiMiniWindow.tsx:96-132`

### Terminal

Terax terminal already has a stronger native foundation than Harness for this product. It uses portable-pty, xterm WebGL, session maps, dormant byte rings, bind/release snapshots, alt-screen handling, OSC prompt/cwd handlers, and renderer pooling.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:54-65`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/terminal/lib/useTerminalSession.ts:60`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/terminal/lib/useTerminalSession.ts:200-205`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/terminal/lib/useTerminalSession.ts:233-286`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/terminal/lib/rendererPool.ts:17`

### AI, Pi, and tools

Terax already has broad BYOK/local provider coverage through the AI SDK, including OpenAI, Anthropic, Google, xAI, Cerebras, DeepSeek, Mistral, Groq, OpenRouter, OpenAI-compatible endpoints, LM Studio, MLX, and Ollama. Terax tool policy includes read-only auto tools, mutating tool approvals, read-before-edit constraints, and active-cwd path handling.

Terax also has a Pi sidecar protocol where Rust owns session directories, cwd/workspace validation, Rust-mediated tools, and approvals while the Node sidecar hosts the Pi SDK.

Terax composer support is broader than plain text. It has shared input state for text, attachments, and voice; attachments include image, text-file, and terminal/editor selection kinds. The live context bridge reads the active terminal cwd and recent buffer lazily at tool execution time rather than pre-snapshotting.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:99-111`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/lib/agent.ts:76-224`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/lib/agent.ts:306-327`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/lib/agent.ts:396-495`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/tools/tools.ts:15-30`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:105-109`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/hooks/useWhisperRecording.ts`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/ai/lib/composer.tsx`
- `/Users/mehmetcanbudak/Projects/terax-pi/docs/pi-session-protocol.md:3-13`
- `/Users/mehmetcanbudak/Projects/terax-pi/docs/pi-session-protocol.md:15-68`
- `/Users/mehmetcanbudak/Projects/terax-pi/docs/pi-session-protocol.md:70-97`
- `/Users/mehmetcanbudak/Projects/terax-pi/sidecars/pi-host/sessions.js:371-410`
- `/Users/mehmetcanbudak/Projects/terax-pi/sidecars/pi-host/sessions.js:667-737`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/pi/host/bridge.rs:201-299`

### Workspace, local agents, shortcuts, and updater

Terax has workspace environment support, including local and WSL modes, WSL distro discovery, and WSL home lookup. Terax also has one-shot shell execution, persistent agent shell sessions, and background shell processes with bounded log buffers.

Terax has a terminal coding-agent notification layer. It detects terminal agent status, routes attention/finished/error notifications, suppresses notifications when the user is already viewing the agent, and can use OS notifications or in-app toasts depending on focus.

Terax already has a shortcut registry for command palette, tabs, panes, terminal, search, AI, view, editor, settings, sidebar, and shortcuts dialog commands. It also has a Tauri updater hook with idle/checking/up-to-date/available/manual-available/downloading/ready/error states.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:47-49`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:84-95`
- `/Users/mehmetcanbudak/Projects/terax-pi/TERAX.md:121-148`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/workspace/env.ts:5-60`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/agents/lib/route.ts:29-66`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/shortcuts/shortcuts.ts:7-64`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/shortcuts/shortcuts.ts:64-220`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/updater/useUpdater.ts:19-28`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/updater/useUpdater.ts:84-153`

Migration impact:

- Harness should not be treated as a replacement for these Terax features.
- Project/environment, keybinding, and updater ideas from Harness should be merged into existing Terax modules.
- Remote pairing and provider adapter additions must respect Terax's local/WSL workspace distinction.

### Security and safety

Terax already has capability manifests, workspace spawn authorization, path safety checks, sensitive path detection, keychain usage, and SSRF/network guards. These are stricter than Harness's Node server boundary and should be used as the foundation for every ported feature.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/capabilities/manifests.rs:11-17`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/capabilities/manifests.rs:219-367`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/workspace.rs:83-126`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/fs/safety.rs:26-64`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/fs/safety.rs:143-195`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/net.rs:90-175`

### Artifacts, MCP, workflow, model compare, editor, preview, and Git

Terax already has features Harness does not appear to center:

- Durable app-owned artifacts with Rust storage, versioning, validation, export, React compilation, and sandboxed iframe rendering.
- MCP state, saved stdio servers, policy, env handling, and OAuth-related command surfaces.
- A workflow canvas with approved execution routes.
- Model compare with read-only scoped tools, streaming metrics, and cost data.
- CodeMirror editor document load/save.
- Iframe preview with teardown and sandbox.
- Source-control status, fetch, pull, push, and Git commands behind the workspace registry.

Evidence:

- `/Users/mehmetcanbudak/Projects/terax-pi/docs/artifacts.md:3-13`
- `/Users/mehmetcanbudak/Projects/terax-pi/docs/artifacts.md:29-49`
- `/Users/mehmetcanbudak/Projects/terax-pi/docs/artifacts.md:51-72`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/mcp.rs:65-117`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/mcp.rs:210-235`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/mcp.rs:340-448`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/workflow/lib/schema.ts:4-35`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/workflow/lib/execution/approved.ts:71-128`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/model-compare/lib/runModelCompare.ts:21-31`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/model-compare/lib/runModelCompare.ts:137-232`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/model-compare/lib/runModelCompare.ts:258-321`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/editor/lib/useDocument.ts:50-60`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/editor/lib/useDocument.ts:77-132`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/preview/PreviewPane.tsx:31-33`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/preview/PreviewPane.tsx:109-122`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/src/modules/git/commands.rs:10-21`
- `/Users/mehmetcanbudak/Projects/terax-pi/src/modules/source-control/useSourceControl.ts:74-138`

## Recommended Terax implementation sequence

### Phase 0: Domain contract design

Create a Terax orchestration contract before implementation. It should define:

- Project
- Thread
- Turn
- Message
- Activity
- Provider session
- Runtime mode
- Interaction mode
- Approval request
- User input request
- Proposed plan
- Turn queue item
- Checkpoint summary
- Attachment metadata
- Provider status snapshot
- Repository identity
- Project script
- Domain event
- Command receipt

Output should be Rust structs plus TypeScript-facing serialized shapes. Do not start by adding provider adapters.

### Phase 1: Rust orchestration event core

Implement a Rust-owned orchestration service:

- Accept commands through Tauri invoke.
- Append domain events.
- Build in-memory projections.
- Expose snapshot and event subscription to React.
- Persist command receipts and event sequence once the storage choice is made.
- Adapt existing Pi session events into the new event stream.

Success criterion:

- A Pi thread can start, stream messages/activities, ask for approval, complete, and be restored from projection state after app reload.

### Phase 2: Provider runtime normalization

Normalize provider events:

- session started/ready/running/error/closed
- turn started/delta/completed/failed
- assistant text delta
- tool call lifecycle
- approval request/response
- user question/response
- proposed plan lifecycle
- warning/error

Start with Terax Pi and existing AI SDK agent. Add Codex/Claude/Cursor/OpenCode only after the normalized model is stable.

In parallel with event normalization, define the provider catalog/status shape: provider availability, version, auth status, freshness, model list, provider options, slash commands, and skills. This is UI state, not the same thing as active runtime execution.

### Phase 3: Queue, approvals, user input, and plans

Add UI and state for:

- One active turn per provider session.
- Queue turn when busy.
- Pause/resume/remove queued turns.
- Durable pending approvals.
- Durable pending user questions.
- Proposed plan display and action buttons.
- Durable image attachment metadata on user messages and queued turns.

This should be driven by orchestration state, not scattered component state.

### Phase 4: Checkpoints and diffs

Implement Rust Git-ref checkpoints:

- Capture pre-turn and post-turn tree state.
- Produce patch summaries.
- Attach diffs to turns.
- Render diff and checkpoint summary in the right workspace panel.
- Add checkpoint revert only with explicit destructive confirmation and a preview of affected files.

This phase should include tests around dirty worktrees, untracked files, ignored files, nested repos, and worktrees.

### Phase 5: Workbench and composer upgrade

Borrow Harness UI ideas, with a Terax design-system alignment pass:

- Project/thread sidebar grouping and statuses.
- Thread shell statuses for pending approval, pending user input, running, queued, failed, completed.
- Bottom composer command menu for model, mode, context, local agents, and skills.
- Provider status/model picker surface with install/auth/version warnings.
- Context-window meter and visible attachment chips if current Terax surfaces do not already cover the state.
- Expandable right workspace panel for files, diffs, preview, terminal, artifacts, and model compare.
- Harness-style state matrix for empty, running, queued, approval, pending user input, plan follow-up, disconnected/error, files unavailable, panel open/closed, mobile sheet, and reduced-motion states.
- Shared Terax motion tokens for micro, UI, modal/sheet, spring, and reduced-motion behavior.
- Optional UI/code/terminal font-size settings, using Terax's current fonts unless there is a deliberate product decision to change them.
- Token coverage for new queue, approval, model picker, provider status, preview feedback, diff, and checkpoint surfaces.

Keep Terax terminal/editor/preview as primary work surfaces. Do not bury them behind chat.

### Phase 6: Git, worktrees, PRs, and source control

Extend Terax Git:

- Branch list/create/checkout.
- Worktree create/remove/open through workspace registry.
- Commit/push flow with progress events.
- GitHub CLI PR creation and PR status.
- Optional AI-generated commit title/body, always editable.
- Later: GitLab support.

### Phase 7: Project scripts, repository identity, keybindings, and editor openers

Add the smaller Harness workflow surfaces once durable projects/worktrees exist:

- Repository identity from remotes.
- Project scripts and setup-on-worktree-create behavior.
- Script run commands in the command palette and shortcut system.
- Open-in-external-editor actions for common editors.
- Optional VCS abstraction notes for future `jj`, while keeping implementation Git-first.

### Phase 8: Component preview harness

Add optional component previews:

- Detect Vite/Next/Remix/TanStack Router projects.
- Bootstrap Terax preview config, wrapper, mocks.
- Generate isolated runtime workspace.
- Issue preview runtime tokens.
- Expose scenarios, controls, environment values, and feedback.
- Capture structured preview feedback annotations as agent context.

Keep Vite/Node as an unprivileged sidecar where needed.

### Phase 9: Remote pairing

Only after the local model is stable:

- Add explicit remote-access toggle.
- Bind to loopback by default.
- Require one-time pairing token with expiry.
- Support revocation.
- Show current exposure and active sessions.
- Keep no-account and no-telemetry defaults.

## Features to avoid or defer

- Do not port Electron.
- Do not port the Harness Node server as Terax's privileged backend.
- Do not port analytics or OTLP telemetry defaults.
- Do not port the marketing app.
- Do not copy Harness UI code wholesale.
- Do not replace Terax's theme engine, Inter/JetBrains font strategy, CodeMirror theme mapping, or xterm token bridge with Harness's web theme implementation.
- Do not copy Harness palettes, composer gradients, or DM Sans default wholesale. Borrow density, state coverage, focus behavior, icon strategy, font-scale settings, and motion discipline.
- Do not add new motion-heavy queue/panel/modal interactions unless they respect Terax's global reduced-motion baseline.
- Do not add Codex/Claude/Cursor/OpenCode provider adapters before Terax has a stable provider-runtime event model.
- Do not make checkpoint restore automatic.
- Do not expose remote access by default.
- Do not weaken Terax path, network, secrets, or approval policy to match Harness behavior.

## License and reuse notes

Harness is MIT licensed. Terax is Apache-2.0. MIT code can generally be reused in Apache-2.0 projects if copyright and license notices are preserved, but direct copying would still create maintenance and attribution obligations.

Recommendation: use clean-room reimplementation for architecture, contracts, and UI behavior. If any Harness code is copied directly, add the MIT notice and keep the copied scope small and traceable.

Evidence:

- `/Users/mehmetcanbudak/Projects/harness/LICENSE:1-21`
- `/Users/mehmetcanbudak/Projects/terax-pi/src-tauri/Cargo.toml:1-100`

## Key risks and open decisions

- Persistence: Harness uses migrations and an event store. Terax needs an explicit Rust persistence choice before durable orchestration is complete.
- Provider SDKs: Some provider integrations are TypeScript-first or CLI-first. Terax should keep Rust as authority and use sidecars only for SDK/runtime gaps.
- Checkpoint restore: `git clean` and reset-style flows are destructive. Terax must preview and confirm.
- Worktrees: Generated worktree paths must be covered by workspace registry authorization.
- Remote access: Any remote server changes Terax's threat model and should be off by default.
- Harness `DESIGN.md`: useful product reference, but untracked in the observed worktree.
- Visual migration: Harness's documented visual language uses DM Sans, SF Mono, generated hue/saturation themes, and several static theme families, while Terax uses Inter Variable, JetBrains/Nerd-font-aware monospace, file-backed custom themes, OKLCH semantic defaults, and low-glare terminal-first constraints. Recommendation: keep Terax's visual identity and borrow Harness's state matrix, density, focus, motion, and font-scaling patterns.
- Token mismatch: Harness's generated theme variables include diff and composer-specific visual tokens. Terax should add missing semantic tokens only when a new surface needs them, not import the entire Harness token table.
- Runtime behavior: This report is based on code inspection. It should be validated by running both apps before implementation priorities are locked.

## Final recommendation

Port Harness in this order:

1. Orchestration event core.
2. Provider runtime normalization.
3. Queue, approvals, user input, and proposed plans.
4. Checkpoints, diffs, and revert.
5. Composer/sidebar/right-panel workbench upgrades plus design-system alignment.
6. Git stacked actions, worktrees, PRs, and source-control discovery.
7. Project scripts, repository identity, keybindings, and editor openers.
8. Component preview harness and structured preview feedback.
9. Local agent commands and skills.
10. Optional remote pairing.

Keep Terax's Rust/Tauri OS boundary, terminal-first product identity, BYOK/local model breadth, Pi integration, artifacts, MCP, model compare, and workflow features. Harness should expand Terax's agent workflow depth, not replace Terax's architecture.
