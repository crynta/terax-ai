# TERMAX.md

TerMax loads `TERMAX.md` from the workspace root as agent memory (similar to AGENTS.md / CLAUDE.md). This file is also the project's living architecture doc — read it before making changes.

## Project

**TerMax** (personal fork of [Terax](https://github.com/crynta/terax-ai)) — open-source AI-native terminal emulator. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client, BYOK AI via Vercel AI SDK v6.

- Bundle id: `com.riotbeard.termax`
- Package manager: **pnpm**
- Platforms: macOS (Apple Silicon only) — fork drops upstream Intel/Linux/Windows targets
- Frontend checks: `pnpm exec tsc --noEmit`, `pnpm test`
- Rust checks: `cd src-tauri && cargo clippy && cargo test --locked`

## Quality bar

Production-grade or it does not ship. Every change is judged against all of these, not just "it works":

- **Correctness**: edge cases, failure modes, concurrent access. No "works for now".
- **Performance**: ultra-lightweight is the product. ~7-8 MB bundle, high-performance terminal. For every change ask: how much RAM it costs, whether it adds IPC round-trips or redundant requests, whether it triggers extra re-renders or wasted work, whether it pulls a heavy dependency. Unused features consume zero resources.
- **Security**: no critical security holes. Validate at every boundary (IPC, fs, network, AI tool surface). The secret-path deny-list applies on both read and write and is never bypassed.
- **UI/UX**: polished, professional, premium. Every state and detail considered.
- **Architecture**: new or changed logic lives in pure, dependency-light functions (functional core); tauri commands and React components stay thin (imperative shell). Keeps it testable without a later rewrite.

Verify before claiming done: `pnpm exec tsc --noEmit`, `pnpm test`, `cargo clippy`, `cargo test --locked`. A change to a core subsystem (terminal/shell spawn, workspace auth, git, fs, IPC or AI tool surface) needs a test that locks the invariant.

## Conventions

- **Comments**: default to none, the code should explain itself. If genuinely needed, 1-2 lines on *why*, never *what*. No AI-generic filler.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **Imports**: always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. The webview never touches the FS, processes, or shells directly — everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`:

- `pty::pty_*` — long-lived interactive PTY sessions (xterm ↔ portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`). Output streams via a Tauri `Channel<PtyEvent>`.
- `fs::tree::*` (`fs_read_dir`, `list_subdirs`), `fs::file::*` (`fs_read_file`, `fs_write_file`, `fs_stat`, `fs_canonicalize`), `fs::mutate::*` (`fs_create_file`, `fs_create_dir`, `fs_rename`, `fs_delete`): file explorer + editor IO.
- `fs::search::*` (`fs_search`, `fs_list_files`), `fs::grep::*` (`fs_grep`, `fs_glob`): fuzzy file finder + content search (powered by `ignore` + `grep-*` crates).
- `git::commands::*`: full source-control surface (`git_status`, `git_diff`, `git_diff_content`, `git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_fetch`, `git_pull_ff_only`, `git_push`, `git_log`, `git_show_commit`, `git_commit_files`, `git_commit_file_diff`, `git_panel_snapshot`, `git_resolve_repo`, `git_remote_url`). All gated through the workspace authorization registry.
- `shell::shell_run_command`: one-shot subshell exec used by AI tools. Distinct from PTY sessions; not the user's interactive terminal. On Windows via PowerShell (`-NoProfile -Command`), on Unix via `$SHELL -lc`. Shared helper `build_oneshot_command`.
- `shell::shell_session_*`: persistent agent shell with state across calls. `shell::shell_bg_*` (`spawn`, `logs`, `kill`, `list`): long-running background processes (dev servers etc.) with bounded ring-buffer log capture.
- `workspace::*`: `workspace_authorize` / `workspace_current_dir` (the spawn/git/AI cwd authorization registry) plus the WSL bridge (`wsl_list_distros`, `wsl_default_distro`, `wsl_home`).
- `net::*` (`ai_http_request`, `ai_http_stream`, `lm_ping`): AI HTTP proxy with SSRF guard; keeps provider calls and local-model pings off the webview.
- `secrets::secrets_*`: OS keychain via the `keyring` crate. Service constant `termax-ai`. Linux uses a file-based fallback gated behind `#[cfg(target_os = "linux")]`.
- `open_settings_window`: separate webview window for Settings (optional `tab` arg deep-links a section).

### PTY shell integration

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/`:

- **Unix** (`zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`) — installed via `ZDOTDIR` (zsh) or `--rcfile` (bash). Emit OSC 7 (cwd) and OSC 133 A/B/C/D (prompt boundaries + exit code) so the host can track cwd and detect command boundaries without re-parsing the prompt.
- **Windows** (`profile.ps1`) — passed via `pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <path>`. Wraps the user's existing `prompt` function (after their `$PROFILE` runs) to emit OSC 7 + OSC 133 A/B/D. Shell priority: `pwsh.exe` (PS 7+) → `powershell.exe` (PS 5.1) → `cmd.exe` (no integration). cwd is normalized to backslashes before being passed to ConPTY (`CreateProcessW` misbehaves with forward-slash cwd).

`pty/shell_init.rs` is split into `#[cfg(unix)]` / `#[cfg(windows)]` modules — keep new platform-specific code in the right cfg arm.

ConPTY on Windows requires `SPAWN_LOCK` (Mutex) around `openpty + spawn_command` in `session.rs`. Concurrent spawns leave one of the resulting PTYs with a stalled output pipe. Don't remove the lock without verifying first-tab stability under fast tab spam.

Each ConPTY child is also assigned to a per-session **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`pty/job.rs`). When the Job HANDLE drops — clean shutdown, panic, or even SIGKILL'd Terax process — the kernel kills every descendant of the shell (e.g. `npm run dev` spawned from inside pwsh). Without this Windows orphans the entire process subtree because `TerminateProcess` only kills the immediate child. macOS/Linux rely on `Drop for Session → killer.kill()`; on dev-`Ctrl-C` of `cargo run` destructors don't fire and orphans are possible there too — acceptable for now since dev only.

