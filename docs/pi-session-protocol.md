# Pi session protocol

The Rust Pi host manager talks to the Node Pi host over newline-delimited JSON-RPC 2.0 on stdio. The protocol keeps Terax-owned capabilities out of the Node sidecar; session methods only manage Pi session state and prompt delivery. Rust persists session metadata/events separately in the app data directory.

## Runtime ownership

`sessions.create` now creates a real `@earendil-works/pi-coding-agent` `AgentSession` with `noTools: "all"` and an in-memory `SessionManager`. This proves prompt execution can flow through the Pi SDK without allowing the Node sidecar to own Terax files, shell, terminal, git, editor, or SQLite responsibilities.

`sessions.send` accepts a prompt immediately, returns the initial `session.input` and `running` status events, then streams output/status/error events asynchronously as JSON-RPC notifications on stdout. Rust filters those notifications out of the response stream and forwards them to the frontend as Tauri `pi:session-event` events.

## Session shape

```ts
type PiSessionStatus = "idle" | "running" | "stopped" | "error";

type PiSession = {
  id: `pi-${number}`;
  title: string;
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
  id: `evt-${number}`;
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

## Methods

### `diagnostics`

Params: none.

Result includes host/package status, Node runtime metadata, no-tools mode, session storage mode, and API-key presence booleans. It never returns secret values.

### `sessions.list`

Params: none.

Result:

```ts
{ sessions: PiSession[] }
```

### `sessions.create`

Params:

```ts
{ title?: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Creates an idle Pi SDK `AgentSession` owned by the sidecar.

### `sessions.send`

Params:

```ts
{ sessionId: string; prompt: string }
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

Aborts a running Pi session with `AgentSession.abort()` when possible, disposes the SDK session, marks it `stopped`, and emits a `session.status` event. Late prompt completion/error callbacks are ignored after the session is stopped.

## Errors

- JSON-RPC `-32602`: invalid params.
- JSON-RPC `-32004`: session not found.
- JSON-RPC `-32005`: session is stopped.
- JSON-RPC `-32006`: resource limit exceeded.
