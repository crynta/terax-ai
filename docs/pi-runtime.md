# Pi runtime integration

Terax's Pi integration is now **webview-native by default**. There is no bundled
Node.js Pi sidecar and no `sidecars/pi-host` runtime in the default app. Pi SDK
agent objects live in the renderer process, while every privileged operation
still crosses a Tauri/Rust boundary.

For the focused Pi sidebar verification checklist, see
[`pi-sidebar-verification.md`](./pi-sidebar-verification.md). For the session
API shape and event contract, see
[`pi-session-protocol.md`](./pi-session-protocol.md).

## Runtime ownership

Terax keeps these responsibilities in Rust/Tauri:

- workspace authorization and workspace-env validation;
- keyring and provider API-key reads;
- native file/search/shell/artifact/MCP execution;
- tool approval grants, policy checks, and audit records;
- Pi session metadata/event/transcript persistence;
- HTTP proxying for provider calls that would otherwise be blocked by CORS.

The webview owns only the in-memory Pi agent loop:

- `src/modules/pi/lib/pi-session-backend.ts` resolves the active backend to the
  webview implementation.
- `src/modules/pi/lib/webview-session.ts` manages session lifecycle, event
  emission, transcript serialization, resume/rollback/fork reconstruction, and
  persistence calls.
- `src/modules/pi/bridge/pi-session.ts` creates `@earendil-works/pi-agent-core`
  `Agent` instances with `@earendil-works/pi-ai` models and Terax tool
  adapters.
- `src/modules/pi/bridge/pi-http.ts` temporarily installs a ref-counted global
  fetch proxy while model streams are active; requests are routed through
  `ai_http_stream` or `ai_http_request`.

This keeps the release app small while preserving the security boundary that the
old sidecar was meant to enforce.

## Provider and model setup

Provider resolution starts in the normal Terax settings/model picker path. The
runtime config passed to `webviewSessionCreate`/`webviewSessionResume` includes
`authMode`, `provider`, `modelId`, optional `sourceModelId`, optional custom
endpoint id, optional base URL, and optional thinking level. Session rows now
persist the provider/model metadata so a restored or forked session keeps the
same model context instead of silently falling back to defaults.

Secrets are not stored in Pi session history. The webview bridge asks Rust for
runtime key material only at the point of use:

- `pi_env_api_key` resolves Terax-managed provider and custom-endpoint keys from
  the keyring.
- `pi_models_list` reads non-secret Pi profile model metadata when the user has
  explicitly opted into profile auth.
- The HTTP proxy forwards request headers/bodies to Rust for network I/O without
  exposing keys through diagnostics.

E2E runs set `localStorage["terax.e2e"] = "1"`, which swaps provider calls to a
deterministic faux Pi model in `src/modules/pi/bridge/pi-mock.ts`. That path is
not reachable in normal use.

## Tool execution boundary

Agent-visible native tools are defined in the webview, but execution is always
Rust-mediated:

| Agent tool | Native policy tool |
| --- | --- |
| `read_file` | `read` |
| `write_file` | `write` |
| `edit_file` | `edit` |
| `list_directory` | `ls` |
| `bash_run` | `bash` |
| `grep` | `grep` |
| `glob` | `find` |
| MCP qualified names | same qualified name |

Every tool call invokes `pi_agent_tool_execute` with the Pi session id, tool call
id, native tool name, cwd, workspace env, and sanitized input. Rust validates the
session/workspace, evaluates the capability manifest policy, consumes any needed
single-use approval grant, executes the operation, and records an audit entry.

Approval cards in the webview are UX only. For Ask-level tools (`bash`, `edit`,
`write`, and Ask-level MCP tools), approval records a grant through
`pi_approval_grant`; the subsequent `pi_agent_tool_execute` call is the only
place where the grant is consumed and privileged work can happen. Denial returns
a tool error result and does not execute the operation.

## Session persistence and restart behavior

Rust persists session metadata and event history in `pi-sessions.json` and stores
the webview agent's canonical `AgentMessage[]` transcript as an opaque JSON blob
under the app-data `pi-transcripts` directory. The transcript is separate from
the capped UI event log so resume, fork, and rollback can reconstruct an
agent-ready conversation even when old UI events have been trimmed.

The webview calls these Rust persistence commands:

- `pi_store_record_session`
- `pi_store_record_events`
- `pi_store_record_transcript`
- `pi_store_load_transcript`
- `pi_store_delete_transcript`

On app restart, the sidebar loads persisted sessions/events, reconstructs an
agent from the stored transcript on first resume/send, and marks expired approval
requests as non-actionable. `webviewSessionStop` aborts the active agent run,
marks the session idle when it can continue, and forgets Rust-side approval state
for that session. Delete removes metadata, transcript, artifact ownership where
requested, and approval grants.

## HTTP proxy

Provider SDKs call `fetch` from the renderer. During Pi model streams Terax
installs a scoped fetch proxy so HTTP(S) requests go through Rust:

- POST streams use `ai_http_stream` and Tauri `Channel` events.
- Non-streaming requests use `ai_http_request`.
- Unsupported raw bodies such as live `ReadableStream`/`FormData` are passed
  through to the real fetch rather than corrupted.
- `URLSearchParams` bodies are serialized as
  `application/x-www-form-urlencoded;charset=UTF-8`, including when a `Request`
  object already contains the generated body/header.

## Local CLI agents

The Pi sidebar can also show installed terminal coding agents: Claude Code,
Codex, Cursor Agent, OpenCode, and Pi. This is separate from the webview-native
Pi agent. Detection is an exact-name allowlist and never spawns the agent binary.
One-click launch opens a visible terminal in a conservative read/plan posture;
there is no hidden local-agent sidecar process.

## Packaging

The old Pi Node sidecar was removed to keep the default macOS app near the
11 MB target. `pnpm build:sidecars` remains in `package.json` because the app
still has a non-Pi speech-recognizer sidecar, but it no longer builds or bundles
a Pi host or a Node runtime for Pi. Pi-related package size is therefore governed
by the frontend bundle checks and the release app bundle size check, not by a
Pi sidecar smoke test.
