# Pi session protocol

The Rust Pi host manager talks to the Node Pi host over newline-delimited JSON-RPC 2.0 on stdio. The protocol keeps Terax-owned capabilities out of the Node sidecar; session methods only manage Pi session state and prompt delivery. Rust persists session metadata/events separately in the app data directory. When the sidecar shuts down or is cleared after a transport failure, Rust records synthetic `session.status` events that mark unfinished persisted sessions as `stopped`.

## Runtime ownership

`sessions.create` now creates a real `@earendil-works/pi-coding-agent` `AgentSession` with `noTools: "all"`, an in-memory `SessionManager`, and a stable workspace-root `cwd`. This proves prompt execution can flow through the Pi SDK without allowing the Node sidecar to own Terax files, shell, terminal, git, editor, or SQLite responsibilities.

`sessions.send` accepts a prompt immediately, returns the initial `session.input` and `running` status events, then streams output/status/error events asynchronously as JSON-RPC notifications on stdout. Rust validates the optional per-turn Terax context before forwarding it, and the sidecar prepends that context as an `<env>` block only for the SDK prompt. The visible/persisted user prompt remains unchanged. Rust filters notifications out of the response stream and forwards them to the frontend as Tauri `pi:session-event` events.

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
    | "session.input"
    | "session.status"
    | "session.output.delta"
    | "session.output.text"
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

Result includes host/package status, Node runtime metadata, no-tools mode, session storage mode, API-key presence booleans, disabled capability flags, JSON-RPC method allowlist, resource limits, forwarded environment variable names, and Rust manager policy such as idle shutdown and method-specific timeouts. It never returns secret values.

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
    toolMode: "noTools";
    sessionStorage: "rust-app-data-json";
    apiKeys: Array<{ name: string; configured: boolean }>;
    forwardedEnvNames: string[];
  };
  capabilities: {
    tools: false;
    files: false;
    shell: false;
    git: false;
    terminal: false;
    editor: false;
  };
  protocol: { allowedMethods: string[] };
  limits: { maxPromptChars: number; maxSessions: number };
  manager: {
    idleShutdownMs: number;
    methodTimeouts: Array<{ method: string; timeoutMs: number }>;
  };
  sessions: Array<{ id: string; title: string; status: string; cwd: string | null }>;
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

{ title?: string; cwd?: string; providerConfig?: PiProviderConfig }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Creates an idle Pi SDK `AgentSession` owned by the sidecar. `cwd` scopes Pi project context and must be a non-empty string when provided. Terax's Tauri command requires `cwd`, canonicalizes and validates it against the authorized workspace, then forwards only that canonical path to the Node sidecar.

When `providerConfig.authMode` is omitted or `"terax"`, Rust fetches the selected Terax keyring entry, excludes provider keys from the sidecar process environment, forwards only the runtime key in this request to an in-memory sidecar auth registry, and the sidecar never persists it. When `authMode` is `"profile"`, Rust resolves the opted-in terminal Pi agent directory and forwards only that directory path; the sidecar uses Pi SDK profile-backed auth/model/settings objects so terminal Pi providers remain separate from Terax AI settings.

### `sessions.send`

Params:

```ts
{ sessionId: string; prompt: string; context?: PiPromptContext }
```

Result:

```ts
{ accepted: boolean; session: PiSession; events: PiSessionEvent[] }
```

Accepts the prompt, starts `AgentSession.prompt()` asynchronously, and returns immediately with `accepted: true`, `session.input`, and `session.status` (`running`) events. Output deltas, exact final output text, completion status, and errors are delivered later as `session.event` notifications and Tauri `pi:session-event` events.

### `sessions.stop`

Params:

```ts
{ sessionId: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

If the session is running, aborts the active Pi prompt with `AgentSession.abort()`, replaces the underlying SDK `AgentSession`, marks the Terax Pi session `idle`, and emits a `session.status` event so the same sidebar session remains sendable. Late prompt completion/error callbacks from the cancelled run are ignored.

If the session is not running, disposes the SDK session, marks it `stopped`, and emits a `session.status` event.

## Errors

- JSON-RPC `-32602`: invalid params.
- JSON-RPC `-32004`: session not found.
- JSON-RPC `-32005`: session is stopped.
- JSON-RPC `-32006`: resource limit exceeded.
- JSON-RPC `-32007`: session is already running.
