# TERAX.md

Terax loads `TERAX.md` from the workspace root as agent memory (similar to AGENTS.md / CLAUDE.md). This file is also the project's living architecture doc — read it before making changes.

## Project

**Terax** — open-source AI-native terminal emulator. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client, BYOK AI via Vercel AI SDK v6.

- Bundle id: `app.crynta.terax`
- Package manager: **pnpm**
- Platforms: macOS, Linux, Windows
- Frontend type-check: `pnpm exec tsc --noEmit`
- Rust checks: `cd src-tauri && cargo check && cargo clippy`

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. The webview never touches the FS, processes, or shells directly — everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`:

- `pty::pty_*` — long-lived interactive PTY sessions (xterm ↔ portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`). Output streams via a Tauri `Channel<PtyEvent>`.
- `fs::tree::*`, `fs::file::*`, `fs::mutate::*` — file explorer + editor IO.
- `fs::search::*`, `fs::grep::*` — fuzzy file finder + content search (powered by `ignore` + `grep-*` crates).
- `shell::shell_run_command` — **one-shot** subshell exec used by AI tools. Distinct from PTY sessions; not the user's interactive terminal. On Windows it shells out via PowerShell (`-NoProfile -Command`); on Unix via `$SHELL -lc`. Shared helper `build_oneshot_command`.
- `shell::shell_session_*` — persistent agent shell with state across calls.
- `shell::shell_bg_*` — long-running background processes (dev servers etc.) with bounded ring-buffer log capture.
- `secrets::secrets_*` — OS keychain via the `keyring` crate. Service constant `terax-ai`. Linux uses a file-based fallback gated behind `#[cfg(target_os = "linux")]`.
- `open_settings_window` — separate webview window for Settings.

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- **Unix** (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`) — installed via `ZDOTDIR` (zsh) or `--rcfile` (bash). Emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries without re-parsing the prompt.
- **Windows** (`profile.ps1`) — passed via `pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <path>`. Wraps the user's existing `prompt` function (after their `$PROFILE` runs) to emit OSC 7 + OSC 133 A/B/D. Shell priority: `pwsh.exe` (PS 7+) → `powershell.exe` (PS 5.1) → `cmd.exe` (no integration). cwd is normalized to backslashes before being passed to ConPTY (`CreateProcessW` misbehaves with forward-slash cwd).

`pty/shell_init.rs` is split into `#[cfg(unix)]` / `#[cfg(windows)]` modules — keep new platform-specific code in the right cfg arm.

ConPTY on Windows requires `SPAWN_LOCK` (Mutex) around `openpty + spawn_command` in `session.rs`. Concurrent spawns leave one of the resulting PTYs with a stalled output pipe. Don't remove the lock without verifying first-tab stability under fast tab spam.

Each ConPTY child is also assigned to a per-session **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`pty/job.rs`). When the Job HANDLE drops — clean shutdown, panic, or even SIGKILL'd Terax process — the kernel kills every descendant of the shell (e.g. `npm run dev` spawned from inside pwsh). Without this Windows orphans the entire process subtree because `TerminateProcess` only kills the immediate child. macOS/Linux rely on `Drop for Session → killer.kill()`; on dev-`Ctrl-C` of `cargo run` destructors don't fire and orphans are possible there too — acceptable for now since dev only.

`AiComposerProvider` is mounted unconditionally at the App.tsx root: a conditional wrapper would change the parent element type when keys load, remounting the entire tree (and re-spawning every PTY) the moment `getAllKeys()` resolves. Production happened to dodge this because keychain reads can land in the same paint frame; dev didn't. Keep the unconditional wrap.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` → `src/*`. Tabs are tagged-union (`{ kind: "terminal" | "editor" | "preview" | "ai-diff", … }`) and **not** unmounted on switch — they're hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming in the background.

`App.tsx` wires modules together — keep it a coordinator. New features go inside the appropriate `modules/<area>/`.

### Module layout (`src/modules/`)

