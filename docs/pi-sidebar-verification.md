# Pi sidebar verification

This checklist is for changes that touch Terax's Pi sidebar, Node sidecar, Pi SDK bridge, provider selection, or Pi session persistence. It is intentionally narrower than a repo-wide testing guide.

## Scope

Use this checklist when a PR changes any of these paths:

- `sidecars/pi-host/`
- `scripts/build-node-runtime.mjs`
- `scripts/build-pi-host-bundle.mjs`
- `scripts/smoke-pi-host-bundle.mjs`
- `src-tauri/src/modules/pi/`
- `src-tauri/src/modules/pty/agent_detect.rs` when local CLI agent tracking changes
- `src-tauri/tests/pi_state.rs`
- `src/modules/pi/`
- `src/settings/sections/ModelsSection.tsx`
- `docs/pi-runtime.md`
- `docs/pi-session-protocol.md`

Do not use this as a generic test guide for unrelated terminal, editor, git, or explorer work. Those areas follow the repo-wide rules in `CONTRIBUTING.md` and `TERAX.md`.

## Contracts to preserve

A Pi sidebar change should keep these invariants true:

1. **Terax owns the boundary**
   - Rust owns workspace authorization, keyring access, process lifecycle, session history, and Tauri events.
   - The sidecar owns Pi SDK session objects only.
   - Direct Terax-owned method families such as terminal, PTY, git, editor, SQLite, and arbitrary file APIs stay unavailable over the sidecar JSON-RPC protocol.

2. **Pi tools stay Rust-mediated**
   - Pi SDK sessions expose the explicit tool names `read`, `ls`, `grep`, `find`, `bash`, `edit`, and `write`.
   - Those names are Terax custom tool overrides; Pi built-in file/shell/edit/write backends are not the executor.
   - Custom tools route execution back to Rust with reverse JSON-RPC `nativeTools.execute`.
   - Rust verifies the request session id and cwd against the workspace authorized at `sessions.create`.
   - `read`, `ls`, `grep`, `find`, `edit`, and `write` stay workspace-scoped and block sensitive paths; grep/find skip sensitive files during traversal.
   - Shell and mutating tools (`bash`, `edit`, `write`) pause for `sessions.tool.respond` approval before Rust execution.
   - Direct Terax-owned file, shell, git, terminal, editor, and SQLite method families stay unavailable over sidecar JSON-RPC.

3. **Secrets are never diagnostic output**
   - Diagnostics may expose presence booleans and provider labels.
   - Diagnostics must not return API keys, auth JSON, profile secret values, request headers, or full provider configs.
   - Rust must not pass provider API keys through the sidecar process environment.

4. **JSON-RPC stays clean**
   - Sidecar stdout contains only newline-delimited JSON-RPC envelopes.
   - Incidental Pi SDK output goes to stderr or is captured away from protocol stdout.
   - Responses are matched by JSON-RPC id, not by arrival order.
   - `session.event` notifications must not be mistaken for method responses.

5. **Session lifecycle is restart-safe**
   - `sessions.create` creates an idle persisted Terax session.
   - `sessions.send` returns quickly after accepting the prompt, then streams events asynchronously.
   - `sessions.stop` aborts the active Pi run and leaves the session usable for a follow-up prompt when appropriate.
   - App restart restores persisted history without giving persistence ownership to the Node sidecar.
   - Host shutdown normalizes unfinished sessions to `stopped` with synthetic status events.

6. **Runtime packaging is deterministic**
   - `pnpm build:sidecars` creates the bundled Node runtime and Pi host resources.
   - `pnpm smoke:pi-host` verifies the bundled host can load Pi packages from a temporary cwd.
   - The sidecar bundle must not depend on Terax frontend source files at runtime.

7. **The UI reflects real runtime state**
   - Diagnostics and runtime cards should distinguish missing package, missing auth, invalid profile, stopped host, running session, and protocol error states.
   - A partially configured custom endpoint must not make an unusable Pi model look selectable.

