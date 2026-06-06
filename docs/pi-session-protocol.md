# Pi session protocol

The Rust Pi host manager talks to the Node Pi host over newline-delimited JSON-RPC 2.0 on stdio. The protocol keeps Terax-owned terminal, git, editor, file, shell, and SQLite capabilities out of the Node sidecar; session methods only manage Pi session state and prompt delivery. Rust persists session metadata/events separately in the app data directory. When the sidecar shuts down or is cleared after a transport failure, Rust records synthetic `session.status` events that mark unfinished persisted sessions as `stopped`.

Protocol compatibility is explicit. `ping` returns `hostVersion` and `protocolVersion`; callers may send `params.protocolVersion`, and the sidecar rejects unsupported versions with JSON-RPC `-32009` before dispatch. The sidecar owns an executable JSON-schema-style contract in `sidecars/pi-host/protocol-schema.js`; the JSON-RPC dispatcher validates every method's top-level params against that contract before handler execution. Handlers then perform deeper owner-specific checks for provider config, prompt context, workspace-env metadata, resource limits, and path-like values.

For review and verification checks for this protocol, see [`pi-sidebar-verification.md`](./pi-sidebar-verification.md).

## Runtime ownership

`sessions.create` now creates a real `@earendil-works/pi-coding-agent` `AgentSession` with Rust-mediated Terax custom tools, a Pi SDK JSONL `SessionManager`, the reviewed Terax approval extension, untrusted Pi extension loading disabled in the sidecar resource loader, and a stable workspace-root `cwd`. Rust chooses the app-owned SDK session directory, persists the returned `sdkSessionFile`, and validates that future resume requests stay inside that directory. Rust also records the authorized workspace environment (`local` or WSL distro) for the session; native tool requests must echo matching `cwd` and `workspaceEnv` before Rust executes anything. The sidecar overrides `read`, `ls`, `grep`, `find`, `bash`, `edit`, `write`, `create_artifact`, `edit_artifact`, `read_artifact`, and `list_artifacts`; actual execution is sent back to Rust with `nativeTools.execute`. Rust verifies the session id/cwd/workspace env, applies workspace and sensitive-path policy, executes the native operation, and returns the result to Pi. Artifact tools derive conversation ownership from the verified session id and do not accept model-provided conversation ids. Shell and mutating workspace tools still pause until Rust forwards an explicit `sessions.tool.respond` approval or denial. WSL `bash` currently fails closed until Terax routes shell execution through WSL instead of the local host shell. Native git, keyring, process lifecycle, and Terax metadata persistence ownership stays in Rust/Tauri, while the Pi SDK JSONL file owns conversation replay.

`sessions.send` accepts a prompt immediately, returns the initial `session.input` and `running` status events, then streams output/status/error events asynchronously as JSON-RPC notifications on stdout. Rust validates the optional per-turn Terax context before forwarding it, and the sidecar prepends that context as an `<env>` block only for the SDK prompt. The visible/persisted user prompt remains unchanged. When a reasoning-capable model exposes thinking levels, Terax may include a `thinkingLevel` for the next reply; the sidecar validates it and applies it with the Pi SDK before starting `AgentSession.prompt()`. Rust filters notifications out of the response stream and forwards them to the frontend as Tauri `pi:session-event` events.

## Session shape

```ts
type PiSessionStatus = "idle" | "running" | "stopped" | "error";

type PiSession = {
  // Opaque restart-safe id, e.g. `pi_<timestamp>_<random>`.
  id: string;
  title: string;
  cwd?: string;
  status: PiSessionStatus;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  lastPrompt: string | null;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  // Absolute path inside Terax's app-data pi-sdk-sessions directory.
  // Present for sessions that can be resumed after sidecar/app restart.
  sdkSessionFile?: string | null;
};
```

## Event envelope

Events use the same envelope in both method responses and live JSON-RPC notifications:

```json
{"jsonrpc":"2.0","method":"session.event","params":{...PiSessionEvent}}
```

