# Pi sidebar verification

This checklist is for changes that touch Terax's Pi sidebar, webview-native Pi
agent bridge, provider selection, tool approval boundary, MCP exposure, or Pi
session persistence. It is intentionally narrower than a repo-wide testing
guide.

## Scope

Use this checklist when a PR changes any of these paths:

- `src/modules/pi/`
- `src/modules/ai/` surfaces that launch or replace Pi/chat UX
- `src-tauri/src/modules/pi/`
- `src-tauri/tests/*pi*` or capability/approval tests
- `e2e/specs/*pi*.e2e.mjs`
- `docs/pi-runtime.md`
- `docs/pi-session-protocol.md`
- this file

The removed Node Pi sidecar (`sidecars/pi-host`, bundled Node runtime, and Pi
host JSON-RPC smoke tests) is no longer part of the default app. Do not add it
back for Pi verification. `pnpm build:sidecars` is still valid for the separate
speech-recognizer sidecar only.

## Contracts to preserve

1. **Terax owns the boundary**
   - The Pi agent loop may run in the webview, but Rust owns workspace
     authorization, keyring access, native tool execution, approval grants,
     audit records, and durable session storage.
   - The webview must not call privileged file/shell/MCP commands directly on
     behalf of a model. Agent-initiated tools go through
     `pi_agent_tool_execute`.

2. **Pi tools stay Rust-mediated**
   - Agent tools map to the native policy names `read`, `ls`, `grep`, `find`,
     `bash`, `edit`, `write`, or an MCP qualified name.
   - Rust verifies session id, cwd, workspace env, tool policy, and sensitive
     path rules before execution.
   - Shell and mutating workspace tools pause for user approval; approval must
     create a single-use Rust grant before execution, and denial must be a
     no-op.
   - Artifact tools derive ownership from the verified Pi session id, not from
     model-provided conversation ids.

3. **Secrets stay out of diagnostics and history**
   - Diagnostics may expose presence booleans and provider labels.
   - Diagnostics and persisted sessions must not include API keys, auth JSON,
     request headers, or profile secret values.
   - Provider/model metadata (`authMode`, provider id, model id, custom endpoint
     id/base URL) may be persisted; runtime key material may not.

4. **Session lifecycle is restart-safe**
   - Session creation persists an idle session row and provider/model metadata.
   - Sending a prompt streams events asynchronously and persists a canonical
     transcript blob separately from the capped UI event log.
   - Stop aborts the active run, clears approval state, and leaves the session
     usable for a follow-up when appropriate.
   - App restart restores session history; first resume/send rehydrates the
     agent from the persisted transcript.
   - Pending approvals never resume as actionable after restart.

5. **HTTP proxy is compatible with provider SDKs**
   - Streaming provider calls go through `ai_http_stream`; non-streaming calls
     go through `ai_http_request`.
   - Unsupported raw bodies pass through to the real fetch instead of being
     mangled.
   - `URLSearchParams` bodies preserve or infer
     `application/x-www-form-urlencoded;charset=UTF-8`.

6. **Packaging stays small**
   - The default app must not bundle a Node Pi sidecar.
   - The macOS release app should remain around the current 11 MB baseline.
   - `resources/sidecars` may contain non-Pi sidecars such as the speech
     recognizer; that does not reintroduce the Pi Node sidecar.

7. **Local CLI agents stay visible and conservative**
   - Detection uses an exact-name allowlist and never spawns the agent binary.
   - One-click launches open a normal terminal, not a hidden process.
   - Defaults stay plan/read-only or guarded: Claude Code
     `--permission-mode plan`, Codex `--sandbox read-only --ask-for-approval
     on-request`, Cursor Agent `--mode plan`, Pi `--tools read,grep,find,ls`,
     Gemini `--approval-mode plan`, Antigravity `agy --sandbox`, and OpenCode
     through the Terax-owned `terax-plan` isolation wrapper.

## Checks to run

Use targeted checks while iterating:

```bash
pnpm exec vitest run src/modules/pi
pnpm check:pi-boundary
(cd src-tauri && cargo test --locked pi)
```

Before review, run the CI-parity checks that match the touched area:

```bash
pnpm format:check
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm check:bundle-size
(
  cd src-tauri
  cargo check --locked
  cargo clippy --locked --all-targets -- -D warnings
  cargo test --locked
)
```

If the change touches the `workflow` or `openclicky` feature gates, also run the
matching feature checks, for example:

```bash
(
  cd src-tauri
  cargo check --locked --features workflow
  cargo clippy --locked --all-targets --features workflow -- -D warnings
  cargo clippy --locked --all-targets --features openclicky -- -D warnings
)
```

Run Linux/Windows e2e in CI. macOS cannot run `tauri-driver` against WKWebView;
authoring specs on macOS should still include syntax/static checks and PR notes.

## Targeted test expectations

### Webview/TypeScript tests

Cover these in `src/modules/pi/**/*.test.ts(x)`:

