# Pi native tool bridge

Terax runs Pi sessions in the webview, but Pi tool execution is still a
Rust-mediated native bridge. The model can propose intent; Rust decides whether
that intent is allowed and performs the privileged operation.

## Current invariants

- The webview exposes reviewed agent tool definitions from
  `src/modules/pi/bridge/pi-session.ts`.
- Agent tool names are mapped to native policy names before execution:
  `read_file -> read`, `write_file -> write`, `edit_file -> edit`,
  `list_directory -> ls`, `bash_run -> bash`, `grep -> grep`, and
  `glob -> find`.
- MCP tools are exposed only when Rust reports them as model-visible and not
  denied by manifest policy; execution uses the MCP qualified tool name.
- Every agent-initiated tool call invokes `pi_agent_tool_execute`; there is no
  model-accessible direct call to Terax file, shell, artifact, or MCP commands.
- Rust validates session id, cwd, workspace env, capability policy, approval
  grants, and sensitive-path rules before execution.
- Ask-level tools require a single-use grant recorded by `pi_approval_grant`.
  Denied tools do not receive a grant and therefore cannot execute.
- Artifact tools operate on app-owned artifact state and derive ownership from
  the verified Pi session id.
- Approval grants are forgotten on stop/delete through `pi_agent_session_forget`.
- Provider secrets never appear in diagnostics, event history, transcripts, or
  tool audit output.

## Runtime flow

1. The webview Pi agent proposes a tool call such as `read_file`, `bash_run`,
   `write_file`, or an MCP qualified name.
2. For Ask-level tools, the webview emits `session.tool.approval.requested` and
   waits for the sidebar decision.
3. If the user approves, the webview records a Rust grant with
   `pi_approval_grant(sessionId, toolCallId, nativeToolName)`.
4. The tool implementation invokes `pi_agent_tool_execute` with session id, tool
   call id, native tool name, cwd, workspace env, and sanitized input.
5. Rust authorizes the workspace, evaluates capability/MCP policy, consumes the
   grant if required, executes through the native dispatcher, and records an
   audit entry.
6. The webview converts the Rust result back into a Pi agent tool result and
   persists the normal tool timeline events.

Approval UI is not the security boundary. `pi_agent_tool_execute` is the only
place where approved shell or mutation work can happen.

## Safety requirements

1. Unknown native tools remain denied unless explicitly added to the Rust
   capability manifest or model-visible MCP registry.
2. Pi built-in file/shell/edit/write implementations must not be the final
   executor for Terax workspace operations.
3. Native tool requests must match a live, Rust-authorized workspace.
4. File/search/mutation tools remain scoped to the authorized workspace and
   reject sensitive paths.
5. Shell commands and mutations require explicit approval before execution.
6. Approval grants are single-use and cleared on stop/delete.
7. Denial and stale approval responses must not execute the tool.
8. Diagnostics and persisted session data never expose provider secrets.

## Verification

```bash
pnpm check:pi-boundary
pnpm exec vitest run src/modules/pi/bridge/pi-tools.test.ts src/modules/pi/lib/webview-session.test.ts
pnpm exec vitest run src/modules/pi/bridge/pi-http.test.ts
cd src-tauri && cargo test --locked pi_agent_tool
```

For end-to-end coverage, `e2e/specs/pi-approval.e2e.mjs` uses the deterministic
faux Pi provider to assert approve -> execute and deny -> no-op through
`pi_agent_tool_execute`.