```ts
type PiSessionEvent = {
  // Opaque restart-safe id, e.g. `evt_<timestamp>_<sequence>_<random>`.
  id: string;
  type:
    | "session.created"
    | "session.resumed"
    | "session.input"
    | "session.status"
    | "session.progress"
    | "session.reasoning.delta"
    | "session.reasoning.text"
    | "session.output.delta"
    | "session.output.text"
    | "session.tool.start"
    | "session.tool.update"
    | "session.tool.result"
    | "session.tool.approval.requested"
    | "session.tool.approval.responded"
    | "session.error";
  sessionId: string;
  createdAt: string; // ISO timestamp
  payload: Record<string, unknown>;
};
```

## Prompt context

Pi uses two cwd concepts:

1. Session `cwd`: stable workspace root for Pi SDK project discovery.
2. Prompt `context`: validated per-turn Terax UI state for answering questions like "where am I?".

```ts
type PiPromptContext = {
  workspaceRoot?: string;
  activeTerminalCwd?: string;
  activeFile?: string;
  activeTerminalPrivate?: boolean;
};
```

When present, the sidecar sends this to the SDK as:

```text
<env>
workspace_root: /project
active_terminal_cwd: /project/src
active_file: /project/src/App.tsx
active_terminal_mode: private
</env>

<user prompt>
```

## Methods

### `diagnostics`

Params: none.

Result includes host/package status, Node runtime metadata, rust-mediated tool mode, session storage mode, API-key presence booleans, capability flags, JSON-RPC method allowlist, resource limits, forwarded environment variable names, and Rust manager policy such as idle shutdown and method-specific timeouts. It never returns secret values.

```ts
type PiDiagnostics = PiHostInfo & {
  node: {
    version: string;
    execPath: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
  };
  config: {
    toolMode: "rust-mediated";
    enabledTools: Array<"read" | "ls" | "grep" | "find" | "bash" | "edit" | "write" | "create_artifact" | "edit_artifact" | "read_artifact" | "list_artifacts">;
    approvalRequiredTools: Array<"bash" | "edit" | "write">;
    sessionStorage: "rust-app-data-json+pi-sdk-jsonl";
    apiKeys: Array<{ name: string; configured: boolean }>;
    forwardedEnvNames: string[];
  };
  capabilities: {
    tools: true;
    files: true;
    shell: true;
    git: false;
    terminal: false;
    editor: false;
  };
  protocol: { protocolVersion: number; allowedMethods: string[] };
  limits: { maxPromptChars: number; maxSessions: number };
  manager: {
    idleShutdownMs: number;
    methodTimeouts: Array<{ method: string; timeoutMs: number }>;
  };
  sessions: Array<{
    id: string;
    title: string;
    status: string;
    cwd: string | null;
    sdkSessionFile?: string | null;
  }>;
};
```

### `models.list`

Params:

```ts
{ profileAgentDir: string }
```

Result:

```ts
type PiProfileModelInfo = {
  provider: string;
  providerLabel: string;
  id: string;
  label: string;
  available: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  reasoning: boolean;
};

{
  profileAgentDir: string;
  loadError: string | null;
  models: PiProfileModelInfo[];
}
```

Lists non-secret model catalog metadata from an explicitly opted-in terminal Pi profile. The sidecar reads `auth.json`/`models.json` through Pi SDK `AuthStorage` and `ModelRegistry`, reports whether auth is available, and never returns secret values.

### `sessions.list`

Params: none.

Result:

```ts
{ sessions: PiSession[] }
```

### `sessions.create`

Params:

