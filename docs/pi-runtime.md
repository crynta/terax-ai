# Pi runtime integration

Terax keeps the app shell, editor, terminal, git, and SQLite surfaces Tauri/Rust-owned. The Pi integration is isolated to a Node sidecar that loads `@earendil-works/pi-*` runtime packages while routing Pi tool execution back through a Rust-mediated native bridge.

For the focused Pi sidebar verification checklist, see [`pi-sidebar-verification.md`](./pi-sidebar-verification.md).

## Production runtime strategy

The chosen strategy is a stock Node process with a self-contained Pi host dependency tree:

1. `sidecars/node` stages a real Node executable during sidecar builds.
2. `sidecars/pi-host` is deployed as a production-only package during Tauri builds.
3. Tauri bundles the generated `sidecars/node/dist` and `sidecars/pi-host/dist` directories as app resources.
4. Rust launches `sidecars/pi-host/host.js` over newline-delimited JSON-RPC stdio.
5. Node resolution order is:
   - `TERAX_NODE_BINARY` override,
   - bundled Node resource at `sidecars/node/...` when `node --version` succeeds,
   - generated development Node at `sidecars/node/dist/...` when available,
   - `node` on `PATH` for fallback.

`pnpm build:sidecars` builds both generated resource directories. By default, `scripts/build-node-runtime.mjs` copies the current `process.execPath` into the bundled runtime path for fast deterministic local smoke tests. CI defaults to `TERAX_NODE_RUNTIME_SOURCE=download`, and release CI pins `TERAX_NODE_RUNTIME_VERSION=24.16.0`, stages the matching official Node archive from nodejs.org, verifies it against the release `SHASUMS256.txt`, and records the archive checksum in `runtime-manifest.json`. The Pi host bundle uses hoisted PNPM deployment so Tauri resource copying does not drop package-resolution symlinks. `pnpm smoke:pi-host` then runs the generated host with the generated Node executable from a temporary cwd, verifies Pi packages load from the bundled dependency tree, and creates/sends a faux Pi session.

This keeps Pi code outside the frontend bundle and avoids giving the Node sidecar ownership of Terax-native responsibilities.

## Current sidecar boundary

The sidecar currently supports runtime probing, model catalog checks, real Pi SDK sessions with Rust-mediated tools, prompt delivery, and session metadata operations:

- `ping`
- `status`
- `info`
- `diagnostics`
- `models.list`
- `sessions.list`
- `sessions.create`
- `sessions.send`
- `sessions.resume`
- `sessions.tool.respond`
- `sessions.rename`
- `sessions.delete`
- `sessions.stop`
- `shutdown`

See [`pi-session-protocol.md`](./pi-session-protocol.md) for the session contract and event envelope.

`status` is intentionally lightweight so the Start button does not block on cold Pi package imports. `info` imports the Pi packages and returns package name, version, load status, export count, and error text. It does not create sessions or touch workspace files.

`models.list` is the safe opt-in bridge for existing terminal Pi profiles. When the user enables "Use existing Pi profile", Rust resolves the explicit Pi agent directory (`PI_CODING_AGENT_DIR` or `~/.pi/agent`) and asks the sidecar to list non-secret `ModelRegistry` metadata from that profile. The settings Pi model picker can refresh this profile catalog on demand. The result includes model/provider labels, availability, and context limits, but never returns tokens or API keys. Terax-managed local/OpenAI-compatible models still come from Terax settings and custom endpoints, so profile discovery cannot mutate Terax provider keys or enable tools.

## Local CLI agents in the Pi sidebar

The Pi sidebar can also show installed terminal coding agents: Claude Code, Codex, Cursor Agent, OpenCode, and Pi. This is an operational dashboard, not a hidden provider bridge. Rust exposes `pi_local_agents_status`, which checks an allowlist of exact executable names on the current workspace shell `PATH` and returns only the resolved path or missing state. Local workspaces use the host login-shell `PATH`; WSL workspaces probe the selected distro's login shell so detection matches the terminal that will launch the agent. Refresh re-probes PATH instead of using a process-lifetime cache, so newly installed CLIs can appear without restarting Terax. No agent CLI process is spawned for detection.

