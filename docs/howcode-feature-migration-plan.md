# Howcode Feature Migration Plan, State of the Art for Terax-Pi

**Target**: Integrate state-of-the-art howcode features into terax-pi.

**Date**: 2026-06-10  
**Version**: 2.0 (comprehensive)

> Status 2026-07-07: historical comparison only. Some Terax architecture diagrams and sidecar references below predate the deleted Node Pi sidecar and the current webview-native runtime. Check `docs/pi-runtime.md` and `docs/pi-sidebar-release-readiness.md` before using any Pi-specific section as implementation guidance.

---

## Architecture Comparison

```
howcode (Electron):
  ┌──────────────────────────────────────┐
  │ Renderer (React 19)                  │
  │   contextBridge API (piDesktop)      │
  │   @howcode/* path aliases            │
  ├──────────────────────────────────────┤
  │ Electron Main Process                │
  │   IPC handlers (50+ channels)        │
  │   DesktopAction router (60 actions)  │
  │   Spawns:                            │
  │   ├── Desktop Service (Node.js)      │
  │   │   ├─ Thread/SQLite/Git           │
  │   │   ├─ Dictation (sherpa-onnx)     │
  │   │   ├─ Terminal (node-pty)         │
  │   │   └─ Pi Packages/Skills          │
  │   └── Runtime Host Workers           │
  │       (per-session Pi child proc)    │
  └──────────────────────────────────────┘

terax-pi (Tauri 2) — CURRENT:
  ┌──────────────────────────────────────────┐
  │ Webview (React 19)                       │
  │   Pi SDK runs HERE (webview bridge)      │
  │   Direct Tauri IPC invoke()              │
  │   @/* path aliases                       │
  ├──────────────────────────────────────────┤
  │ Rust (Tauri 2)                           │
  │   All OS access (pty, fs, git, secrets)  │
  │   Pi Host Node.js sidecar (JSON-RPC)     │
  │   Agent detection (OSC 133/777 parsing)  │
  │   MCP tool bridge                        │
  │   Artifact compiler (hand-written)       │
  └──────────────────────────────────────────┘
```

**Architecture advantage**: terax-pi's webview bridge already eliminates howcode's dependency on per-session Node.js runtime hosts for the Pi SDK. Keep this architecture — it is the SOTA approach.

---

## Feature Gap Matrix

| Feature | howcode | terax-pi | Priority |
|---|---|---|---|
| AI Composer (Pi) | Full queue + thinking levels + streaming behaviors | Basic send-or-block, no queue | **P0** |
| React Artifact Compiler | esbuild + real React runtime | Custom Rust parser + 80-line runtime | **P0** |
| Pi TUI Mode | Full-screen terminal takeover | Basic agent detection, no TUI mode | **P0** |
| Git Worktrees | 8 actions, SQLite persistence, project virtualization | None | **P1** |
| Voice Input | sherpa-onnx, local, 3 Whisper models | Listed as shipped, check scope | **P1** |
| Optimistic UI | React Query cache patching before backend confirm | None | **P1** |
| Thread Inbox | Reply suppression, inbox turns, unread tracking | Module exists, audit depth | **P2** |
| Diff Streaming | Multi-baseline, streaming events, image diff | Basic git diff, no streaming | **P2** |
| Desktop Actions | 60 typed actions, centralized router, per-domain handlers | Tauri commands (90+) but no unified action layer | **P2** |
| Skill Creator | AI-guided interactive session, separate runtime | Skill resolution only, no creator | **P2** |
| Native Extensions | Plugin system (askQuestions, smartBtw) | MCP tools (more general) | **P3** |
| Session Tree | Filtered tree navigation of Pi conversation | Not present | **P3** |
| Event System | pub/sub with 11 event types | Tauri events (pi:session-event) | **P3** |

---

## Phase 1: React Artifact Compiler Upgrade (P0)

### Current State

terax-pi has a hand-written Rust JSX parser (1184 lines in `react.rs`) that transforms JSX to `h()` calls, bundled with a custom ~80-line React-compatible runtime (`react_preview_runtime.js`). Artifacts are stored on the filesystem under `<app_data>/artifacts/`.

howcode uses **esbuild bundled at runtime** in a Node.js process, compiling to real React components running in an Electron preview context.

### SOTA Design

**Keep** terax-pi's Rust parser (zero external dependencies, runs in Tauri's thread pool, no Node.js required).  
**Replace** the custom runtime with real React.  
**Add** howcode's source normalization.  
**Add** howcode's strict import blocking.

### Implementation Steps

#### 1.1 Real React Preview Runtime

**File**: `src-tauri/src/modules/artifacts/react_preview_runtime.js`

Replace the ~80-line custom runtime with a bundled React 19 UMD:

```javascript
// Generated at build time via esbuild/rollup bundling React into a single file
// Kept: mount script (render(), scheduleRender(), queueMicrotask)
// Kept: network-disabled guards (fetch=reject, XMLHttpRequest=undefined)
// Kept: error bridge (postMessage for runtime errors)
// Added: real React.createElement, useState, useEffect, Suspense, etc.
```

**Build integration**: Add a `build:artifact-runtime` script that bundles `react`, `react-dom`, `scheduler` into a single UMD file at build time. The bundled runtime becomes part of the Tauri binary resources.

**Why real React matters**: 
- Suspense for async artifact loading
- Concurrent rendering for large artifacts
- Correct event delegation, synthetic events
- Third-party React component support
- Hooks work exactly as documented

**Fallback**: If real React can't be bundled due to size constraints, keep the custom runtime for simple artifacts and use real React only for `kind: "react"` artifacts. The custom runtime is 2.5 KB; React UMD is ~130 KB gzipped.

#### 1.2 Source Normalization

**File**: `src-tauri/src/modules/artifacts/react.rs`

