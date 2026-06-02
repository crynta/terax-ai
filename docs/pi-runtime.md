# Pi runtime integration

Terax keeps the app shell, editor, terminal, git, files, and SQLite surfaces Tauri/Rust-owned. The Pi integration is isolated to a Node sidecar that only loads `@earendil-works/pi-*` runtime packages.

## Production runtime strategy

The chosen strategy is a stock Node process with a self-contained Pi host dependency tree:

1. `sidecars/pi-host` is deployed as a production-only package during Tauri builds.
2. Tauri bundles the generated `sidecars/pi-host/dist` directory as an app resource.
3. Rust launches `sidecars/pi-host/host.js` over newline-delimited JSON-RPC stdio.
4. Node resolution order is:
   - `TERAX_NODE_BINARY` override,
   - a future bundled Node resource at `sidecars/node/...`,
   - `node` on `PATH` for development.

This keeps Pi code outside the frontend bundle and avoids giving the Node sidecar ownership of Terax-native responsibilities. The next distribution hardening step is to add a platform Node resource in CI/release packaging; the Rust launcher already prefers that location when present.

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

The Rust host manager applies a request timeout, captures a bounded stderr tail for diagnostics, cleans up timed-out children, and clears stale hosts so explicit starts can respawn a fresh sidecar.