- Provider resolution and model-picker enabled states match actually selectable
  Terax, profile, local, and custom endpoint options.
- Session creation persists provider/model metadata and calls
  `pi_store_record_session`.
- Resume/send rehydrates from the canonical transcript and keeps the stored
  provider/model unless the caller explicitly overrides it.
- Prompt context is rendered from validated workspace, terminal cwd, active file,
  and private-terminal state.
- Tool approval cards render only for running sessions with pending approval
  requests and wire Approve/Deny to the native bridge.
- `URLSearchParams` and `Request` bodies keep correct form content-type through
  the fetch proxy.
- MCP tools are hidden when denied by manifest policy and route through the same
  verified executor when visible.

### Rust tests

Cover these in Rust unit/integration tests:

- Workspace cwd is canonicalized and authorized before native tool execution.
- `pi_agent_tool_execute` rejects unknown sessions, mismatched cwd/workspace env,
  missing approval grants for Ask tools, denied tools, and sensitive paths.
- Approval grants are single-use and audited.
- Provider credentials are resolved from keyring only for explicit runtime use.
- Session metadata, provider metadata, events, and transcript blobs round-trip
  through app-data storage with size/path-traversal guards.
- Capability registration includes every frontend Tauri invoke or intentionally
  feature-gated graceful degradation.

### E2E tests

Default e2e specs must not require real providers, secrets, or network. The Pi
approval spec (`e2e/specs/pi-approval.e2e.mjs`) uses the deterministic faux Pi
provider and must cover both branches of the security boundary:

- approve -> Rust `pi_agent_tool_execute` writes the requested fixture;
- deny -> the fixture remains absent and the denied mutation is not executed.

## Provider QA matrix

Default automated tests must not call real providers or require API keys. Use
this matrix to record what was covered locally and what still needs an opted-in
live pass:

- **Terax-managed cloud providers**: cover settings normalization in provider
  tests and keyring lookup in Rust. Live prompt QA requires a configured Terax
  keyring entry.
- **Existing Pi profile auth**: cover non-secret profile model listing through
  `pi_models_list`. Live prompt QA requires an opted-in Pi profile with a
  configured model.
- **OpenAI-compatible/custom endpoints**: cover endpoint id, base URL, context
  limit, and runtime API-key handling. Live prompt QA requires the local or
  gateway server to be running.
- **Tool-call provider behavior**: default tests assert read/search tools run
  through Rust and Ask-level tools require approval before Rust execution. Live
  provider QA should cover approve, deny, and stop-while-pending paths.

## Manual macOS smoke pass

Before asking for review on a Pi behavior change, record a manual macOS pass in
the PR description or a linked release-readiness note. Include the following:

1. **Key save/load**: save a provider/custom endpoint key in settings, restart
   the app, and confirm the model picker still sees the key without exposing the
   value in diagnostics.
2. **Terax-managed chat**: create a Pi session with a normal Terax-managed
   provider, send a short prompt, and confirm streaming output appears.
3. **Built-in/local agent cards**: refresh the local agent section and confirm
   detected agents launch only visible terminal commands in the documented safe
   posture.
4. **Custom Zai/OpenAI-compatible endpoint auth**: configure a complete custom
   endpoint for a Zai-compatible model, send a prompt, and confirm the stored
   session keeps the custom endpoint id/base URL after restart.
5. **Session streaming**: verify output, reasoning/progress when present, final
   status, and transcript persistence.
6. **Tool approval**: trigger a harmless `write`/`edit`/`bash` request; approve
   once and confirm execution, then repeat and deny to confirm no mutation.
7. **Stop/resume**: stop a running prompt, send a follow-up in the same session,
   and confirm the transcript remains coherent.
8. **App restart restore**: quit/reopen Terax and confirm sessions, events,
   transcripts, provider/model metadata, and non-actionable expired approvals
   restore correctly.
9. **Window-close behavior**: close the Pi window/app during idle and during a
   running/approval-pending session; confirm no stuck running state or reusable
   stale approval remains after reopening.
10. **Size spot-check**: after release build, record
    `du -sh src-tauri/target/release/bundle/macos/*.app`.

If a manual item cannot be run by the authoring agent (for example, real keys or
macOS UI interaction are unavailable), mark it explicitly as pending with the
reason. Do not silently treat automated tests as a substitute for live-provider
manual QA.

## Documentation updates

When behavior changes, update the docs in the same PR:

- Update `docs/pi-runtime.md` for runtime ownership, packaging, diagnostics, and
  lifecycle behavior.
- Update `docs/pi-session-protocol.md` for session params, persisted fields,
  event payloads, and native command boundaries.
- Update this file only when the verification contract itself changes.

## What not to add

Avoid broad or brittle tests:

- Do not require real provider network calls in default tests.
- Do not put API keys, auth files, or profile secrets in fixtures.
- Do not snapshot large rendered transcripts.
- Do not weaken Rust policy checks or HTTP limits to hide a frontend issue.
- Do not reintroduce the removed Node Pi sidecar for test convenience.