Add pre-compilation scan (port from howcode's `normalizeReactArtifactSource`):

```rust
fn normalize_react_source(source: &str) -> String {
    let needs_react_import = !source.contains("import React")
        && !source.contains("import * as React")
        && source.contains("React.");
    let bare_hooks = detect_bare_hooks(source, &["useState", "useEffect", "useCallback",
        "useMemo", "useRef", "useReducer", "useContext", "useLayoutEffect"]);
    
    let mut normalized = String::new();
    if needs_react_import {
        normalized.push_str("import React from 'react';\n");
    }
    if !bare_hooks.is_empty() {
        normalized.push_str(&format!("import {{ {} }} from 'react';\n",
            bare_hooks.join(", ")));
    }
    normalized.push_str(source);
    normalized
}
```

Detection logic: walk the AST for bare identifier references matching known hook names, checking they aren't:
- Already imported via `import { useState }`
- Property access (`obj.useState`)
- Part of a different namespace

#### 1.3 Import Security Hardening

**File**: `src-tauri/src/modules/artifacts/react.rs`

Merge howcode's stricter blocking with terax-pi's existing validation:

```
Current allowlist:  "react", "react/jsx-runtime"
Current blocklist:  @tauri-apps/, http://, https://, file://, node:

Add (match howcode):
  - ALL imports not in allowlist → reject with error message
  - import() dynamic expressions → reject
  - require() calls → reject
  - import.meta references → reject (in non-module context)
```

Error message format (from howcode):
```
"React artifacts cannot import '{specifier}'. Keep artifacts self-contained;
 React is provided by the preview runtime."
```

#### 1.4 Non-React Preview Upgrade

**File**: `src/modules/artifacts/lib/preview.ts` and `ArtifactPreviewFrame.tsx`

terax-pi's `buildArtifactPreviewDocument()` already handles HTML, SVG, Markdown, and text with strict CSP headers. Keep this. Add:

- **HTML**: Strip `<script>` tags with event handlers (`onerror`, `onclick`, etc.) in addition to `<script>` elements
- **SVG**: Also strip `<use>`, `<animate>`, `<set>` elements that can trigger network requests
- **Markdown**: Upgrade the simple parser to use `markdown-it` or `marked` for proper GFM rendering

#### 1.5 Rust Compiler Performance

**File**: `src-tauri/src/modules/artifacts/react.rs`

The hand-written recursive descent parser (556-835 lines) is the bottleneck. Add:

- **Source caching**: SHA-256 hash of source → skip recompilation if unchanged
- **Compilation timeout**: 500ms max, report timeout as a diagnostic
- **Partial compilation**: If compilation fails mid-stream, report diagnostics for as many lines as possible (not just the first error)

### Acceptance Criteria

| Test | How |
|---|---|
| Bare `useState(0)` compiles without import | Source normalization injects hooks |
| React 19 `use()` hook works | Real React runtime supports it |
| Importing `fs` / `path` / `axios` fails | Security validation blocks |
| `import()` expression fails | Dynamic import blocked |
| Suspense + lazy() render correctly | Real React for non-trivial artifacts |
| CSS stays scoped | Existing `[data-terax-artifact-scope]` prepending preserved |
| 200KB source compile < 500ms | Rust parser vs esbuild benchmark |
| Empty source returns specific error | `Error::invalid_input` |

---

## Phase 2: Composer Queue System (P0)

### Current State

terax-pi's Pi composer:
- `sendToSession()` throws `SESSION_BUSY` if session is running
- UI `isBusy` boolean lock — no queuing
- `queuedPrompts: PiComposerQueuedPrompt[]` type exists, always `[]`

howcode's queue:
- Prompts submit while streaming → `session.steer(text)` or `session.followUp(text)`
- Queue lives inside Pi SDK's `AgentSession` as two arrays
- `queueSnapshotKey = JSON.stringify([steering[], followUp[]])` for optimistic concurrency
- Dequeue: `clearQueue()` → remove one → `replayComposerQueue()`
- UI: `QueuedPromptsCard` with inline edit/remove per prompt

### SOTA Design

**Protocol change**: Remove `SESSION_BUSY` rejection. When session is running, `sendToSession` detects streaming and calls `session.followUp()` or `session.steer()` depending on `streamingBehavior` parameter.

**New protocol methods**: `sessions.queue` (read), `sessions.dequeue` (remove + replay).

**Backend**: Rust proxies via JSON-RPC, no new state needed (queue lives in SDK).

**Frontend**: Populate `queuedPrompts` from live session data, build `QueuedPromptsCard`.

### Implementation Steps

#### 2.1 Extend Pi Host Protocol

**File**: `sidecars/pi-host/protocol-schema.js`

Add two method schemas:

```javascript
"sessions.queue": methodParams(
  { sessionId: stringParam({ minLength: 1 }) },
  ["sessionId"],
),

"sessions.dequeue": methodParams(
  {
    sessionId: stringParam({ minLength: 1 }),
    mode: stringParam({ enum: ["steer", "followUp"] }),
    queueIndex: integerParam({ minimum: 0 }),
    queueSnapshotKey: stringParam({ minLength: 1 }),
  },
  ["sessionId", "mode", "queueIndex", "queueSnapshotKey"],
),
```

**File**: `sidecars/pi-host/sessions.js`

Three changes:

**a)** Modify `sendToSession()` (lines 670-740) to handle streaming:

```javascript
// Before assertSendableSession, detect streaming
const session = findSession(sessionId);
if (session.status === "running") {
  // Queue the prompt instead of rejecting
  const streamingBehavior = options.streamingBehavior ?? "followUp";
  if (streamingBehavior === "followUp") {
    await session.agentSession.followUp(prompt);
  } else {
    await session.agentSession.steer(prompt);
  }
  return { accepted: true, queued: true, session: sessionSnapshot(session), events: [] };
}
// Existing idle path continues unchanged...
```

**b)** Add `queueSession()` handler:

```javascript
async function queueSession(params) {
  const session = findSession(params.sessionId);
  return {
    steering: [...session.agentSession.getSteeringMessages()],
    followUp: [...session.agentSession.getFollowUpMessages()],
  };
}
```