One-click launch is intentionally conservative:

- Claude Code opens a visible terminal with `claude --permission-mode plan`.
- Codex opens a visible terminal with `codex --sandbox read-only --ask-for-approval on-request`.
- Cursor Agent opens a visible terminal with `cursor-agent --mode plan`.
- Pi opens a visible terminal with `pi --tools read,grep,find,ls`, using Pi's documented tool allowlist to keep the launch read/search-only and exclude `bash`, `edit`, and `write`.
- OpenCode opens a visible POSIX terminal command with `--pure`, project config disabled, a temporary HOME/XDG config/cache/state directory, the user's XDG data directory preserved for auth, and a Terax-owned deny-by-default `terax-plan` config. Windows OpenCode launch remains disabled until Terax has a native env-aware terminal launch path there.

When the Pi composer has text, the card can open a selected launchable local agent with that prompt as the initial visible CLI prompt. The prompt is shell-quoted, control characters are stripped, and the agent still starts in the same safe launch posture. OpenCode prompt handoff uses `--prompt` only inside the same isolated visible-shell command. The local agent rule is: visible terminal first, plan/read-only posture by default, no hidden Terax spawns, and no automatic file edits from the sidebar. Settings remain the place for provider/model configuration; the sidebar shows detection, active status, docs/install actions, and safe launch entry points.

`sessions.create` creates an actual `AgentSession` from `@earendil-works/pi-coding-agent`, passes the Rust-validated Terax workspace cwd into `createAgentSession`, disables untrusted Pi extension loading in the sidecar resource loader, installs the approval extension, and overrides `read`, `ls`, `grep`, `find`, `bash`, `edit`, `write`, `create_artifact`, `edit_artifact`, `read_artifact`, and `list_artifacts` with Terax custom tools. Rust provides an app-data `pi-sdk-sessions` directory, and the sidecar uses `SessionManager.create(cwd, sessionDir)` so the Pi SDK persists full conversation state as JSONL while Terax keeps only metadata/events in `pi-sessions.json`. Those custom tools send reverse JSON-RPC `nativeTools.execute` requests back to Rust; Pi chooses the tool intent, but Rust verifies the session id/cwd and executes the native operation. Read/list/search tools are workspace-confined and sensitive-path checked; grep/find skip sensitive files during traversal. Artifact tools write only app-owned artifact state, derive the conversation from the verified Pi session id, and follow the storage/preview/export rules in [Chat Artifacts](./artifacts.md). Shell and mutating workspace tools (`bash`, `edit`, `write`) pause the SDK run until Rust forwards an explicit `sessions.tool.respond` approval or denial from the UI, then execute in Rust rather than Pi's built-in file/shell backends. Native git, keyring, file access, shell access, process lifecycle, terminal, editor, and Terax metadata persistence ownership stays in Rust/Tauri. Terax-owned provider mode uses an in-memory `AuthStorage`/`ModelRegistry` fed by Rust keyring lookups. Profile mode instead passes the opted-in Pi `agentDir`, profile-backed `AuthStorage`/`ModelRegistry`, and `SettingsManager` to the SDK so Pi-only providers such as OpenAI Codex can use the same auth/catalog as terminal Pi without importing secrets into Terax settings.

`sessions.send` returns after the prompt is accepted. Terax sends Rust-validated per-turn UI context (`workspace_root`, `active_terminal_cwd`, `active_file`) separately from the user prompt; the sidecar prepends it as an SDK-only `<env>` block while preserving the original prompt in session history. When present, `thinkingLevel` is validated and applied to the current SDK session before the next prompt starts. Prompt, progress, reasoning, output, status, and error events carry non-secret response-branch metadata so regenerated answers can be grouped as versions of the same turn without handing persistence to the sidecar. The sidecar streams later progress, reasoning, output, status, and error envelopes as JSON-RPC `session.event` notifications; Rust filters those out of the response stream and emits frontend `pi:session-event` events.