8. **Local CLI agents stay visible and conservative**
   - Detection uses an exact-name allowlist of known binaries, follows the current workspace shell context, refreshes PATH on demand, and never spawns the agent binary during detection.
   - One-click launches open a normal terminal, not a hidden sidecar process.
   - Defaults stay plan/read-only or guarded: Claude Code `--permission-mode plan`, Codex `--sandbox read-only --ask-for-approval on-request`, Cursor Agent `--mode plan`, Pi `--tools read,grep,find,ls`, Gemini `--approval-mode plan`, Antigravity `agy --sandbox`, and OpenCode through the Terax-owned `terax-plan` isolation wrapper.
   - Pi launch must keep `bash`, `edit`, and `write` out of the default tool allowlist unless a separate reviewed design adds stronger runtime controls.
   - OpenCode launches only where Terax can provide POSIX shell env isolation: temporary HOME/XDG config/cache/state, preserved user XDG data for auth, project config disabled, and a Terax-owned deny-by-default permission config. Local Windows OpenCode launch stays disabled until the terminal launcher can pass native env isolation.
   - Prompt handoff must pass the current Pi composer text as an initial CLI prompt only after shell quoting/sanitizing it for the terminal shell context: PowerShell for local Windows, POSIX quoting for macOS/Linux/WSL. It must not write hidden prompt files or spawn a hidden process.

## Checks to run

Use targeted checks while iterating:

```bash
pnpm exec vitest run sidecars/pi-host src/modules/pi
(cd src-tauri && cargo test --locked pi)
```