**c)** Add `dequeueSession()` handler (port of howcode's `dequeueComposerPromptFromRuntime`):

```javascript
async function dequeueSession(params) {
  const session = findSession(params.sessionId);
  const currentQueue = {
    steering: [...session.agentSession.getSteeringMessages()],
    followUp: [...session.agentSession.getFollowUpMessages()],
  };
  const currentKey = JSON.stringify([currentQueue.steering, currentQueue.followUp]);
  
  // Optimistic concurrency check
  if (currentKey !== params.queueSnapshotKey) {
    return { raceDetected: true, queue: currentQueue };  // UI must refresh
  }
  
  // Atomically clear and replay
  const cleared = session.agentSession.clearQueue();
  const targetArray = params.mode === "steer" ? cleared.steering : cleared.followUp;
  const removedText = targetArray.splice(params.queueIndex, 1)[0];
  
  // Replay remaining
  const modifiedQueue = { steering: cleared.steering, followUp: cleared.followUp };
  for (const text of modifiedQueue.steering) {
    await session.agentSession.steer(text);
  }
  for (const text of modifiedQueue.followUp) {
    await session.agentSession.followUp(text);
  }
  
  return { dequeuedText: removedText, queue: modifiedQueue };
}
```

**File**: `sidecars/pi-host/protocol.js`

Register in the dispatch switch:
```javascript
case "sessions.queue":
  return { response: successResponse(request.id, queueSession(params)), shutdown: false };
case "sessions.dequeue":
  return { response: await sessionResponse(request.id, dequeueSession, params), shutdown: false };
```

#### 2.2 Add Tauri Proxy Commands

**File**: `src-tauri/src/modules/pi/host.rs`

Add `session_queue` and `session_dequeue` methods following the existing pattern:

```rust
pub async fn session_queue(&self, session_id: &str) -> Result<Value, PiCommandError> {
    self.call_json("sessions.queue", serde_json::json!({ "sessionId": session_id })).await
}

pub async fn session_dequeue(
    &self, session_id: &str, mode: &str, queue_index: u32, queue_snapshot_key: &str,
) -> Result<Value, PiCommandError> {
    self.call_json("sessions.dequeue", serde_json::json!({
        "sessionId": session_id,
        "mode": mode,
        "queueIndex": queue_index,
        "queueSnapshotKey": queue_snapshot_key,
    })).await
}
```

**File**: `src-tauri/src/modules/pi/mod.rs`

Add Tauri commands:
```rust
#[tauri::command]
async fn pi_session_queue(state: State<'_, PiState>, session_id: String) -> Result<Value, String> {
    let host = state.host_handle().map_err(|e| e.to_string())?;
    host.session_queue(&session_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pi_session_dequeue(
    state: State<'_, PiState>,
    session_id: String, mode: String, queue_index: u32, queue_snapshot_key: String,
) -> Result<Value, String> {
    let host = state.host_handle().map_err(|e| e.to_string())?;
    host.session_dequeue(&session_id, &mode, queue_index, &queue_snapshot_key)
        .await.map_err(|e| e.to_string())
}
```

**File**: `src-tauri/capabilities/default.json`

Add `pi:session-queue-update` to allowed Tauri events (for real-time queue state push).

#### 2.3 Update Frontend Bridge

**File**: `src/modules/pi/bridge/pi-session.ts`

```typescript
export async function sessionQueue(sessionId: string): Promise<{
  steering: string[];
  followUp: string[];
}> {
  return invoke("pi_session_queue", { sessionId });
}

export async function sessionDequeue(
  sessionId: string,
  mode: "steer" | "followUp",
  queueIndex: number,
  queueSnapshotKey: string,
): Promise<{
  dequeuedText: string | null;
  queue: { steering: string[]; followUp: string[] } | null;
  raceDetected?: boolean;
}> {
  return invoke("pi_session_dequeue", {
    sessionId, mode, queueIndex, queueSnapshotKey,
  });
}
```

Update `sessionSend()` signature:
```typescript
export async function sessionSend(
  sessionId: string,
  prompt: string,
  context?: PromptContext,
  opts?: { streamingBehavior?: "steer" | "followUp"; thinkingLevel?: string },
): Promise<SessionSendResult> { ... }
```

#### 2.4 Populate Queue State

**File**: `src/modules/pi/lib/panel-state.ts`

In `buildPiPanelState()`, replace the empty `queuedPrompts: []` with live data:

```typescript
// Session event stream provides queue deltas
// Also poll on session status === "running"
queuedPrompts: session.status === "running" || session.queuedPromptCount > 0
  ? await getSessionBackend().sessionQueue(session.id).then(
      (q) => buildQueuedPrompts(q.steering, q.followUp),
      () => [],
    )
  : [],
```

`buildQueuedPrompts()`:
```typescript
function buildQueuedPrompts(
  steering: string[], followUp: string[],
): PiComposerQueuedPrompt[] {
  const prompts: PiComposerQueuedPrompt[] = [];
  for (let i = 0; i < steering.length; i++) {
    prompts.push({
      id: `steer:${i}`,
      mode: "steer",
      queueIndex: i,
      text: steering[i],
    });
  }
  for (let i = 0; i < followUp.length; i++) {
    prompts.push({
      id: `follow-up:${i}`,
      mode: "follow-up",
      queueIndex: i,
      text: followUp[i],
    });
  }
  return prompts;
}
```

Compute `queueSnapshotKey`:
```typescript
function buildQueueSnapshotKey(steering: string[], followUp: string[]): string {
  return JSON.stringify([steering, followUp]);
}
```

#### 2.5 Build QueuedPromptsCard Component

**New file**: `src/modules/pi/components/PiQueuedPromptsCard.tsx`

```tsx
type Props = {
  prompts: PiComposerQueuedPrompt[];
  onRemove: (id: string, mode: QueueMode, queueIndex: number) => void;
  pendingPromptIds: Set<string>;
};

function PiQueuedPromptsCard({ prompts, onRemove, pendingPromptIds }: Props) {
  if (prompts.length === 0) return null;
  
  return (
    <div className="rounded-lg border p-2 space-y-1">
      <div className="text-xs text-muted-foreground px-1">
        Queued prompts ({prompts.length})
      </div>
      {prompts.map((prompt) => (
        <div key={prompt.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/50 group">
          <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">
            {prompt.mode === "steer" ? "REPLACE" : "APPEND"}
          </span>
          <span className="text-sm truncate flex-1">{prompt.text}</span>
          <button
            onClick={() => onRemove(prompt.id, prompt.mode, prompt.queueIndex)}
            disabled={pendingPromptIds.has(prompt.id)}
            className="opacity-0 group-hover:opacity-100 disabled:opacity-30 size-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
            aria-label="Remove queued prompt"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

Integration in `PiPanel.tsx`:
```tsx
{composerState.queuedPrompts.length > 0 && (
  <PiQueuedPromptsCard
    prompts={composerState.queuedPrompts}
    onRemove={dequeuePrompt}
    pendingPromptIds={pendingDequeueIds}
  />
)}
```

#### 2.6 Update PiPanel Send/Dequeue

**File**: `src/modules/pi/PiPanel.tsx`

Update `sendPrompt` to queue when running:

```typescript
const sendPrompt = useCallback(async (event) => {
  event.preventDefault();
  const text = prompt.trim();
  if (!text || selectedSession === null) return;

  await runPiPanelAction(async () => {
    const result = await getSessionBackend().sessionSend(
      selectedSession.id, text, promptContext,
      {
        streamingBehavior: selectedSession.status === "running" ? "followUp" : undefined,
        thinkingLevel: activeThinkingLevel,
      },
    );
    applySessionUpdate(result.session, result.events);
    setPrompt("");
  });
}, [...]);
```

Add `dequeuePrompt` handler:

```typescript
const dequeuePrompt = useCallback(async (
  queueId: string, mode: QueueMode, queueIndex: number,
) => {
  if (selectedSession === null) return;
  setPendingDequeueIds((prev) => new Set(prev).add(queueId));
  try {
    const result = await getSessionBackend().sessionDequeue(
      selectedSession.id, mode, queueIndex, queueSnapshotKey,
    );
    if (result.raceDetected) {
      // Queue changed since snapshot — force full refresh
      refreshPanel();
    } else if (result.dequeuedText) {
      // Restore dequeued text into draft
      setPrompt((prev) => {
        if (!prev.trim()) return result.dequeuedText!;
        return `${prev}\n\n${result.dequeuedText}`;
      });
    }
  } finally {
    setPendingDequeueIds((prev) => { const n = new Set(prev); n.delete(queueId); return n; });
  }
}, [selectedSession, queueSnapshotKey]);
```

#### 2.7 Event-Driven Queue Updates

Add a `pi:session-queue-update` Tauri event that fires when the queue changes on the sidecar side (not just from client actions). The PiPanel subscribes:

```typescript
useEffect(() => {
  if (!runtimeReady || !selectedSession) return;
  const unlisten = listen<SessionQueue>("pi:session-queue-update", (event) => {
    if (event.payload.sessionId === selectedSession.id) {
      refreshQueueState(event.payload.queue);
    }
  });
  return () => { unlisten.then((fn) => fn()); };
}, [runtimeReady, selectedSession]);
```

### Acceptance Criteria

| Test | How |
|---|---|
| Send while idle → immediate execution | Existing path unchanged |
| Send while streaming → prompt queued | `session.followUp()` called |
| Queued prompts visible in UI | `PiQueuedPromptsCard` renders |
| Remove queued prompt → queue replayed | `clearQueue()` + replay with splice |
| Concurrent dequeue detection | `queueSnapshotKey` mismatch → UI refresh |
| Queue persists across panel toggle | Queue lives in SDK, not UI state |
| Queue survives session resume | SDK reconstructs from session file |
| Queue cleared when session stopped | `stopSession` clears SDK queue |

---

## Phase 3: Pi TUI Tab (P0)

### Current State

terax-pi detects Pi agents in the PTY output stream via a Rust state machine parsing OSC 133/777 sequences. It emits `terax:agent-signal` events with status transitions (started/working/attention/finished/exited). There is no dedicated Pi TUI view — agents are detected but the user interacts through the standard PiPanel (sidebar chat).

howcode has a "takeover" mode where the entire workspace is replaced by a full-screen terminal running the Pi session, with TUI session detection and thread binding.

### SOTA Design

Add a dedicated **Pi TUI tab kind** to terax-pi's tab system. When a Pi agent is detected in a terminal, offer to open a Pi TUI tab. The Pi TUI tab reuses the existing PTY infrastructure but is connected to the Pi session's TUI event stream.

This approach is **better than howcode** because:
- Pi TUI is one tab among many (not a full workspace takeover)
- Same mechanism can extend to Claude Code, Codex, etc.
- Reuses existing PTY, tab, and notification systems
- Progressive disclosure: notification → tab switch → optional fullscreen

### Implementation Steps

#### 3.1 Add pi-tui Tab Kind

**File**: `src/modules/tabs/lib/types.ts`

Add to the `TabKind` union:
```typescript
type TabKind =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab
  | PiWorkspaceTab
  | ArtifactWorkspaceTab
  | ArtifactHubTab
  | WorkflowTab
  | PiTuiTab;  // NEW
```

```typescript
interface PiTuiTab {
  kind: "pi-tui";
  id: string;
  title: string;
  sessionId: string;
  cwd: string | null;
  createdAt: number;
}
```

#### 3.2 Build PiTuiTab Component

**New file**: `src/modules/pi/components/PiTuiTab.tsx`

```typescript
type PiTuiTabProps = {
  tab: PiTuiTab;
};

function PiTuiTab({ tab }: PiTuiTabProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  
  useEffect(() => {
    // 1. Subscribe to Pi session events for this sessionId
    // 2. Route TUI output to xterm.js instance
    // 3. Route user input back to Pi session via pi-host
    
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      allowTransparency: true,
      theme: { background: "transparent" },
    });
    
    term.open(terminalRef.current!);
    
    // Subscribe to Pi session output events
    const unlisten = listen<PiSessionTuiEvent>("pi:session-tui-output", (event) => {
      if (event.payload.sessionId === tab.sessionId) {
        term.write(event.payload.data);
      }
    });
    
    // Route user input back to Pi session
    term.onData((data) => {
      invoke("pi_session_tui_input", {
        sessionId: tab.sessionId,
        data,
      });
    });
    
    return () => {
      term.dispose();
      unlisten.then((fn) => fn());
    };
  }, [tab.sessionId]);
  
  return (
    <div ref={terminalRef} className="h-full w-full bg-transparent" />
  );
}
```

**Key difference from regular terminal tabs**: Instead of opening a PTY subprocess, the Pi TUI tab:
1. Subscribes to `pi:session-tui-output` Tauri events (streamed from the pi-host sidecar)
2. Sends user input via `pi_session_tui_input` Tauri command (proxied to the sidecar)
3. The sidecar's `@earendil-works/pi-tui` library handles all rendering

#### 3.3 Extend Pi-Host for TUI Streaming

**File**: `sidecars/pi-host/protocol-schema.js`

Add:
```javascript
"sessions.tui.subscribe": methodParams(
  { sessionId: stringParam({ minLength: 1 }) },
  ["sessionId"],
),
"sessions.tui.input": methodParams(
  { sessionId: stringParam({ minLength: 1 }), data: stringParam() },
  ["sessionId", "data"],
),
"sessions.tui.unsubscribe": methodParams(
  { sessionId: stringParam({ minLength: 1 }) },
  ["sessionId"],
),
```

**File**: `sidecars/pi-host/sessions.js`

```javascript
const tuiSubscriptions = new Map();

