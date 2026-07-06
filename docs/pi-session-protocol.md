# Pi session protocol

Pi sessions are webview-native. The old Node Pi host JSON-RPC protocol is gone
from the default app; the renderer now calls TypeScript `webviewSession*`
functions and persists through explicit Tauri commands. Rust/Tauri remains the
security boundary for storage, provider key lookup, tool execution, MCP calls,
HTTP proxying, and approval grants.

For runtime ownership and packaging details, see
[`pi-runtime.md`](./pi-runtime.md). For review and verification checks, see
[`pi-sidebar-verification.md`](./pi-sidebar-verification.md).

## Runtime ownership

- The webview creates `@earendil-works/pi-agent-core` `Agent` instances through
  `src/modules/pi/bridge/pi-session.ts`.
- The session backend in `src/modules/pi/lib/pi-session-backend.ts` routes the
  UI to `webviewSessionCreate`, `webviewSessionSend`, `webviewSessionResume`,
  `webviewSessionStop`, `webviewSessionRename`, `webviewSessionDelete`,
  `webviewSessionFork`, `webviewSessionRollback`, `webviewSessionToolRespond`,
  and `webviewSessionQuestionRespond`.
- Rust persists session rows/events/transcripts through `pi_store_*` commands.
- Agent tools invoke `pi_agent_tool_execute`; approvals create single-use grants
  through `pi_approval_grant` and are consumed only by Rust.
- Provider HTTP requests are proxied through `ai_http_stream` or
  `ai_http_request` while the agent stream is active.

## Session shape

```ts
type PiSessionStatus = "idle" | "running" | "stopped" | "error";
type PiAuthMode = "terax" | "profile";
type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PiSession = {
  id: string;
  title: string;
  cwd?: string | null;
  status: PiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string | null;
  workspaceEnv?: WorkspaceEnv | null;
  thinkingLevel?: PiThinkingLevel | null;

  // Persisted provider/model metadata. These are non-secret identifiers used to
  // restore or fork the session with the same model context.
  authMode?: PiAuthMode | null;
  providerId?: string | null;
  modelId?: string | null;
  sourceModelId?: string | null;
  baseUrl?: string | null;
  customEndpointId?: string | null;

  // Legacy-compatible nullable field. Webview-native sessions persist their
  // canonical AgentMessage[] transcript under app-data pi-transcripts instead.
  sdkSessionFile?: string | null;

  archivedAt?: string | null;
  forkedFrom?: { parentSessionId: string; forkEventId?: string | null } | null;
};
```

## Events

Events are persisted in `pi-sessions.json` and emitted live to the UI through
Tauri's `pi:session-event` event. The canonical agent transcript is persisted
separately because the UI event log can be capped or rewritten by rollback.

```ts
type PiSessionEvent = {
  id: string;
  type:
    | "session.created"
    | "session.resumed"
    | "session.input"
    | "session.progress"
    | "session.reasoning.delta"
    | "session.reasoning.text"
    | "session.output.delta"
    | "session.output.text"
    | "session.tool.start"
    | "session.tool.update"
    | "session.tool.approval.requested"
    | "session.tool.approval.responded"
    | "session.tool.result"
    | "session.status"
    | "session.renamed"
    | "session.deleted"
    | "session.archived"
    | "session.restored"
    | "session.forked"
    | "session.rollback"
    | "session.usage"
    | "session.turn_diff"
    | "session.question.asked"
    | "session.question.responded"
    | "session.error";
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
};
```

## Prompt context

Pi uses two cwd concepts:

1. Session `cwd`: stable workspace root for native tool authorization.
2. Prompt `context`: validated per-turn Terax UI state for answering questions
   like "where am I?".

```ts
type PiPromptContext = {
  workspaceRoot?: string;
  activeTerminalCwd?: string;
  activeFile?: string;
  activeTerminalPrivate?: boolean;
};
```

When present, the webview prepends this to the SDK prompt as an internal
`<env>` block. The persisted visible user prompt remains unchanged.

## Provider config

```ts
type PiProviderRuntimeConfig = {
  authMode: "terax" | "profile";
  provider: string;
  modelId: string;
  sourceModelId?: string;
  baseUrl?: string;
  customEndpointId?: string;
  thinkingLevel?: PiThinkingLevel;
};
```