```ts
type PiProviderConfig = {
  authMode?: "terax" | "profile";
  provider: string;
  modelId: string;
  sourceModelId?: string;
  baseUrl?: string;
  contextLimit?: number;
  customEndpointId?: string;
};

{ title?: string; cwd?: string; providerConfig?: PiProviderConfig; sessionDir?: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Creates an idle Pi SDK `AgentSession` backed by a JSONL SDK session file. `cwd` scopes Pi project context and must be a non-empty string when provided. Terax's Tauri command requires `cwd`, canonicalizes and validates it against the authorized workspace, creates the app-data `pi-sdk-sessions` directory, forwards that directory as `sessionDir`, forwards the current `workspaceEnv`, then persists the returned `sdkSessionFile` in `pi-sessions.json`.

When `providerConfig.authMode` is omitted or `"terax"`, Rust fetches the selected Terax keyring entry, excludes provider keys from the sidecar process environment, forwards only the runtime key in this request to an in-memory sidecar auth registry, and the sidecar never persists it. When `authMode` is `"profile"`, Rust resolves the opted-in terminal Pi agent directory and forwards only that directory path; the sidecar uses Pi SDK profile-backed auth/model/settings objects so terminal Pi providers remain separate from Terax AI settings.

### `sessions.resume`

Params:

```ts
{
  sessionId: string;
  title: string;
  cwd: string;
  sdkSessionFile: string;
  sessionDir: string;
  providerConfig?: PiProviderConfig;
  createdAt?: string;
  lastPrompt?: string | null;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Reopens a persisted Pi SDK JSONL conversation with `SessionManager.open()` after the Node sidecar lost its in-memory `AgentSession` map. Rust loads the session from `pi-sessions.json`, validates the authorized workspace `cwd`, validates `sdkSessionFile` against the app-data `pi-sdk-sessions` directory, verifies the file is an existing regular file, forwards the metadata to the sidecar, persists the returned live session snapshot, and emits `session.resumed`. The sidecar also checks that `sdkSessionFile` is readable, regular, and inside `sessionDir` before opening it. Resuming does not recreate pending tool approvals; restored approval-only transcript items are treated as expired/denied when a stopped status is present.

### `sessions.send`

Params:

```ts
{
  sessionId: string;
  prompt: string;
  context?: PiPromptContext;
  regenerateBranchGroupId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
```

Result:

```ts
{ accepted: boolean; session: PiSession; events: PiSessionEvent[] }
```

Accepts the prompt, applies an optional `thinkingLevel` to the current idle/error SDK session for the next reply, starts `AgentSession.prompt()` asynchronously, and returns immediately with `accepted: true`, `session.input`, and `session.status` (`running`) events. The sidecar tags prompt, progress, reasoning, and output events with non-secret response-branch metadata so the frontend can show regenerated answers as alternate versions of the same turn. `regenerateBranchGroupId` asks the sidecar to append the next branch for an existing turn; normal sends create a fresh branch group. Lifecycle progress, streamed reasoning (`thinking_*` Pi SDK parts), output deltas, exact final output text, Rust-mediated tool timeline events, completion status, and errors are delivered later as `session.event` notifications and Tauri `pi:session-event` events.


### `sessions.tool.respond`

Params:

```ts
{ sessionId: string; toolCallId: string; approved: boolean }
```

When a shell or mutating Terax custom tool requests approval, the sidecar emits `session.tool.approval.requested` with `approvalId`/`toolCallId`, `toolName`, and sanitized `input`. Rust forwards the user's decision through this method. Approval resumes the paused tool call, which then executes through `nativeTools.execute`. Denial resolves it as an error tool result without running the command or mutation. Unknown, stale, or already-resolved approvals return JSON-RPC `-32008`.

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

The response includes a `session.tool.approval.responded` event. Rust persists and emits that event like other session events.

### `sessions.rename`

Params:

```ts
{ sessionId: string; title: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Renames a live sidecar session, disables future automatic title derivation for that session, and emits `session.renamed`. Empty titles and newline-bearing titles are rejected.

### `sessions.delete`

Params:

```ts
{ sessionId: string }
```

Result:

```ts
{ events: PiSessionEvent[] }
```

Stops and disposes the SDK session, denies any pending tool approvals with returned `session.tool.approval.responded` events, removes it from live sidecar state, and emits `session.deleted`. Rust applies the delete event to persisted history and removes older events for that session.

### `sessions.stop`

Params:

```ts
{ sessionId: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

If the session is running, aborts the active Pi prompt with `AgentSession.abort()`, replaces the underlying SDK `AgentSession`, marks the Terax Pi session `idle`, and emits a returned `session.status` event so the same sidebar session remains sendable. Late prompt completion/error callbacks from the cancelled run are ignored.

If the session is not running, disposes the SDK session, marks it `stopped`, and emits a `session.status` event.

## Errors

- JSON-RPC `-32602`: invalid params.
- JSON-RPC `-32004`: session not found.
- JSON-RPC `-32005`: session is stopped.
- JSON-RPC `-32006`: resource limit exceeded.
- JSON-RPC `-32007`: session is already running.
- JSON-RPC `-32008`: tool approval was not found.