async function subscribeSessionTui(params) {
  const session = findSession(params.sessionId);
  // Subscribe to TUI output events from the Pi SDK
  // The @earendil-works/pi-tui library provides a stream
  const unsubscribe = session.agentSession.onTuiOutput((data) => {
    publishEvent("session.tui.output", session.id, { data });
  });
  tuiSubscriptions.set(session.id, unsubscribe);
  return { subscribed: true };
}

async function inputSessionTui(params) {
  const session = findSession(params.sessionId);
  session.agentSession.sendTuiInput(params.data);
  return { sent: true };
}

async function unsubscribeSessionTui(params) {
  const unsubscribe = tuiSubscriptions.get(params.sessionId);
  if (unsubscribe) {
    unsubscribe();
    tuiSubscriptions.delete(params.sessionId);
  }
  return { unsubscribed: true };
}
```

The Rust side (`host.rs`, `mod.rs`) proxies these like other session methods, with the TUI output forwarded as a `pi:session-tui-output` Tauri event.

#### 3.4 Wire Agent Detection → TUI Tab

**File**: `src-tauri/src/modules/pty/agent_detect.rs`

When `"pi"` agent starts (OSC 133;C;pi ...), include a hint that Pi has TUI support:

```rust
Transition::Started {
    agent: "pi".to_string(),
    supports_tui: true,  // NEW field
}
```

**File**: `src/modules/agents/store/agentStore.ts`

Add `TUI-capable` tracking:
```typescript
type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: 'working' | 'waiting' | 'attention';
  supportsTui: boolean;  // NEW
  piSessionId?: string;   // NEW: linked Pi session ID
  // ...
};
```

**File**: `src/modules/pi/components/PiTuiTabManager.tsx` (new)

Watches for Pi agent detections and auto-offers TUI tab:

```typescript
function PiTuiTabManager() {
  const { sessions, piSessions } = useAgentStore();
  const { openTab, focusTab } = useTabs();
  const [offeredTui, setOfferedTui] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    for (const session of Object.values(sessions)) {
      if (session.agent === "pi"
          && session.supportsTui
          && session.piSessionId
          && !offeredTui.has(session.piSessionId)) {
        setOfferedTui((prev) => new Set(prev).add(session.piSessionId!));
        
        if (settings.piTuiAutoOpen) {
          // Auto-open TUI tab
          const tabId = openPiTuiTab(session.piSessionId, session.cwd);
          focusTab(tabId);
        } else {
          // Show notification with "Open Pi TUI" action
          showTuiNotification(session.piSessionId);
        }
      }
    }
  }, [sessions, piSessions]);
  
  return null;  // Side-effect only
}
```

#### 3.5 Add TUI Tab to App.tsx

**File**: `src/app/App.tsx`

In the tab rendering switch, add:
```typescript
case "pi-tui":
  return <PiTuiTab tab={tab as PiTuiTab} />;