Before review, run the CI-parity checks that match the touched area:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
(
  cd src-tauri
  cargo check --all-targets --locked
  cargo clippy --all-targets --locked -- -D warnings
  cargo nextest run --locked
)
```

If `cargo nextest` is not installed locally, `cargo test --locked` is an acceptable local fallback, but CI still uses nextest.

If the change touches sidecar packaging or runtime discovery, also run:

```bash
pnpm build:sidecars
pnpm smoke:pi-host
```

CI uses `.github/workflows/ci.yml` as the source of truth. Prefer commands that match that workflow over invented examples.

## Targeted test expectations

### Sidecar protocol tests

Cover these in `sidecars/pi-host/*.test.js`:

- Unknown Terax-owned methods return JSON-RPC `Method not found`.
- Invalid params fail with structured JSON-RPC errors.
- `diagnostics` redacts secrets and reports only non-secret status.
- `models.list` reads profile metadata without returning tokens.
- `sessions.create`, `sessions.send`, and `sessions.stop` preserve event ordering and status transitions.
- Diagnostics report `rust-mediated`, the exact enabled/approval-required tool lists, and enabled file/shell/tool capabilities without leaking secrets.
- Faux host sessions can stream output for tests, read/search tools route through `nativeTools.execute` without approval, and `bash`/`edit`/`write` requests pause until `sessions.tool.respond` approves or denies them.
- Stale or already-resolved tool approvals fail with `PI_APPROVAL_NOT_FOUND` / JSON-RPC `-32008`.
- Protocol stdout remains valid JSON-RPC when Pi SDK imports or prompt execution produce incidental output.

### Rust host tests

Cover these in `src-tauri/tests/pi_state.rs` or focused Rust unit tests:

- Workspace cwd is canonicalized and authorized before reaching the sidecar.
- Provider credentials are resolved from keyring only for explicit session creation.
- Tool response commands are registered and forward approve/deny decisions through Rust before shell or mutating tools can continue.
- Reverse `nativeTools.execute` requests reject unknown sessions and cwd values that do not match the Rust-authorized workspace.
- Host timeouts clear unhealthy sidecars but do not tear down healthy hosts for normal method errors.
- Concurrent responses and `session.event` notifications are demultiplexed by id and method.
- Idle shutdown never kills a host with running sessions.

### Frontend tests

Cover these in `src/modules/pi/**/*.test.ts(x)`:

- Diagnostics mapping produces actionable UI states.
- Session lists and transcripts restore persisted events correctly.
- Prompt context is rendered from validated workspace, terminal cwd, active file, and private-terminal state.
- Model picker enabled states match actually selectable provider and custom endpoint options.
- Tool approval cards render only for running sessions with pending approval requests and wire Approve/Deny to the native bridge.
- Stop, retry, regenerate, and send controls match session status.

## Provider QA matrix

Default automated tests must not call real providers or require API keys. Use this matrix to record what was covered locally and what still needs an opted-in live pass:

- **Terax-managed cloud providers**: cover settings normalization in `src/modules/pi/lib/provider.test.ts`, Rust keyring resolution in `src-tauri/tests/pi_state.rs`, and sidecar runtime registration in `sidecars/pi-host/provider-config.test.js`. Live prompt QA requires a configured Terax keyring entry.
- **Existing Pi profile auth**: cover profile `agentDir`, `AuthStorage`, `ModelRegistry`, and `SettingsManager` plumbing in `sidecars/pi-host/provider-config.test.js`. Live prompt QA requires an opted-in Pi profile with a configured model.
- **OpenAI-compatible and local endpoints**: cover custom endpoint registration, base URL, context limit, and runtime API key handling in `sidecars/pi-host/provider-config.test.js` and frontend model state in `src/modules/pi/lib/provider.test.ts`. Live prompt QA requires the local LM Studio, MLX, Ollama, or gateway server to be running.
- **Tool-call provider behavior**: default tests assert read-only tools run through Rust without approval and `bash`/`edit`/`write` pause for approval before Rust execution. Live provider QA should cover approve, deny, and stop-while-pending paths.
- **Packaging path**: cover bundled sidecar provider readiness with `pnpm build:sidecars` and `pnpm smoke:pi-host`.

## Manual smoke pass

Before asking for review on a behavior change, do a short manual pass:

1. Open the Pi sidebar from a normal workspace.
2. Start runtime diagnostics and confirm no secret values appear.
3. Create a Pi session with Terax-managed provider auth.
4. Send a short prompt and confirm streaming output appears in the transcript.
5. Confirm no Pi tool approval card appears for prompts that do not request shell or mutation tools.
6. Stop a running prompt and send a follow-up in the same session.
7. Close and reopen the app, then confirm persisted session history restores.
8. If local CLI agent behavior changed, refresh the Local CLI agents section and verify detection for Claude Code, Codex, Cursor Agent, OpenCode, and Pi. Launch Claude Code, Codex, Cursor Agent, and Pi from the sidebar and confirm each opens a visible terminal with the documented safe command. For Pi, confirm the command is `pi --tools read,grep,find,ls` and mutation/shell tools are unavailable. Confirm OpenCode shows Docs/detect-only copy. Also test "With prompt" on launchable agents using a short composer prompt.
9. If profile auth changed, repeat with "Use existing Pi profile" enabled.
10. If custom endpoint handling changed, test empty, partial, and complete endpoint configs.

Record which automated commands and manual paths were run in the PR description.

## Documentation updates

When behavior changes, update the docs in the same PR:

- Update `docs/pi-runtime.md` for runtime ownership, packaging, diagnostics, and lifecycle behavior.
- Update `docs/pi-session-protocol.md` for method params, results, event payloads, and JSON-RPC error codes.
- Update this file only when the verification contract itself changes.

## What not to add

Avoid broad or brittle tests:

- Do not snapshot large rendered transcripts.
- Do not test Pi SDK internals that Terax does not own.
- Do not require real provider network calls in default tests.
- Do not put API keys, auth files, or profile secrets in fixtures.
- Do not weaken protocol timeouts globally to hide a specific cold-start case. Prefer targeted longer timeouts for known expensive operations such as `sessions.create`.
