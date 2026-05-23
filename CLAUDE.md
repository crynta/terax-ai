# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm install
pnpm tauri dev          # full app (Rust + frontend)
pnpm dev                # frontend only (Vite, no Tauri shell)

# Production build
pnpm tauri build

# Type-check and lint
pnpm exec tsc --noEmit
cd src-tauri && cargo check && cargo clippy && cargo fmt

# Tests
pnpm test                           # run all frontend tests once
pnpm test:watch                     # watch mode
cd src-tauri && cargo test          # Rust tests
```

To run a single test file: `pnpm exec vitest run src/path/to/file.test.ts`

## Architecture

**Read `TERAX.md` before making any changes.** It is the authoritative architecture document and is also loaded by the in-app AI agent as project memory. The sections below are a quick orientation; TERAX.md has the full detail on every subsystem.

### Two-process model

- **Rust (`src-tauri/`)** owns all OS access (filesystem, PTY, shell, keychain, networking). The webview never touches these directly.
- **Frontend (`src/`)** calls Rust exclusively via `invoke()`. All Tauri commands are registered in `src-tauri/src/lib.rs`.
- Adding a new plugin typically requires three touches: `Cargo.toml`, `.plugin(...)` in `lib.rs`, and a capability entry in `src-tauri/capabilities/default.json`.

### Frontend module layout

Each `src/modules/<area>/` is self-contained with its own `index.ts` barrel and `lib/` for hooks. `App.tsx` is a coordinator only — new features belong inside the appropriate module.

Key modules: `terminal/`, `editor/`, `explorer/`, `ai/`, `tabs/`, `source-control/`, `git-history/`, `preview/`, `settings/`, `shortcuts/`, `theme/`.

A second HTML entry point (`settings.html` / `src/settings/`) renders the Settings window, which is a separate Tauri webview.

### AI subsystem

- Provider list and model registry: `src/modules/ai/config.ts`
- Core agent logic: `src/modules/ai/lib/agent.ts` (Vercel AI SDK v6 `Experimental_Agent`)
- Tool definitions with approval gating: `src/modules/ai/tools/tools.ts`
- Security deny-list (applies on **both** read and write paths): `src/modules/ai/lib/security.ts` — never bypass this
- Session persistence: `src/modules/ai/lib/sessions.ts` + `src/modules/ai/store/chatStore.ts`
- API keys go through the OS keychain (`secrets_*` Tauri commands). Never write keys to disk, settings store, or `localStorage`.

### UI conventions

- **shadcn/ui** primitives live in `src/components/ui/` — regenerate with `pnpm dlx shadcn add`, don't hand-edit.
- **Tailwind v4** — no `tailwind.config.*`; config is in `src/App.css` via `@theme`. Use `cn()` from `@/lib/utils`.
- Path alias: `@/*` → `src/*`. Always use `@/` imports, never relative paths across modules.
- Cross-platform paths: normalize with `.split(/[\\/]/)`. Canonical form on the frontend is **forward-slash**.
- Tabs are never unmounted on switch — hidden via `invisible pointer-events-none` to keep PTYs and servers streaming.

## Conventions

- TypeScript strict mode: no `any` unless truly necessary.
- Rust: `cargo fmt` + `cargo clippy` clean before committing.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(terminal): …`, `fix(ai): …`, etc. See CONTRIBUTING.md for the full scope list.
- Branch naming: `feat/`, `fix/`, `chore/`, `docs/`, `perf/`, `security/` prefixes.
- One PR = one logical change; no mixed-concern diffs.
- No new dependencies >50 KB gzip (frontend) or >5 MB compiled (Rust) without justification.