```

#### 3.6 "Open in TUI" Action

**File**: `src/modules/pi/components/PiComposer.tsx`

When Pi session is running and supports TUI, show a toolbar button:

```typescript
{session.supportsTui && session.status === "running" && (
  <ToolbarButton
    label="TUI"
    tooltip="Open Pi TUI tab"
    icon={<PiLogoMark className="size-3.5" />}
    onClick={() => openPiTuiTab(session.id, session.cwd)}
  />
)}
```

**File**: `src/app/App.tsx` or `src/modules/pi/lib/tuiTab.ts`

```typescript
function openPiTuiTab(sessionId: string, cwd: string | null): string {
  const tabId = createId();
  const tab: PiTuiTab = {
    kind: "pi-tui",
    id: tabId,
    title: "Pi TUI",
    sessionId,
    cwd,
    createdAt: Date.now(),
  };
  openTab(tab);
  return tabId;
}
```

#### 3.7 TUI Session Lifecycle

```
Pi agent detected in terminal:
  → AgentDetector emits Transition::Started { agent: "pi", supportsTui: true }
  → PiTuiTabManager creates TUI tab or shows notification
  → TUI tab subscribes to pi:session-tui-output events

User types in TUI tab:
  → onData → pi_session_tui_input → pi-host → Pi SDK input

Pi session ends:
  → AgentDetector emits Transition::Finished
  → TUI tab shows "Session complete"
  → Tab can be closed or kept for history review

Tab closed:
  → pi_session_tui_unsubscribe → cleanup sidecar subscription
  → Tab removed from stack
```

### Acceptance Criteria

| Test | How |
|---|---|
| Pi agent detected in terminal → TUI tab offered | Agent detection → notification |
| Auto-open mode creates TUI tab | Setting `piTuiAutoOpen = true` |
| User input in TUI tab reaches Pi session | `onData` → `pi_session_tui_input` → sidecar |
| Pi output renders in TUI tab | `pi:session-tui-output` → xterm.write() |
| Tab close cleans up sidecar subscription | `pi_session_tui_unsubscribe` called |
| TUI tab survives panel collapse | Tab not tied to sidebar |
| Multiple Pi sessions → multiple TUI tabs | Each has unique sessionId |

---

## Phase 4: Git Worktrees (P1)

### Current State

terax-pi has full Git support (`status`, `diff`, `stage`, `unstage`, `commit`, `fetch`, `pull`, `push`, `log`, `show_commit`, `commit_files`, `commit_file_diff`, `panel_snapshot`, `resolve_repo`, `remote_url`). No worktree support.

howcode has a complete worktree system: create, remove, merge, complete/incomplete tracking, directory configuration, 8 desktop actions, SQLite persistence, and sidebar visualization with thread bucketing.

### Implementation Steps

#### 4.1 Rust Git Worktree Commands

**New file**: `src-tauri/src/modules/git/worktrees.rs`

```rust
#[tauri::command]
async fn git_worktree_list(project_path: String) -> Result<Vec<GitWorktree>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&project_path)
        .output()
        .await
        .map_err(|e| format!("git worktree list failed: {}", e))?;
    parse_git_worktree_porcelain(&String::from_utf8_lossy(&output.stdout))
}

#[tauri::command]
async fn git_worktree_create(
    project_path: String,
    branch: String,
    target_path: String,
    new_branch: bool,
) -> Result<GitWorktreeCreateResult, String> {
    let mut args = vec!["worktree", "add"];
    if new_branch {
        args.push("-b");
    }
    args.push(&target_path);
    args.push(&branch);
    
    let output = Command::new("git")
        .args(&args)
        .current_dir(&project_path)
        .output()
        .await
        .map_err(|e| format!("git worktree add failed: {}", e))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    Ok(GitWorktreeCreateResult {
        path: target_path,
        branch,
        new_branch,
    })
}

