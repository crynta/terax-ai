# Terax AI — Copilot Instructions

**Terax** is an open-source AI-native terminal emulator. Tauri 2 + Rust (`portable-pty`) backend, React 19 + TypeScript + xterm.js (WebGL) frontend, BYOK AI via Vercel AI SDK v6.

- Bundle ID: `app.crynta.terax`
- Package manager: **pnpm**
- Platforms: macOS, Linux, Windows
- Frontend type-check: `pnpm exec tsc --noEmit`
- Rust checks: `cd src-tauri && cargo check && cargo clippy`

## Architecture

### Two-process model
Rust (`src-tauri/`) owns all OS access. The webview never touches FS, processes, or shells directly — everything goes through `invoke()` calls to Tauri commands in `src-tauri/src/lib.rs`.

Key command namespaces:
- `pty::pty_*` — interactive PTY sessions (xterm ↔ portable-pty)
- `fs::*` — file explorer, editor IO, fuzzy search, grep
- `shell::shell_run_command` — one-shot subshell exec for AI tools (PowerShell on Windows, `$SHELL -lc` on Unix)
- `shell::shell_session_*` / `shell::shell_bg_*` — persistent and background shell sessions
- `secrets::secrets_*` — OS keychain via `keyring` crate; service: `"terax-ai"`

### Frontend (`src/`)
Single-window React 19 app. Path alias `@/*` → `src/*`. Modules under `src/modules/<area>/`, each with a barrel `index.ts` and hooks under `lib/`.

Key modules:
- **terminal/** — xterm.js, `TerminalStack`, PTY bridge, OSC 7/133 handlers
- **editor/** — CodeMirror 6, `EditorStack`, vim mode, multiple themes
- **explorer/** — file tree, fuzzy search, keyboard nav, icon resolver
- **ai/** — agent, sub-agents, sessions, composer, voice, tools, edit diffs

### AI subsystem (`src/modules/ai/`)
- **Keys**: OS keychain only — never `localStorage`, disk, or settings store
- **Agent**: `Experimental_Agent` with `stopWhen: stepCountIs(MAX_AGENT_STEPS)`, AI SDK v6 chat semantics
- **Tools** (`tools/tools.ts`): `read_file`, `list_directory`, `fs_search`, `fs_grep` auto-execute; destructive tools require `needsApproval: true`
- **Security** (`lib/security.ts`): deny-list for secret paths (`.env*`, `.ssh/`, credentials) — apply on both read and write

### UI conventions
- **shadcn/ui** — primitives in `src/components/ui/`; use `pnpm dlx shadcn add`, don't hand-edit
- **Tailwind v4** — config in `src/App.css` via `@theme`; use `cn()` from `@/lib/utils`
- **Hugeicons** for icon library (configured in `components.json`)
- **AI Elements** (Vercel) in `src/components/ai-elements/`; composition wrappers go in `modules/ai/components/`
- Animation: `motion` (Framer Motion successor); resizable layout: `react-resizable-panels`
- Path imports: always `@/…`, never relative across modules
- Cross-platform paths: split on `/[\\/]/`; canonical form on frontend is **forward-slash**

### Cross-platform conventions
- Use `dirs` crate for HOME/cache dirs, not `$HOME`/`%USERPROFILE%`
- Gate Unix-only logic behind `#[cfg(unix)]`; Windows arm in `pty::shell_init::windows`
- Send `\r` (CR) for Enter in terminal input, not `\n` — PowerShell requires CR
- Windows ConPTY: always use `SPAWN_LOCK` around `openpty + spawn_command`; per-session Job Object handles descendant cleanup

### Tab system
Tabs are tagged-union `{ kind: "terminal" | "editor" | "preview" | "ai-diff", … }` and are **hidden** (not unmounted) on switch via `invisible pointer-events-none`.

### Window styling
- macOS: `titleBarStyle: Overlay` (native traffic lights)
- Linux/Windows: `decorations: false` + `transparent: true`; custom `WindowControls` in React

### Tauri capabilities
New plugins need: (1) `Cargo.toml` dep, (2) `.plugin(...)` in `lib.rs`, (3) entry in `src-tauri/capabilities/default.json`.
