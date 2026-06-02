# Pi session protocol

The Rust Pi host manager talks to the Node Pi host over newline-delimited JSON-RPC 2.0 on stdio. The protocol keeps Terax-owned capabilities out of the Node sidecar; session methods only manage Pi session state and prompt delivery.

## Runtime ownership

`sessions.create` now creates a real `@earendil-works/pi-coding-agent` `AgentSession` with `noTools: "all"` and an in-memory `SessionManager`. This proves prompt execution can flow through the Pi SDK without allowing the Node sidecar to own Terax files, shell, terminal, git, editor, or SQLite responsibilities.

Until the live event bridge is added, `sessions.send` waits for `AgentSession.prompt()` to finish and returns the collected output/status events in the JSON-RPC response. The next protocol milestone will forward the same event envelope asynchronously while a run is in progress.

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

Events are returned in method responses for the current batched protocol. The same envelope is intended for the async Tauri event bridge.

```ts
type PiSessionEvent = {
  id: `evt-${number}`;
  type:
    | "session.created"
    | "session.input"
    | "session.status"
    | "session.output.delta"
    | "session.error";
  sessionId: string;
  createdAt: string; // ISO timestamp
  payload: Record<string, unknown>;
};
```

## Methods

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

Sends the prompt through `AgentSession.prompt()`. On success, output deltas are returned as `session.output.delta`, and the session returns to `idle`. If Pi rejects or fails the prompt, the response is still a method result with `accepted: false`, a `session.error` event, and `status: "error"`.

### `sessions.stop`

Params:

```ts
{ sessionId: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Aborts a running Pi session when possible, disposes the SDK session, marks it `stopped`, and emits a `session.status` event.

## Errors

- JSON-RPC `-32602`: invalid params.
- JSON-RPC `-32004`: session not found.
- JSON-RPC `-32005`: session is stopped.