Session creation persists non-secret provider/model metadata from this config.
Runtime API keys are fetched only when needed via Rust/keyring (`pi_env_api_key`)
and are never written to session history.

## Session operations

### `webviewSessionCreate(title?, cwd?, providerConfig?)`

Creates an idle session row, records provider/model metadata, creates an
in-memory Agent, persists `session.created`, and stores the initial transcript.
When `providerConfig` is omitted, the fallback provider is Anthropic Sonnet for
legacy callers; normal UI creation should pass an explicit runtime config.

### `webviewSessionSend(sessionId, prompt, context?, options?)`

Accepts the prompt, emits `session.input` and `running` status, then streams
progress/reasoning/output/tool/status/error events while `Agent.prompt()` runs.
The webview persists events incrementally and persists the canonical transcript
after the turn settles. `options.regenerateBranchGroupId` records alternate
branches for the same user turn; `options.thinkingLevel` applies to the next
model call.

### `webviewSessionResume(sessionId, providerConfig?)`

Rehydrates an in-memory Agent from the stored transcript. If no explicit config
is supplied, it uses the provider/model metadata persisted on the session. Resume
emits `session.resumed` and leaves expired approvals non-actionable.

### `webviewSessionStop(sessionId)`

Aborts the active run. If the session can continue, it returns to `idle`; if it
is already idle/stopped, it is marked `stopped` as appropriate. Rust-side
approval state for the session is forgotten through `pi_agent_session_forget`.

### `webviewSessionRename(sessionId, title)`

Updates session metadata and emits `session.renamed`. Empty titles and newline
bearing titles should be rejected by callers before persistence.

### `webviewSessionDelete(sessionId)` / `webviewSessionDeleteWithArtifacts(sessionId)`

Deletes the session row/events, removes the persisted transcript, forgets approval
state, and optionally deletes app-owned artifacts associated with the Pi session.

### `webviewSessionFork(parentSessionId, forkEventId?, title?)`

Delegates event-history forking to Rust, then reconstructs and stores a canonical
transcript for the new fork so it can run independently.

### `webviewSessionRollback(sessionId, rollbackEventId)`

Asks Rust to truncate events after a chosen point, then rebuilds the canonical
transcript from the remaining event log and rehydrates the in-memory Agent.

### `webviewSessionToolRespond(sessionId, toolCallId, approved)`

Records an approval/denial response event for the UI. Approval also grants the
matching Rust capability with `pi_approval_grant`; execution still happens only
when the agent tool calls `pi_agent_tool_execute`. Denial does not create a grant
and therefore cannot execute the requested shell/mutation.

### `webviewSessionQuestionRespond(sessionId, questionId, answers)`

Resolves an interactive `ask_question` tool request in the webview and persists a
`session.question.responded` event.

## Native command boundaries

### Persistence

- `pi_store_record_session({ session, events })`
- `pi_store_record_events({ events })`
- `pi_store_record_transcript({ sessionId, transcript })`
- `pi_store_load_transcript({ sessionId })`
- `pi_store_delete_transcript({ sessionId })`

Rust validates transcript JSON, bounds transcript size, sanitizes transcript file
names, writes atomically, and keeps transcript blobs under the app-data
`pi-transcripts` directory.

### Tools and approvals

- `pi_agent_tool_execute({ request })`
- `pi_approval_grant({ sessionId, toolCallId, toolName })`
- `pi_agent_session_forget({ sessionId })`
- `pi_agent_tool_audit()`

`pi_agent_tool_execute` is the security boundary. It verifies session/workspace,
policy, sensitive paths, MCP visibility, and approval grants before executing.
Ask-level approvals are single-use.

### Provider/network

- `pi_env_api_key({ provider, customEndpointId? })`
- `pi_models_list({ profileAgentDir? })`
- `ai_http_stream(...)`
- `ai_http_request(...)`

The HTTP proxy must preserve request semantics that provider SDKs rely on,
including form-encoded `URLSearchParams` bodies and abort behavior.

## Error handling expectations

- Missing session ids reject the operation and should surface as a Pi session
  error, not as a silent no-op.
- Denied or missing approval grants must not execute shell/mutation tools.
- Transcript load/parse failures fall back to event-log reconstruction when
  possible and should emit actionable errors when the session cannot continue.
- Provider key/profile/custom endpoint failures should point users to settings
  without exposing secret values.