`sessions.tool.respond` records an approval decision for a pending Terax custom tool request and returns the resulting `session.tool.approval.responded` event. Stale or already-resolved approvals fail with `PI_APPROVAL_NOT_FOUND` / JSON-RPC `-32008`.

`sessions.rename` and `sessions.delete` are metadata operations on live sidecar sessions. Rename emits `session.renamed`; delete disposes the SDK session, denies any pending approvals, removes live state, and emits `session.deleted`. Rust applies those events to persisted history so stale session rows disappear after restart as well.

Session metadata and event history are persisted by Rust under the app data directory in `pi-sessions.json`; full Pi conversation state is persisted by the Pi SDK JSONL file recorded as `sdkSessionFile`. The Node sidecar still keeps only live SDK `AgentSession` objects in memory. After app or sidecar restart, the sidebar restores persisted history, shows stopped sessions with `sdkSessionFile` as resumable, and calls `sessions.resume`; Rust validates the SDK file path and the workspace before the sidecar reopens it with `SessionManager.open()`. Older history-only sessions without `sdkSessionFile` remain visible but can only be continued in a new session. Pending tool approvals are never resumed across this boundary; stopped transcripts mark restored approval requests as expired/denied for safety.

The Pi sidebar prewarms the runtime once when it opens so package/model checks and session creation are ready before the first prompt. Rust owns the matching idle policy: after host activity, it schedules an idle shutdown and only stops the sidecar when `sessions.list` reports no running sessions. Running prompts keep the sidecar alive; manual Stop cancels the idle timer and shuts down immediately. Whenever Rust shuts down or clears a sidecar, persisted unfinished sessions (`idle` or `running`) are normalized to `stopped` with synthetic `session.status` events so restored history matches the runtime boundary.

`sessions.stop` acts as stream cancellation for running sessions: it aborts the active run, replaces the underlying SDK session, and returns the Terax Pi session to `idle` so the user can send a follow-up prompt in the same sidebar session. Stopping an already-idle session still disposes it and marks it `stopped`.

Boundary tests enforce that the sidecar package depends only on `@earendil-works/pi-*` packages, rejects Terax-owned method families such as terminal/PTY, git, files, and editor calls with JSON-RPC `Method not found`, routes custom tool execution through `nativeTools.execute`, and keeps incidental Pi SDK stdout off the JSON-RPC stdout stream. Rust launches the sidecar with a minimal env allowlist that excludes provider API keys; Terax-owned provider credentials are resolved by Rust/keyring and sent only in the explicit `sessions.create` provider config when needed. The sidecar enforces method allowlists, Rust-mediated custom tools, approval prompts for shell/mutations, workspace/sensitive-path checks, and prompt/session resource limits. Diagnostics expose only non-secret status: rust-mediated tool mode, exact enabled/approval tool lists, allowed method names, resource limits, forwarded environment variable names, API-key presence booleans, and Rust manager policies such as idle shutdown and per-method timeouts.

The Rust host manager applies method-specific request timeouts, captures a bounded stderr tail for diagnostics, and cleans up timed-out children. Fast health calls such as `status` use short limits while model/session setup calls get longer budgets. Requests are matched by JSON-RPC id instead of arrival order: each call registers its id in a pending-response map, the stdout reader demultiplexes response lines by id, and `session.event` notifications are routed independently. This lets future concurrent Rust callers and multiple Pi sessions share one sidecar safely even if responses complete out of order. Transport/protocol failures clear stale hosts so explicit starts can respawn a fresh sidecar; JSON-RPC method errors such as busy or missing sessions do not tear down a healthy host.