#[tauri::command]
async fn git_worktree_remove(worktree_path: String) -> Result<(), String> {
    // Must not be the main worktree
    let output = Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(&worktree_path)
        .output()
        .await
        .map_err(|e| format!("git worktree remove failed: {}", e))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}
```

Parse `git worktree list --porcelain` output:
```rust
fn parse_git_worktree_porcelain(output: &str) -> Result<Vec<GitWorktree>, String> {
    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktree> = None;
    
    for line in output.lines() {
        if line.is_empty() {
            if let Some(wt) = current.take() {
                worktrees.push(wt);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            current = Some(GitWorktree { path: path.to_string(), branch: None, head: None, detached: false });
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if let Some(ref mut wt) = current {
                wt.branch = Some(branch.to_string());
            }
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(ref mut wt) = current {
                wt.head = Some(head.to_string());
                wt.detached = true;
            }
        } else if line.starts_with("bare") || line.starts_with("prunable") {
            // Skip info-only lines
        }
    }
    // Flush last
    if let Some(wt) = current {
        worktrees.push(wt);
    }
    Ok(worktrees)
}
```

**File**: `src-tauri/src/modules/git/mod.rs`

Register the new commands alongside existing git commands. Add types:
```rust
#[derive(Serialize, Deserialize)]
struct GitWorktree {
    path: String,
    branch: Option<String>,
    head: Option<String>,
    detached: bool,
}

#[derive(Serialize, Deserialize)]
struct GitWorktreeCreateResult {
    path: String,
    branch: String,
    new_branch: bool,
}
```

#### 4.2 Frontend Worktree UI

**New file**: `src/modules/source-control/components/WorktreePanel.tsx`

```typescript
function WorktreePanel({ projectPath }: { projectPath: string }) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  
  useEffect(() => {
    loadWorktrees();
  }, [projectPath]);
  
  const loadWorktrees = async () => {
    const list = await invoke<GitWorktree[]>("git_worktree_list", { projectPath });
    setWorktrees(list);
  };
  
  const createWorktree = async () => {
    // Dialog: branch name, target path, new/existing branch
    const branch = prompt("Branch name:");
    if (!branch) return;
    const targetPath = prompt("Target path (relative to parent):");
    if (!targetPath) return;
    
    await invoke("git_worktree_create", {
      projectPath,
      branch,
      targetPath: `${path.dirname(projectPath)}/${targetPath}`,
      newBranch: true,
    });
    loadWorktrees();
  };
  
  const removeWorktree = async (path: string) => {
    await invoke("git_worktree_remove", { worktreePath: path });
    loadWorktrees();
  };
  
  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Worktrees</h3>
        <button onClick={createWorktree} className="text-xs ...">+ New</button>
      </div>
      {worktrees.map((wt) => (
        <div key={wt.path} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs">{wt.branch ?? "detached"}</span>
          <span className="text-muted-foreground truncate text-xs">{wt.path}</span>
          {wt.branch && (
            <button onClick={() => removeWorktree(wt.path)} className="text-destructive text-xs">Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}
```

#### 4.3 Thread → Worktree Association (Optional)

For deeper integration, add a `worktree_path` column to the Pi session store (`pi-sessions.json` or a separate mapping file). When a Pi session is created inside a worktree, record the association so sessions can be filtered by worktree.

### Acceptance Criteria

| Test | How |
|---|---|
| `git worktree list --porcelain` parsed correctly | Unit test with sample output |
| Create new branch worktree | `git worktree add -b <branch> <path>` |
| Create existing branch worktree | `git worktree add <path> <branch>` |
| Remove worktree | `git worktree remove <path>` |
| Remove main worktree blocked | Validation error |
| Worktree list includes main | First entry is main repo |

---

## Phase 5: Voice Input (P1)

### Current State

terax-pi roadmap lists "Voice input" as shipped. howcode uses `sherpa-onnx-node` for fully local, offline Whisper-based dictation with 3 model sizes (tiny.en, base.en, small.en), model download from Hugging Face, and fine-grained control.

### Implementation

#### 5.1 Research terax-pi's current voice pipeline

Before implementing: audit what terax-pi already has. Search for voice-related code:

- Check `src/modules/ai/lib/composer.tsx` for voice toggle/transcription
- Check `src/modules/ai/components/` for voice UI
- Check `src-tauri/src/` for native voice commands
- If terax-pi already has streaming transcription working, skip this phase
- If not, or if the existing solution depends on cloud APIs, port howcode's sherpa-onnx approach

#### 5.2 Port sherpa-onnx (if needed)

If the current voice pipeline is cloud-dependent:

1. **Rust native module**: Wrap sherpa-onnx in a Rust crate (`sherpa-onnx-sys` or similar) exposed via Tauri commands:
   - `voice_list_models` → available Whisper variants
   - `voice_install_model` → download from Hugging Face
   - `voice_remove_model` → delete cached model
   - `voice_transcribe` → PCM16 → text

2. **Audio capture**: Webview `MediaRecorder` API → base64 PCM16 → Tauri IPC → Rust → sherpa

3. **Model management**: Follow howcode's `model-management.ts` pattern: download with progress events, atomic install, checksum verification

4. **UI**: Microphone button in composer, model selector in settings, download progress indicator

### Acceptance Criteria

| Test | How |
|---|---|
| Audio captured from microphone | MediaRecorder in webview |
| Transcription returns text | sherpa-onnx processes audio |
| Per-word latency < 2s | Real-time feedback in composer |
| Model download with progress | Tauri event streaming download % |
| Offline operation | No network calls during inference |

---

## Phase 6: Optimistic UI Pattern (P1)

### Current State

howcode's `useDesktopActionHandlers.ts` applies optimistic cache updates for settings, project names, and pin states before the backend confirms. On error, it rolls back.

terax-pi's `PiPanel.tsx` uses a simpler `runPiPanelAction((...) => ...)` pattern that wraps everything in `try/catch` with `isBusy` locking — no optimistic updates.

### Implementation

#### 6.1 Extract Action Infrastructure

**New file**: `src/modules/pi/lib/actions.ts`

```typescript
type Action<TPayload, TResult> = {
  execute: (payload: TPayload) => Promise<TResult>;
  optimistic: (payload: TPayload) => Partial<TResult> | null;
  rollback: (payload: TPayload, previous: unknown) => void;
};
```

For each Pi action (send, stop, rename, delete, etc.), implement the triad:
1. `execute` — the actual Tauri call
2. `optimistic` — apply to Zustand store immediately
3. `rollback` — restore previous state on error

#### 6.2 Apply to Key Actions

**`sessionRename`**:
```typescript
const renameAction: Action<RenamePayload, RenameResult> = {
  execute: (p) => getSessionBackend().sessionRename(p.sessionId, p.title),
  optimistic: (p) => {
    const prev = agentStore.getState().piSessions[p.sessionId];
    agentStore.getState().setPiSession(p.sessionId, { ...prev, title: p.title });
    return { previousTitle: prev?.title };
  },
  rollback: (p, ctx) => {
    agentStore.getState().setPiSession(p.sessionId, {
      ...agentStore.getState().piSessions[p.sessionId],
      title: ctx.previousTitle,
    });
  },
};
```

**`sessionDelete`**:
```typescript
const deleteAction: Action<DeletePayload, DeleteResult> = {
  execute: (p) => getSessionBackend().sessionDelete(p.sessionId),
  optimistic: (p) => {
    const session = agentStore.getState().piSessions[p.sessionId];
    agentStore.getState().removePiSession(p.sessionId);
    return { session }; // for rollback
  },
  rollback: (p, ctx) => {
    agentStore.getState().setPiSession(p.sessionId, ctx.session);
  },
};
```

#### 6.3 Status Bar for Optimistic Ops

**File**: `src/modules/statusbar/components/OperationStatus.tsx`

Show pending optimistic operations in the status bar:
- Green spinner: operation in flight
- Red badge: operation failed, click to retry or revert
- Dim indicator: rollback applied

### Acceptance Criteria

| Test | How |
|---|---|
| Rename session → title updates immediately | Optimistic patch, no flash |
| Rename fails → title reverts | Rollback restores previous |
| Delete session → removed immediately | Optimistic removal |
| Delete fails → session reappears | Rollback restores from cache |

---

## Phase 7: Thread Inbox Audit (P2)

### Current State

howcode has an inbox system with reply suppression, inbox turns, and unread tracking backed by SQLite (`inbox_items`, `inbox_reply_suppressions` tables).

terax-pi has an `inbox/` module. Audit its depth:

### Audit Checklist

- [ ] Does terax-pi have per-thread unread tracking?
- [ ] Does it suppress inbox notifications when the user is actively viewing the thread?
- [ ] Does it group notifications by conversation or flatten them?
- [ ] Does it support "mark all read" and "dismiss"?
- [ ] Does it have reply suppression (don't notify for AI follow-ups to your own prompts)?

If gaps exist, port the relevant SQL schema and logic from howcode's `inbox-writes.ts` and `thread-inbox.ts`.

### Git Diff Streaming Audit (P2)

howcode has a streaming Git diff protocol with multiple baseline types (head, previous, branch, parent-branch, last-opened, commit, main-branch, dev-branch) and image diff support.

terax-pi has:
- `git_diff` — returns complete diff string
- `git_diff_content` — diff against a specific ref
- `git_panel_snapshot` — git status snapshot

**Gap**: No streaming. For large diffs, the entire output is buffered. Add a streaming diff Tauri command using `Channel<String>` for chunked output, following howcode's `ProjectDiffStreamEvent` protocol.

### Desktop Actions Layer (P2)

howcode has a centralized 60-action router (`action-router.ts`) that dispatches to domain handlers (Project, Chat, Thread, Composer, Workspace, Settings, PiSettings).

terax-pi has 90+ Tauri commands but no unified action layer. The action layer solves:
1. **Optimistic UI** — single point to apply/rollback cache updates
2. **Error handling** — consistent error formatting and reporting
3. **Undo** — actions can be reversed if the action type declares an inverse
4. **Telemetry** — single audit point for user actions

If this abstraction is desired, add it on top of the existing Tauri commands (not replacing them).

### Skill Creator (P2)

terax-pi has skill resolution (scan `.pi/skills/` for SKILL.md files) but no creator flow. howcode has a `startSkillCreatorSession(prompt)` that starts an AI-guided session for building a new skill, with separate model selection.

Implementation: Reuse the existing Pi session infrastructure. Add a `pi_skill_creator_start(prompt)` Tauri command that creates a Pi session with a system prompt about skill construction. The session output is a new SKILL.md. Add a "Create Skill" button in the skills panel that opens this guided session.

### Native Extensions (P3)

howcode has a native extension plugin system (askQuestions, smartBtw). terax-pi has MCP tools, which are more general but also more complex.

If specific extension behaviors (like "ask the user a question mid-execution") are needed, they can be implemented as Pi SDK tools rather than a separate extension system. The `NativeAskQuestion` type from howcode maps to the existing Pi tool approval flow.

### Event System (P3)

howcode has 11 event types, a publish-subscribe hub, and desktop event emission. terax-pi has Tauri events (`pi:session-event`, `artifact:*`, `terax:agent-signal`). The Tauri event system is already production-grade — no port needed unless specific event types are missing (e.g., `composer-update` events for queue state changes).

---

## Implementation Order

```
Phase 1: React Artifact Compiler         3-5 days    P0
Phase 2: Composer Queue                  7-10 days   P0
Phase 3: Pi TUI Tab                      5-7 days    P0
├── After Phase 1 & 2: test integration
│
Phase 4: Git Worktrees                   3-5 days    P1
Phase 5: Voice Input                     3-5 days    P1
Phase 6: Optimistic UI                   2-3 days    P1
│
Phase 7: Audit & Polish                  3-5 days    P2
├── Thread Inbox audit
├── Diff streaming audit
├── Desktop actions layer (if needed)
├── Skill creator
```

**Total**: ~26-40 days for full migration

**Recommended sprint plan**:
- Sprint 1: Phase 1 (artifact compiler) + Phase 3 (Pi TUI tab) in parallel
- Sprint 2: Phase 2 (composer queue) — heaviest lift
- Sprint 3: Phase 4 (worktrees) + Phase 6 (optimistic UI)
- Sprint 4: Phase 5 (voice) + Phase 7 (audit & polish)

---

## Testing Strategy

### Unit Tests

| Module | Tool | Target |
|---|---|---|
| Rust artifact compiler | `cargo test` | Parser edge cases, security validation, CSS scoping |
| Rust git worktrees | `cargo test` | Porcelain parsing, create/remove validation |
| Pi host protocol | `vitest` (sidecars/) | Queue/dequeue logic, concurrency detection |
| Frontend queue UI | `vitest` | QueuedPromptsCard rendering, dequeue flow |
| Frontend TUI tab | `vitest` | Tab lifecycle, event subscription cleanup |

### Integration Tests

| Test | Method |
|---|---|
| Artifact compile → preview renders | Tauri command → iframe renders content |
| Queue prompt → dequeue → replay end-to-end | Pi host process → SDK → response |
| TUI tab → input → output roundtrip | Tauri event → xterm — visual inspection |
| Worktree create → list → remove | Git command → Rust parser → verify on filesystem |
| Voice capture → transcribe | MediaRecorder → sherpa-onnx → result matches expected |

### Performance Benchmarks

| Metric | Target | Method |
|---|---|---|
| Artifact compilation (20KB source) | < 200ms | `cargo bench` or `console.time` |
| Queue dequeue latency | < 50ms | `performance.now()` around dequeue call |
| TUI output latency (key → screen) | < 100ms | Visual inspection + dev tools |
| Worktree listing (10 worktrees) | < 500ms | `console.time` around invoke |
| Voice transcription latency | < 2s per utterance | `performance.now()` around transcribe |

### Cross-Platform Validation

| Platform | Test |
|---|---|
| macOS | All 3 phases |
| Linux | Artifact compiler, worktrees, TUI tab |
| Windows | Worktrees (path separator handling), artifact compiler |

---

## Security Review

### Artifact Compiler

| Threat | Mitigation |
|---|---|
| `import()` expression → arbitrary code | Block all dynamic imports |
| `<script>` injection in HTML/SVG artifacts | Strip all script elements and event handlers |
| CSS `url()` → exfiltration | CSP `img-src data: blob:` only, no external URLs |
| React preview DOM access | Sandboxed iframe, no `allow-same-origin` |

### Pi TUI Tab

| Threat | Mitigation |
|---|---|
| TUI output from compromised Pi SDK | Output streamed through pi-host, sandboxed |
| Keystroke injection | Input validated at Rust layer, length-limited |
| Session replay attack | TUI tab bound to specific sessionId, no cross-session access |

### Composer Queue

| Threat | Mitigation |
|---|---|
| Dequeue race condition | `queueSnapshotKey` optimistic concurrency |
| Queue overflow | Server-side `MAX_QUEUED_PROMPTS` limit (e.g., 20) |
| Prompt injection via dequeued text | Text restored into draft, not auto-sent |

---

## Appendix: Key File Reference

### howcode (source of truth per feature)

| Feature | Primary File | Supporting Files |
|---|---|---|
| Artifact Compiler | `desktop/artifact-compiler.ts` (108 lines) | `desktop/artifact-state-db.ts` (317), `shared/desktop-artifact-contracts.ts` |
| Composer Queue | `desktop/runtime/composer-queue.ts` (105) | `desktop/runtime/composer-dequeue.ts` (102), `desktop/runtime/composer-state.ts` (309), `desktop/pi-threads/composer-actions.ts` (198) |
| Queue UI | `src/app/composer/queued-prompts-card.tsx` (74) | `src/app/composer/composer-queue.helpers.ts` (23), `src/app/composer/composer-submission-runner.ts` (222) |
| Pi TUI Takeover | `desktop/terminal/manager.ts` (524 — TUI detection) | `src/app/state/workspace.ts` (takeoverVisible), `src/app/workspace-shell/terminal-panel.tsx` (mode="takeover") |
| Worktrees | `desktop/project-git/worktrees.ts` (228) | `desktop/project-git/worktree-snapshot.ts` (67), `desktop/thread-state-db/worktree-writes.ts` (93) |
| Voice | `desktop/dictation/sherpa-runtime.ts` (187) | `desktop/dictation/sherpa-onnx.ts`, `desktop/dictation/model-management.ts` |
| Thread Inbox | `desktop/thread-state-db/inbox-writes.ts` | `shared/thread-inbox.ts` |
| Actions Router | `desktop/pi-threads/action-router.ts` (38) | `shared/desktop-actions.ts` (62), `src/app/app-shell/useDesktopActionHandlers.ts` (305) |
| Event System | `desktop/runtime/desktop-events.ts` (17) | `shared/desktop-event-contracts.ts` (72) |
| Native Extensions | `desktop/runtime/native-extension-ui-state.ts` (45) | `desktop/native-extensions/` (4 files) |

### terax-pi (existing infrastructure)

| Area | Primary File | Lines |
|---|---|---|
| Artifact React Compiler | `src-tauri/src/modules/artifacts/react.rs` | 1184 |
| Artifact Store | `src-tauri/src/modules/artifacts/store.rs` | 841 |
| Artifact Frontend Hub | `src/modules/artifacts/ArtifactHubPanel.tsx` | 961 |
| Artifact Frontend Workspace | `src/modules/artifacts/ArtifactWorkspacePanel.tsx` | 379 |
| Artifact Preview | `src/modules/artifacts/components/ArtifactPreviewFrame.tsx` | 170 |
| Pi Host (Rust) | `src-tauri/src/modules/pi/host.rs` | 669 |
| Pi State Machine | `src-tauri/src/modules/pi/state.rs` | 575 |
| Pi Commands | `src-tauri/src/modules/pi/mod.rs` | 1065 |
| Pi Host Protocol | `sidecars/pi-host/protocol.js` | 564 |
| Pi Sessions | `sidecars/pi-host/sessions.js` | 905 |
| Pi Panel | `src/modules/pi/PiPanel.tsx` | 937 |
| Panel State | `src/modules/pi/lib/panel-state.ts` | 357 |
| Agent Detection | `src-tauri/src/modules/pty/agent_detect.rs` | ~200 |
| Agent Store | `src/modules/agents/store/agentStore.ts` | 218 |
| Git Commands | `src-tauri/src/modules/git/mod.rs` | ~500 |
| Tab Types | `src/modules/tabs/lib/types.ts` | 145 |
| App Root | `src/app/App.tsx` | 934 |
| App Entry | `src/main.tsx` | 39 |
| MCP Module | `src-tauri/src/modules/mcp/` | ~2000 total |
| Workflow Module | `src/modules/workflow/` | ~5000 total |
| Model Compare | `src/modules/model-compare/` | ~1000 total |
| Capabilities | `src-tauri/src/modules/capabilities/` | ~500 total |
| Test suites | 11 test files in React artifact module | — |
