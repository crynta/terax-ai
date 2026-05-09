# TERAX.md

Terax supports TERAX.md file at the workspace root (similiar to AGENTS.md, CLAUDE.md, etc.)

## Project

**Terax** — open-source AI-native terminal emulator. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (webgl) client, BYOK AI via Vercel AI SDK.

Bundle id: `app.crynta.terax`. Package manager: **pnpm**.

Type-check the frontend without bundling: `pnpm exec tsc --noEmit`.
Rust checks: `cd src-tauri && cargo check` / `cargo clippy`.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all OS access. Frontend never touches the FS, processes, or shells directly — everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs`:

- `pty::pty_open / pty_write / pty_resize / pty_close` — long-lived interactive PTY sessions (xterm <-> portable-pty), managed by `PtyState` (an `RwLock<HashMap<id, Session>>`). Output is streamed back via a Tauri `Channel<PtyEvent>`.
- `fs::tree::*`, `fs::file::*`, `fs::mutate::*` — file explorer + editor IO.
- `shell::shell_run_command` — **one-shot** subshell exec used by the AI's `run_command` tool. Distinct from PTY sessions; not the user's interactive terminal.

PTY shells are bootstrapped via injected init scripts in `src-tauri/src/modules/pty/scripts/` (`zshrc.zsh`, `bashrc.bash`, …) — these wire up OSC sequences for cwd reporting / shell integration.

**Frontend (`src/`)** is a single-window React app. Path alias `@/*` → `src/*`.

### Module layout (`src/modules/`)

Each module is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`. The shell of `App.tsx` wires modules together — it should stay a coordinator, not a feature host.

- **terminal/** — `TerminalStack` keeps one mounted xterm instance per tab (via `useTerminalSession` + `pty-bridge`). `osc-handlers.ts` parses shell-integration OSC codes (cwd updates, etc.). Tabs are not unmounted on switch — they're hidden via `invisible pointer-events-none` so PTYs keep streaming in the background.
- **editor/** — CodeMirror 6 stack (`EditorStack` mirrors `TerminalStack`). `extensions.ts` and `languageResolver.ts` configure language modes + themes.
- **explorer/** — file tree (Material Icons via `material-icon-theme` resolved in `iconResolver.ts`), context actions, inline rename input.
- **tabs/** — `useTabs` is the source of truth for tab list + active id. Tabs are tagged-union `{ kind: "terminal" | "editor", … }`. `useWorkspaceCwd` derives the explorer root and inherited cwd for new tabs.
- **header/** — top bar + inline search (`SearchInline` adapts to terminal vs editor via `SearchTarget`).
- **statusbar/** — bottom bar, cwd breadcrumb, AI tools indicator.
- **shortcuts/** — keymap registry (`shortcuts.ts`) + `useGlobalShortcuts` hook. Handlers live in `App.tsx` and are passed in by id (`tab.new`, `ai.toggle`, …).
- **theme/** — `next-themes` provider.
- **ai/** — see below.

### AI subsystem (`src/modules/ai/`)

BYOK. Currently OpenAI-only via `@ai-sdk/openai`; default model in `config.ts` (`DEFAULT_MODEL_ID`). When adding providers, branch in `lib/agent.ts` and keep the `Agent` / `DirectChatTransport` shape — the rest of the system depends on AI SDK v6 chat semantics.

- **Key storage**: OS keychain via `keyring`. Service/account constants in `config.ts` (`KEYRING_SERVICE = "terax-ai"`). Never persist keys to disk, settings store, or `localStorage`.
- **Agent**: `lib/agent.ts` builds a `Experimental_Agent` with `stopWhen: stepCountIs(MAX_AGENT_STEPS)` and the system prompt from `config.ts`.
- **Sessions** (`lib/sessions.ts` + `store/chatStore.ts`): conversations are organized into named sessions, persisted via `tauri-plugin-store` at `terax-ai-sessions.json` (list + `activeId` + per-session `messages:<id>` keys). `chatStore.ts` keeps a module-scoped `Map<sessionId, Chat<UIMessage>>`; `getOrCreateChat(apiKey, sessionId)` lazily constructs a `Chat`, seeded with persisted messages from a hydration map populated by `hydrateSessions()` (called once from `App.tsx`). `AgentRunBridge` mirrors the active session's messages back to disk on every change and auto-derives the title from the first user message. Switching the API key wipes the chat map; sessions persist. Session UI (switch / new / delete) lives in `AiMiniWindow`'s header.
- **Composer** (`lib/composer.tsx`): a React context providing the shared input state (text, attachments, voice) for both the docked `AiInputBar` and any other surface. Attachments include image, text-file, and `selection` kinds — selections come from `useChatStore.attachSelection(text, source)` (drained into chips, not pasted into the textarea) and are wrapped as `<selection source="terminal|editor">…</selection>` blocks at submit. Composer doesn't run `useChat` itself — it derives `isBusy` from `agentMeta.status` so it can mount safely before sessions hydrate.
- **Live context bridge**: `App.tsx` calls `setLive({ getCwd, getTerminalContext, … })` so tools can read the _currently active_ terminal's cwd + last 300 lines of buffer. Keep this lazy — don't pre-snapshot, the active tab changes.
- **Tools** (`tools/tools.ts`): `read_file`, `list_directory` auto-execute; `write_file`, `create_directory`, `run_command` set `needsApproval: true` and the AI SDK pauses for an in-UI confirmation card. `lib/security.ts` is a deny-list that refuses obvious secret paths (`.env*`, `.ssh/`, credentials) — apply it on **both** read and write paths and don't bypass it. Auto-send after approval response uses `lastAssistantMessageIsCompleteWithApprovalResponses`.

### UI conventions

- **shadcn/ui** is configured (`components.json`, style `radix-luma`, base `mist`, icon lib **hugeicons**). Generated primitives live in `src/components/ui/` — don't hand-edit them; re-run `pnpm dlx shadcn add` if a primitive needs an upgrade.
- **AI Elements** (AI Vercel SDK) live in `src/components/ai-elements/` and come from the `@ai-elements` registry declared in `components.json`. Same rule: regenerate, don't hand-patch — but composition wrappers belong in `modules/ai/components/`.
- Tailwind v4 (no `tailwind.config.*` — config is in `src/App.css` via `@theme`). Use `cn()` from `@/lib/utils` for class merging.
- Animation: `motion` (Framer Motion successor). Resizable layout: `react-resizable-panels`.
- Path imports: always `@/…`, never relative across modules.

### Tauri capabilities

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview. New plugins (dialog, keyring, store, opener, os, log are already wired in `lib.rs`) usually need both a `Cargo.toml` dep, a `.plugin(...)` line in `lib.rs`, and a capability entry.
