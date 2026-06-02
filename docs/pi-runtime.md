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
   - bundled Node resource at `sidecars/node/...`,
   - `node` on `PATH` for development fallback.

`pnpm build:sidecars` builds both generated resource directories. By default, `scripts/build-node-runtime.mjs` copies the current `process.execPath` into the bundled runtime path for deterministic local smoke tests. Release CI can set `TERAX_NODE_RUNTIME_SOURCE=download` (or pass `--download`) plus `TERAX_NODE_RUNTIME_VERSION=<version>` to stage an official Node distribution from nodejs.org.

This keeps Pi code outside the frontend bundle and avoids giving the Node sidecar ownership of Terax-native responsibilities.

## Current sidecar boundary

The sidecar currently supports read-only capability probing and in-memory session protocol stubs:

- `ping`
- `status`
- `info`
- `sessions.list`
- `sessions.create`
- `sessions.send`
- `sessions.stop`
- `shutdown`

See [`pi-session-protocol.md`](./pi-session-protocol.md) for the session contract and event envelope.

`info` imports the Pi packages and returns package name, version, load status, export count, and error text. It does not create sessions or touch workspace files.

Boundary tests enforce that the sidecar package depends only on `@earendil-works/pi-*` packages and rejects Terax-owned method families such as terminal/PTY, shell, git, files, and editor calls with JSON-RPC `Method not found`.

The Rust host manager applies a request timeout, captures a bounded stderr tail for diagnostics, cleans up timed-out children, and clears stale hosts so explicit starts can respawn a fresh sidecar.
