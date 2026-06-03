# Pi runtime integration

Terax keeps the app shell, editor, terminal, git, files, and SQLite surfaces Tauri/Rust-owned. The Pi integration is isolated to a Node sidecar that only loads `@earendil-works/pi-*` runtime packages.

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

The sidecar currently supports read-only capability probing and real no-tools Pi SDK sessions:

- `ping`
- `status`
- `info`
- `diagnostics`
- `models.list`
- `sessions.list`
- `sessions.create`
- `sessions.send`
- `sessions.stop`
- `shutdown`

See [`pi-session-protocol.md`](./pi-session-protocol.md) for the session contract and event envelope.

`status` is intentionally lightweight so the Start button does not block on cold Pi package imports. `info` imports the Pi packages and returns package name, version, load status, export count, and error text. It does not create sessions or touch workspace files.

`models.list` is the safe opt-in bridge for existing terminal Pi profiles. When the user enables "Use existing Pi profile", Rust resolves the explicit Pi agent directory (`PI_CODING_AGENT_DIR` or `~/.pi/agent`) and asks the sidecar to list non-secret `ModelRegistry` metadata from that profile. The settings Pi model picker can refresh this profile catalog on demand. The result includes model/provider labels, availability, and context limits, but never returns tokens or API keys. Terax-managed local/OpenAI-compatible models still come from Terax settings and custom endpoints, so profile discovery cannot mutate Terax provider keys or enable tools.

`sessions.create` creates an actual `AgentSession` from `@earendil-works/pi-coding-agent`, passes the Rust-validated Terax workspace cwd into `createAgentSession({ cwd })`, and keeps `noTools: "all"`. Terax-owned provider mode uses an in-memory `AuthStorage`/`ModelRegistry` fed by Rust keyring lookups. Profile mode instead passes the opted-in Pi `agentDir`, profile-backed `AuthStorage`/`ModelRegistry`, and `SettingsManager` to the SDK so Pi-only providers such as OpenAI Codex can use the same auth/catalog as terminal Pi without importing secrets into Terax settings. This keeps the first real prompt path model-only until Rust-owned tool bridges are designed deliberately, while project-local Pi context resolves from the user workspace instead of the Tauri/sidecar process cwd.

`sessions.send` returns after the prompt is accepted. Terax sends Rust-validated per-turn UI context (`workspace_root`, `active_terminal_cwd`, `active_file`) separately from the user prompt; the sidecar prepends it as an SDK-only `<env>` block while preserving the original prompt in session history. The sidecar streams later output/status/error envelopes as JSON-RPC `session.event` notifications; Rust filters those out of the response stream and emits frontend `pi:session-event` events.

Session metadata and event history are persisted by Rust under the app data directory in `pi-sessions.json`. The Node sidecar still keeps SDK `AgentSession` objects in memory only; after app restart, the sidebar restores persisted history without granting persistence ownership to Node.

The Pi sidebar prewarms the runtime once when it opens so package/model checks and session creation are ready before the first prompt. Rust owns the matching idle policy: after host activity, it schedules an idle shutdown and only stops the sidecar when `sessions.list` reports no running sessions. Running prompts keep the sidecar alive; manual Stop cancels the idle timer and shuts down immediately. Whenever Rust shuts down or clears a sidecar, persisted unfinished sessions (`idle` or `running`) are normalized to `stopped` with synthetic `session.status` events so restored history matches the runtime boundary.

`sessions.stop` acts as stream cancellation for running sessions: it aborts the active run, replaces the underlying SDK session, and returns the Terax Pi session to `idle` so the user can send a follow-up prompt in the same sidebar session. Stopping an already-idle session still disposes it and marks it `stopped`.

Boundary tests enforce that the sidecar package depends only on `@earendil-works/pi-*` packages, rejects Terax-owned method families such as terminal/PTY, shell, git, files, and editor calls with JSON-RPC `Method not found`, and keeps incidental Pi SDK stdout off the JSON-RPC stdout stream. Rust launches the sidecar with a minimal env allowlist that excludes provider API keys; Terax-owned provider credentials are resolved by Rust/keyring and sent only in the explicit `sessions.create` provider config when needed. The sidecar enforces method allowlists plus prompt/session resource limits. Diagnostics expose only non-secret status: capability flags stay disabled, allowed method names, resource limits, forwarded environment variable names, API-key presence booleans, and Rust manager policies such as idle shutdown and per-method timeouts.

The Rust host manager applies method-specific request timeouts, captures a bounded stderr tail for diagnostics, and cleans up timed-out children. Fast health calls such as `status` use short limits while model/session setup calls get longer budgets. Requests are matched by JSON-RPC id instead of arrival order: each call registers its id in a pending-response map, the stdout reader demultiplexes response lines by id, and `session.event` notifications are routed independently. This lets future concurrent Rust callers and multiple Pi sessions share one sidecar safely even if responses complete out of order. Transport/protocol failures clear stale hosts so explicit starts can respawn a fresh sidecar; JSON-RPC method errors such as busy or missing sessions do not tear down a healthy host.