Each module is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`.

- **terminal/** — `TerminalStack` keeps one mounted xterm per tab via `useTerminalSession` + `pty-bridge`. `osc-handlers.ts` parses OSC 7 (with Windows drive-letter normalization: `/C:/Users/foo` → `C:/Users/foo`) and OSC 133 markers. Themes in `themes.ts`.
- **editor/** — CodeMirror 6 stack (`EditorStack` mirrors `TerminalStack`). `extensions.ts` configures language modes; supports vim mode and prebuilt themes (Tokyo Night, Nord, GitHub, Atom One, Aura, Copilot, Xcode).
- **explorer/** — file tree with Material/Catppuccin icons (`iconResolver.ts`), fuzzy search, keyboard nav, inline rename, context actions. Backslash-aware `basename`.
- **preview/** — auto-detected dev-server preview tab (status-bar pill suggests opening when a localhost URL is detected).
- **tabs/** — `useTabs` is the source of truth for tab list + active id. `useWorkspaceCwd` derives explorer root + inherited cwd for new tabs from active tab. `basename` splits on both `/` and `\`.
- **header/** — top bar + inline search (`SearchInline` adapts to terminal vs editor via `SearchTarget`). `WindowControls` rendered when `USE_CUSTOM_WINDOW_CONTROLS` is true (Linux + Windows; macOS uses native traffic lights).
- **statusbar/** — bottom bar, `CwdBreadcrumb` (handles Unix paths, Windows drive letters, and home `~` segments via `pathUtils.segmentsFromCwd`), AI tools indicator.
- **shortcuts/** — keymap registry (`shortcuts.ts`) + `useGlobalShortcuts`. Handlers live in `App.tsx` and are passed in by id (`tab.new`, `ai.toggle`, …). `metaKey || ctrlKey` for cross-platform Cmd/Ctrl.
- **settings/** — settings store (`store.ts` via `tauri-plugin-store`), preferences hook, settings window opener.
- **shell-integration/** — frontend bridge for OSC events and shell session lifecycle.
- **theme/** — `next-themes` provider.
- **updater/** — auto-updater UI built on `tauri-plugin-updater`.
- **ai/** — see below.

### AI subsystem (`src/modules/ai/`)

BYOK. Multi-provider via `@ai-sdk/*`: **OpenAI, Anthropic, Google, Groq, xAI, Cerebras, OpenAI-compatible** (LM Studio for local/offline). Provider list in `config.ts` (`PROVIDERS`); model registry includes `DEFAULT_MODEL_ID` + `DEFAULT_AUTOCOMPLETE_MODEL`.

- **Key storage**: OS keychain via `keyring` (Rust). Frontend reads/writes through `secrets_*` commands. Service `KEYRING_SERVICE = "terax-ai"`. Never persist keys to disk, settings store, or `localStorage`.
- **Agent** (`lib/agent.ts`): `Experimental_Agent` with `stopWhen: stepCountIs(MAX_AGENT_STEPS)` and the system prompt from `config.ts`. Provider branching happens here — keep the `Agent` / `DirectChatTransport` shape; the rest of the system depends on AI SDK v6 chat semantics.
- **Sub-agents** (`agents/registry.ts`, `agents/runSubagent.ts`): named sub-agents with their own system prompts and tool subsets, invoked by the main agent via `run_subagent` tool.
- **Sessions** (`lib/sessions.ts` + `store/chatStore.ts`): conversations are organized into named sessions, persisted via `tauri-plugin-store` at `terax-ai-sessions.json` (list + `activeId` + per-session `messages:<id>` keys). `chatStore.ts` keeps a module-scoped `Map<sessionId, Chat<UIMessage>>`; `getOrCreateChat(apiKey, sessionId)` lazily constructs a `Chat`, seeded with messages from a hydration map populated by `hydrateSessions()` (called once from `App.tsx`). `AgentRunBridge` mirrors active-session messages to disk on every change and auto-derives titles from the first user message. Switching the API key wipes the chat map; sessions persist.
- **Composer** (`lib/composer.tsx`): React context providing shared input state (text, attachments, voice) for both the docked `AiInputBar` and any other surface. Attachments include image, text-file, and `selection` kinds — selections come from `useChatStore.attachSelection(text, source)` (drained into chips, not pasted into the textarea) and are wrapped as `<selection source="terminal|editor">…</selection>` blocks at submit. Composer derives `isBusy` from `agentMeta.status` so it can mount safely before sessions hydrate.
- **Voice input**: streamed transcription pipeline. Toggled from the composer.
- **Live context bridge**: `App.tsx` calls `setLive({ getCwd, getTerminalContext, … })` so tools can read the *currently active* terminal's cwd + last 300 lines of buffer. Lazy by design — don't pre-snapshot.
- **Tools** (`tools/tools.ts`): `read_file`, `list_directory`, `fs_search`, `fs_grep` auto-execute. `write_file`, `create_directory`, `rename`, `delete`, `run_command`, `shell_session_run`, `shell_bg_spawn` set `needsApproval: true` and the AI SDK pauses for an in-UI confirmation card. Auto-send after approval uses `lastAssistantMessageIsCompleteWithApprovalResponses`. `lib/security.ts` is a deny-list refusing obvious secret paths (`.env*`, `.ssh/`, credentials, keychain dirs) — apply on **both** read and write paths and don't bypass it.
- **Edit diffs**: AI-proposed edits open in a side-by-side diff tab (`ai-diff` tab kind); user accepts/rejects per hunk before the write tool actually runs. Rendered by `@pierre/diffs` (`FileDiff` React component, parsed via `parseDiffFromFile`) — same `originalContent`/`proposedContent` shape as before, just a richer renderer.
- **Skills / snippets**: reusable prompt fragments + tool-bundles surfaced in the composer.

### External agents over ACP (`src/modules/ai/agents-acp/`, `src-tauri/src/modules/agents/`)

Parallel path to the BYOK provider list above: instead of calling a model API directly, Terax spawns an external coding-agent CLI that already speaks the [Agent Client Protocol](https://agentclientprotocol.com/) and forwards its streamed tool calls, diffs, and permission requests into the *same* chat UI. Claude Code (via `claude-code-acp`), OpenAI Codex (`codex-acp`), and Gemini CLI (`--experimental-acp`) ship today; the dispatch table is `BackendProtocol` in `src-tauri/src/modules/agents/backend.rs` and is sized to absorb non-ACP transports later (Aider, OpenCode HTTP, etc.) without touching the frontend.

- **Rust side** (`src-tauri/src/modules/agents/`): `backend.rs` is the static registry (binary names, `auth_envs` keychain→env-var mappings, install hints). `detection.rs` resolves binaries on `$PATH`. `spawn.rs` is a thin `ConnectTo<Client>` impl that wraps a pre-built `tokio::process::Command` — needed because `agent_client_protocol_tokio::AcpAgent` can only *add* env vars, not remove them, and we need both. `runtime.rs` owns per-session state (driver task + `mpsc<Command>` + `pending_perms` map for the approval round-trip). `probe.rs` is the Settings → "Test connection" / "Deep test" diagnostic.
- **Spawn env hygiene**: every spawn `env_remove`s the `CLAUDE_*` / `CLAUDECODE` family of vars that Claude Desktop's local-agent runtime leaks. Without that, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` poisons the shim into IPC-mode and surfaces as `ECONNREFUSED`. Strip list is `POISON_VARS` in `runtime.rs`.
- **Auth**: each backend declares one or more `AuthEnv { account, env_name, label, hint }` entries. Settings → External Agents renders one inline input per entry (API key for pay-per-token, OAuth token from `claude setup-token` for Pro/Max). We forward every populated entry; the shim's own auth chain decides precedence. Empty inherited values get `env_remove`'d so they can't poison the chain.
- **Frontend transport** (`src/modules/ai/agents-acp/transport.ts`): implements `ChatTransport<UIMessage>` so the existing `Chat` from `@ai-sdk/react` doesn't know or care which path is underneath. The `chatStore` transport is a delegating wrapper that picks ACP vs direct-API per `sendMessages` call based on `isAgentBackendModel(selectedModelId)` — so switching models mid-conversation just works. ACP `SessionUpdate` notifications translate to `UIMessageChunk`s; `RequestPermissionRequest` becomes a `tool-approval-request` chunk routed through the existing `AiToolApproval` card; `Diff` content parts push `QueuedEdit`s into `planStore` so the existing diff pane renders agent-proposed edits unchanged.
- **Synthetic model ids** (`AGENT_BACKENDS` in `config.ts`): `agent-claude-code`, `agent-codex`, `agent-gemini`. Picker renders them in an "External Agents" group; `isAgentBackendModel` is the branching predicate.
- **Test from Settings**: `agent_backend_test` Tauri command runs the full spawn + handshake, optionally including a real prompt round-trip ("Deep test"). Surfaces stripped env vars, forwarded auth, proxy reachability (catches `ECONNREFUSED` when an `HTTPS_PROXY` is set but down), and the agent's stderr.

### UI conventions

- **shadcn/ui** is configured (`components.json`, style `radix-luma`, base `mist`, icon lib **hugeicons**). Primitives in `src/components/ui/` — don't hand-edit; re-run `pnpm dlx shadcn add` to upgrade.
- **AI Elements** (Vercel) live in `src/components/ai-elements/` from the `@ai-elements` registry in `components.json`. Same rule: regenerate, don't hand-patch — composition wrappers belong in `modules/ai/components/`.
- **Tailwind v4** — no `tailwind.config.*`, config is in `src/App.css` via `@theme`. Use `cn()` from `@/lib/utils`.
- Animation: `motion` (Framer Motion successor). Resizable layout: `react-resizable-panels`.
- Path imports: always `@/…`, never relative across modules.
- Cross-platform paths: anywhere a path may originate from OSC 7, the explorer, or the OS, normalize separators with `.split(/[\\/]/)` rather than `.split("/")`.
- Canonical path form on the frontend is **forward-slash**. `homeDir()` returns backslashes on Windows; convert at the boundary (App.tsx setHome). OSC 7 already arrives as forward-slash. Equal canonical strings keep `useFileTree` from wiping its tree and flashing the explorer when `tab.cwd` first arrives.

### Window styling

- macOS: `titleBarStyle: Overlay` + `hiddenTitle: true` in `tauri.conf.json` (native traffic lights via overlay).
- Linux: `decorations: false` + `transparent: true` from `tauri.linux.conf.json`; re-asserted post-realize for GNOME/Mutter CSD.
- Windows: same as Linux via `tauri.windows.conf.json`. React renders custom `WindowControls`.

### Tauri capabilities

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview. New plugins (dialog, autostart, updater, window-state, store, opener, os, log are wired in `lib.rs`) typically need:
1. `Cargo.toml` dependency
2. `.plugin(...)` call in `lib.rs` `run()`
3. capability entry in `default.json`

### Cross-platform conventions

- HOME / cache dirs: use the `dirs` crate (`dirs::home_dir()`, `dirs::cache_dir()`), never raw `$HOME` / `%USERPROFILE%`.
- Shell init scripts: gate Unix-only logic behind `#[cfg(unix)]`; Windows arm in `pty::shell_init::windows`.
- Terminal input: send `\r` (CR) for Enter, not `\n` (LF) — PowerShell on Windows requires CR.

### Bundle config

- `bundle.targets: "all"` plus per-platform sections in `tauri.conf.json`:
  - **macOS**: `minimumSystemVersion: 10.15`.
  - **Linux**: deb depends `libwebkit2gtk-4.1-0`, `libgtk-3-0`; rpm `webkit2gtk4.1`, `gtk3`; AppImage bundles its media framework.
  - **Windows**: NSIS installer in `currentUser` mode (no admin required), WebView2 via `embedBootstrapper` (offline install).
- Auto-updater configured with a public minisign key; release artifacts at `https://github.com/crynta/terax-ai/releases/latest/download/latest.json`.

### Known gotchas

- **React 19 strict mode** double-mounts `useEffect` in dev → terminals spawn twice on first render. The first PTY is cleaned up almost immediately. The `SPAWN_LOCK` mutex serializes this; don't be alarmed by `pty opened id=1` followed by `pty closed id=1` in dev logs.
- **Windows PowerShell process lifecycle**: `killer.kill()` from `portable-pty` only kills the immediate child. Descendants (e.g. `npm run dev` started inside pwsh) survive unless something else takes them down. The Job Object in `pty/job.rs` handles this for the Terax-process-death case; an explicit `pty_close` from JS also kills only the immediate child + relies on the Job to take the rest. Don't disable the Job without a replacement.
- **Tab `cwd` storage**: comes from OSC 7 with forward slashes (after `parseOsc7` strips `/C:` → `C:`). Anything that consumes `tab.cwd` and passes it to a Rust fs command on Windows must normalize separators or accept both forms — `apply_common` in `pty::shell_init` handles this for PTY spawn; other call sites must do their own.