`AiComposerProvider` is mounted unconditionally at the App.tsx root: a conditional wrapper would change the parent element type when keys load, remounting the entire tree (and re-spawning every PTY) the moment `getAllKeys()` resolves. Production happened to dodge this because keychain reads can land in the same paint frame; dev didn't. Keep the unconditional wrap.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` → `src/*`. Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `ai-diff` | `git-diff` | `git-history` | `git-commit-file`) and **not** unmounted on switch — they're hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming in the background.

`App.tsx` wires modules together — keep it a coordinator. New features go inside the appropriate `modules/<area>/`.

### Module layout (`src/modules/`)

Each module is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`.

- **terminal/** — `TerminalStack` keeps one mounted xterm per tab via `useTerminalSession` + `pty-bridge`. `osc-handlers.ts` parses OSC 7 (with Windows drive-letter normalization: `/C:/Users/foo` → `C:/Users/foo`) and OSC 133 markers. The xterm color palette is driven by the central theme engine (`modules/theme`), not a local table.
- **editor/** — CodeMirror 6 stack (`EditorStack` mirrors `TerminalStack`). `extensions.ts` configures language modes; supports vim mode and prebuilt themes (Tokyo Night, Nord, GitHub, Atom One, Aura, Copilot, Xcode, Gruvbox Dark).
- **explorer/** — file tree with Material/Catppuccin icons (`iconResolver.ts`), fuzzy search, keyboard nav, inline rename, context actions. Backslash-aware `basename`.
- **preview/** — auto-detected dev-server preview tab (status-bar pill suggests opening when a localhost URL is detected).
- **tabs/** — `useTabs` is the source of truth for tab list + active id. `useWorkspaceCwd` derives explorer root + inherited cwd for new tabs from active tab. `basename` splits on both `/` and `\`.
- **header/** — top bar + inline search (`SearchInline` adapts to terminal vs editor via `SearchTarget`). `WindowControls` rendered when `USE_CUSTOM_WINDOW_CONTROLS` is true (Linux + Windows; macOS uses native traffic lights).
- **statusbar/** — bottom bar, `CwdBreadcrumb` (handles Unix paths, Windows drive letters, and home `~` segments via `pathUtils.segmentsFromCwd`), AI tools indicator.
- **shortcuts/** — keymap registry (`shortcuts.ts`) + `useGlobalShortcuts`. Handlers live in `App.tsx` and are passed in by id (`tab.new`, `ai.toggle`, …). `metaKey || ctrlKey` for cross-platform Cmd/Ctrl.
- **settings/** — settings store (`store.ts` via `tauri-plugin-store`), preferences hook, settings window opener.
- **sidebar/** — activity bar + collapsible side panels (explorer, source control, git history).
- **source-control/** — git status / stage / commit panel and diff workflow.
- **git-history/** — commit graph rail, refs, per-commit file diffs.
- **markdown/** — markdown preview renderer (backs the `markdown` tab kind).
- **workspace/** — workspace environment switching (Local + WSL distros).
- **theme/** — custom theme engine (no `next-themes`). `ThemeProvider` + `applyTheme` write CSS variables; built-in presets in `themes/` (termax-default, nord, tide, catppuccin, tokyo-night, caffeine, claude, gruvbox, sage, rose-pine), user themes via `customThemes.ts` + `validateTheme.ts`, optional background image via `bgImageStore.ts` + `SurfaceLayer`.
- **ai/** — see below.

### AI subsystem (`src/modules/ai/`)

BYOK. Cloud providers via `@ai-sdk/*`: **OpenAI, Anthropic, Google, xAI, Cerebras, Groq**, plus **OpenAI-compatible** for any custom base URL. Local / offline providers (key-optional, model id supplied at runtime): **LM Studio, MLX, Ollama**. Provider list in `config.ts` (`PROVIDERS`); model registry includes `DEFAULT_MODEL_ID` + `DEFAULT_AUTOCOMPLETE_MODEL`.

- **Key storage**: OS keychain via `keyring` (Rust). Frontend reads/writes through `secrets_*` commands. Service `KEYRING_SERVICE = "termax-ai"`. Never persist keys to disk, settings store, or `localStorage`.
- **Agent** (`lib/agent.ts`): `Experimental_Agent` with `stopWhen: stepCountIs(MAX_AGENT_STEPS)` and the system prompt from `config.ts`. Provider branching happens here — keep the `Agent` / `DirectChatTransport` shape; the rest of the system depends on AI SDK v6 chat semantics.
- **Sub-agents** (`agents/registry.ts`, `agents/runSubagent.ts`): named sub-agents with their own system prompts and tool subsets, invoked by the main agent via `run_subagent` tool.
- **Sessions** (`lib/sessions.ts` + `store/chatStore.ts`): conversations are organized into named sessions, persisted via `tauri-plugin-store` at `termax-ai-sessions.json` (list + `activeId` + per-session `messages:<id>` keys). `chatStore.ts` keeps a module-scoped `Map<sessionId, Chat<UIMessage>>`; `getOrCreateChat(apiKey, sessionId)` lazily constructs a `Chat`, seeded with messages from a hydration map populated by `hydrateSessions()` (called once from `App.tsx`). `AgentRunBridge` mirrors active-session messages to disk on every change and auto-derives titles from the first user message. Switching the API key wipes the chat map; sessions persist.
- **Composer** (`lib/composer.tsx`): React context providing shared input state (text, attachments, voice) for both the docked `AiInputBar` and any other surface. Attachments include image, text-file, and `selection` kinds — selections come from `useChatStore.attachSelection(text, source)` (drained into chips, not pasted into the textarea) and are wrapped as `<selection source="terminal|editor">…</selection>` blocks at submit. Composer derives `isBusy` from `agentMeta.status` so it can mount safely before sessions hydrate.
- **Voice input**: streamed transcription pipeline. Toggled from the composer.
- **Live context bridge**: `App.tsx` calls `setLive({ getCwd, getTerminalContext, … })` so tools can read the *currently active* terminal's cwd + last 300 lines of buffer. Lazy by design — don't pre-snapshot.
- **Tools** (`tools/tools.ts`): `read_file`, `list_directory`, `fs_search`, `fs_grep` auto-execute. `write_file`, `create_directory`, `rename`, `delete`, `run_command`, `shell_session_run`, `shell_bg_spawn` set `needsApproval: true` and the AI SDK pauses for an in-UI confirmation card. Auto-send after approval uses `lastAssistantMessageIsCompleteWithApprovalResponses`. `lib/security.ts` is a deny-list refusing obvious secret paths (`.env*`, `.ssh/`, credentials, keychain dirs) — apply on **both** read and write paths and don't bypass it.
- **Edit diffs**: AI-proposed edits open in a side-by-side diff tab (`ai-diff` tab kind); user accepts/rejects per hunk before the write tool actually runs.
- **Skills / snippets**: reusable prompt fragments + tool-bundles surfaced in the composer.

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

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview. New plugins (dialog, autostart, window-state, store, opener, os, log are wired in `lib.rs`) typically need:
1. `Cargo.toml` dependency
2. `.plugin(...)` call in `lib.rs` `run()`
3. capability entry in `default.json`

### Cross-platform conventions

- HOME / cache dirs: use the `dirs` crate (`dirs::home_dir()`, `dirs::cache_dir()`), never raw `$HOME` / `%USERPROFILE%`.
- Shell init scripts: gate Unix-only logic behind `#[cfg(unix)]`; Windows arm in `pty::shell_init::windows`.
- Terminal input: send `\r` (CR) for Enter, not `\n` (LF) — PowerShell on Windows requires CR.

### Bundle config

This fork ships **only macOS Apple Silicon (`aarch64-apple-darwin`)**. Per-platform `tauri.conf.json` sections for Intel/Linux/Windows still exist upstream and survive merges, but `pnpm tauri build` is always run with `--target aarch64-apple-darwin` here.

- **macOS**: `minimumSystemVersion: 11.0` (raised from upstream's 10.15 since arm64 only).
- **Auto-updater removed.** The fork distributes via the personal Homebrew tap (`RiotBeard/homebrew-tap`); `brew upgrade --cask termax` handles updates. Don't re-add `tauri-plugin-updater` or the `updater:default` capability — `scripts/strip-upstream.sh` will rip them out again.

### Known gotchas

- **React 19 strict mode** double-mounts `useEffect` in dev → terminals spawn twice on first render. The first PTY is cleaned up almost immediately. The `SPAWN_LOCK` mutex serializes this; don't be alarmed by `pty opened id=1` followed by `pty closed id=1` in dev logs.
- **Windows PowerShell process lifecycle**: `killer.kill()` from `portable-pty` only kills the immediate child. Descendants (e.g. `npm run dev` started inside pwsh) survive unless something else takes them down. The Job Object in `pty/job.rs` handles this for the Terax-process-death case; an explicit `pty_close` from JS also kills only the immediate child + relies on the Job to take the rest. Don't disable the Job without a replacement.
- **Tab `cwd` storage**: comes from OSC 7 with forward slashes (after `parseOsc7` strips `/C:` → `C:`). Anything that consumes `tab.cwd` and passes it to a Rust fs command on Windows must normalize separators or accept both forms — `apply_common` in `pty::shell_init` handles this for PTY spawn; other call sites must do their own.
