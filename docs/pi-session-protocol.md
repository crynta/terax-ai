# Pi session protocol

The Rust Pi host manager talks to the Node Pi host over newline-delimited JSON-RPC 2.0 on stdio. The protocol keeps Terax-owned capabilities out of the Node sidecar; session methods only manage Pi session state and prompt delivery.

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

Events are returned in method responses for the current stub. The same envelope is intended for the future async Tauri event bridge.

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

Creates an idle in-memory session. It does not start a real Pi runtime session yet.

### `sessions.send`

Params:

```ts
{ sessionId: string; prompt: string }
```

Result:

```ts
{ accepted: true; session: PiSession; events: PiSessionEvent[] }
```

For the stub protocol this records the prompt, marks the session `running`, and returns `session.input` plus `session.status` events. The real Pi integration will use the same method to send prompts into the runtime.

### `sessions.stop`

Params:

```ts
{ sessionId: string }
```

Result:

```ts
{ session: PiSession; events: PiSessionEvent[] }
```

Marks a session `stopped` and emits a `session.status` event.

## Errors

- JSON-RPC `-32602`: invalid params.
- JSON-RPC `-32004`: session not found.
