# Pi native tool bridge

Terax now runs Pi SDK sessions with a Rust-mediated native tool bridge. The Node sidecar still hosts `@earendil-works/pi-coding-agent`, but Pi tool execution is routed back to Tauri over reverse JSON-RPC (`nativeTools.execute`). Rust validates the session workspace and executes the native operation, so the LLM chooses intent while Terax keeps authority over files, shell, approvals, persistence, and audit events.

## Current invariants

- The sidecar reports `toolMode: "rust-mediated"`.
- Enabled Pi tool names are exactly `read`, `ls`, `grep`, `find`, `bash`, `edit`, and `write`.
- The sidecar overrides those tool names with Terax custom tool definitions from `native-tools.js`; Pi built-in file/shell backends are not the executor.
- `nativeTools.execute` is a reverse JSON-RPC request from Node to Rust for actual tool execution.
- Rust records the authorized session `cwd` returned by `sessions.create`; native tool requests from unknown sessions or mismatched cwd values are rejected.
- Approval-required tools remain exactly `bash`, `edit`, and `write`.
- `sessions.tool.respond` is in the sidecar allowlist and exposed through Tauri as `pi_session_tool_respond` for approval UI decisions.
- Read/list/search/edit/write paths are constrained to the Rust-authorized workspace and reject sensitive files/directories.
- Grep/find skip sensitive files encountered during traversal.
- Pending approvals are denied on stop, delete, sidecar error, run abort, or session disposal.
- Unknown, stale, or already-resolved approval responses return structured `PI_APPROVAL_NOT_FOUND` metadata.
- User/project Pi extensions are not loaded in the embedded sidecar; only reviewed Terax wiring is active.

## Runtime flow

1. Pi proposes a tool call such as `read` or `bash`.
2. The sidecar approval extension checks the tool name and coarse path policy.
3. For `bash`, `edit`, and `write`, the sidecar emits `session.tool.approval.requested` and waits for the sidebar decision.
4. After approval, the custom tool definition sends `nativeTools.execute` to Rust with `sessionId`, `toolCallId`, `toolName`, `cwd`, and input.
5. Rust verifies that the request belongs to a known session and cwd, then executes the native operation with workspace and sensitive-path policy.
6. The sidecar returns the Rust result to Pi and emits the usual tool timeline events for transcript persistence.

## Safety requirements

1. Tool names stay allowlisted; unknown tools remain unavailable.
2. Pi built-in file/shell/edit/write implementations must not be the final executor.
3. Native tool requests must match a Rust-authorized session workspace.
4. File/search/mutation tools remain scoped to the authorized workspace and reject sensitive paths.
5. Shell commands and mutations require explicit approval before execution.
6. Pending approvals are denied on stop, delete, session error, run abort, or disposal.
7. Stale approval responses return structured `PI_APPROVAL_NOT_FOUND` metadata.
8. Sidecar source and generated `dist` files stay synchronized before release.
9. Diagnostics and protocol responses never expose provider secrets.

## Verification

```bash
pnpm check:pi-boundary
pnpm exec vitest run sidecars/pi-host scripts/check-pi-approval-boundary.test.mjs
cd src-tauri && cargo test --locked modules::pi --lib
pnpm build:sidecars
pnpm smoke:pi-host
```
