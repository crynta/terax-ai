# Zosma Cowork — Sidecar Architecture Analysis

## Reference Implementation

**Repo**: `zosmaai/zosma-cowork`  
**Stack**: Tauri (Rust) → Node.js sidecar → pi SDK (`@earendil-works/pi-coding-agent`)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                           │
│  (Tauri webview — calls Tauri commands via @tauri-apps/api)    │
└──────────┬──────────────────────────────────────────┬───────────┘
           │ Tauri IPC (invoke)                        │ Tauri events (listen)
           ▼                                          ▲
┌──────────────────────────────────────────────────────────────────┐
│                    Rust Backend (src-tauri/src/lib.rs)           │
│  - Tauri commands (thin wrappers)                               │
│  - Sidecar process lifecycle (spawn, stdin/stdout)              │
│  - Pending request/prompt routing (HashMap<id, oneshot/channel>)
│  - Skill install/remove (git2 — no npx)                         │
│  - Wallpaper file management                                    │
│  - Browser URL opening (platform-specific)                      │
└──────────┬──────────────────────────────────────────▲───────────┘
           │ stdin (JSON lines — commands)             │ stdout (JSON lines — events)
           ▼                                          │
┌──────────────────────────────────────────────────────────────────┐
│              Node.js Agent Sidecar (~2800 lines)                 │
│  (agent-sidecar/src/index.ts + supporting modules)              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ pi SDK Integration Layer                                    │ │
│  │  - createAgentSession()                                     │ │
│  │  - AuthStorage, ModelRegistry, SessionManager               │ │
│  │  - SettingsManager, DefaultResourceLoader                   │ │
│  │  - session.subscribe() → forward events to stdout           │ │
│  │  - session.prompt() / .abort() / .steer() / .followUp()    │ │
│  │  - session.setModel() / .bindExtensions()                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Extension Manager │  │ Remote Server  │  │ Prompt Scheduler │  │
│  │ (install/uninstall│  │ (HTTP/WS/SSE)  │  │ (serial chain)   │  │
│  │  enable/disable)  │  │ (EventBus)     │  │                  │  │
│  └──────────────────┘  └────────────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Communication Protocol

### 2.1 Wire Format: JSON Lines over stdin/stdout

**Rust → Sidecar (stdin commands):**
```json
{"type":"init","zosmaDir":"/home/user/.zosmaai","workspace":"/path/to/project"}
{"type":"prompt","id":"p-abc123","text":"hello"}
{"type":"abort","id":"ab"}
{"type":"steer","id":"st-def456","text":"actually do X instead"}
{"type":"set_model","id":"sm","provider":"anthropic","model":"claude-sonnet-4-20250514"}
```

**Sidecar → Rust (stdout events):**
```json
{"type":"ready","models":[...],"providers":[...],"activeModel":{...}}
{"type":"event","event":{<AgentSessionEvent>}}
{"type":"result","id":"p-abc123","data":{...}}
{"type":"done","id":"p-abc123"}
{"type":"error","id":"p-abc123","message":"Not initialized"}
```

### 2.2 Rust Relay Pattern

The Rust layer is a **thin relay** — every Tauri command follows one of two patterns:

**Fire-and-forget (prompts):**
```
React invoke("send_prompt") → Rust sends stdin {"type":"prompt",...} 
                              → Rust registers id in pending_prompts map
                              → Sidecar streams events to stdout
                              → Rust forwards events to React Channel<Value>
                              → Sidecar sends {"type":"done"} 
                              → Rust removes from pending_prompts
```

**Request-response (settings, auth, models):**
```
React invoke("get_models") → Rust creates oneshot channel + sends stdin command
                           → Sidecar processes and sends {"type":"result",...}
                           → Rust resolves oneshot → returns to React
```

The relay's `read_stdout()` function routes events by type:
- `"ready"` → marks sidecar ready, emits Tauri event
- `"event"` → forwards to ALL active prompt channels + emits global Tauri events for OAuth/UI
- `"done"` → resolves the prompt channel
- `"result"` → resolves the pending request oneshot
- `"error"` → resolves either pending request or prompt channel

---

## 3. pi SDK Integration Points

### 3.1 SDK Imports Used

```typescript
import {
  AuthStorage,               // Credential persistence (API keys + OAuth tokens)
  DefaultResourceLoader,     // Discovers extensions, skills, prompts, themes
  type ExtensionFactory,     // Factory function type for extensions
  type ExtensionUIContext,   // Abstract UI dialog interface
  type ExtensionUIDialogOptions,
  ModelRegistry,             // Model catalog + provider management
  SessionManager,            // In-memory session state
  SettingsManager,           // Configuration (timeouts, retries, packages)
  type Theme,                // Terminal theme stub
  createAgentSession,        // THE main entry point — creates the agent
} from "@earendil-works/pi-coding-agent";

import { loginOpenAICodex } from "@earendil-works/pi-ai/oauth";  // Direct OAuth (bypasses SDK's broken originator)
```

### 3.2 Session Creation

```typescript
// Core initialization pattern:
authStorage = AuthStorage.create(authPath);          // ~/.zosmaai/cowork/auth.json
modelRegistry = ModelRegistry.create(authStorage, modelsPath);  // ~/.zosmaai/cowork/models.json
settingsManager = SettingsManager.inMemory({...});    // In-memory, not file-backed
sessionManager = SessionManager.inMemory(workspaceCwd);  // In-memory, sidecar handles persistence
resourceLoader = new DefaultResourceLoader({
  cwd: workspaceCwd,
  agentDir: piAgentDir(),          // ~/.pi/agent — shares pi's resources
  settingsManager,
  noExtensions: true,               // Sidecar loads extensions itself
  extensionFactories: [             // Inline + disk-loaded extensions
    piAnthropicMessages,            // Vendored Anthropic bridge
    zosmaOfficeDocs,                // Office document tools
    zosmaGoogleCalendar,            // Google Calendar tools
    ...diskExtensionFactories,      // Loaded via jiti + virtualModules
  ],
  systemPromptOverride: () => ZOSMA_SYSTEM_PROMPT,
  appendSystemPromptOverride: () => [],  // Suppress APPEND_SYSTEM.md
});

const result = await createAgentSession({
  cwd: workspaceCwd,
  authStorage,
  modelRegistry,
  sessionManager,
  settingsManager,
  resourceLoader,
});
session = result.session;
```

### 3.3 Event Streaming

```typescript
session.subscribe((event) => {
  send({ type: "event", event });  // Forward every SDK event to stdout
});
```

This is the **only** event bridge — every `AgentSessionEvent` flows raw to stdout, where Rust parses and routes them. The sidecar does NOT interpret events; it's a transparent pipe.

### 3.4 Prompt Execution

```typescript
// Serialized via PromptScheduler (promises chain):
await session.prompt(cmd.text);       // Blocks until generation completes
session.abort();                       // Cancels mid-generation
await session.steer(text, images);     // Mid-turn steering (before next LLM call)
await session.followUp(text, images);  // Post-turn follow-up
session.clearQueue();                  // Drain steer+followUp queue
await session.setModel(model);         // Switch model mid-session
await session.bindExtensions({ uiContext }); // Bind UI bridge
```

### 3.5 Key SDK Configuration Choices

| Aspect | Zosma's Choice | Rationale |
|--------|---------------|-----------|
| **System prompt** | Custom `systemPromptOverride` | Replaces pi's ~250-token default that leaks pi identity |
| **Append system prompt** | Empty `appendSystemPromptOverride: () => []` | Suppresses APPEND_SYSTEM.md |
| **Extensions** | `noExtensions: true` + manual loading | Bundled sidecar has no node_modules for pi's native loader |
| **Session persistence** | `SessionManager.inMemory()` | Sidecar handles JSONL persistence itself |
| **Settings** | `SettingsManager.inMemory()` | Cowork manages its own settings.json |
| **Auth** | `AuthStorage.create()` on cowork dir | Separate auth from pi, with inheritance from pi on first run |
| **Compaction** | Default (enabled) | Long sessions auto-summarize to avoid context overflow |
| **Timeouts** | 10min prompt, 5min provider request | Prevents hung UI states |

---

## 4. Native Tool Execution Flow

This is the most critical integration point. pi SDK tools (bash, read, write, edit, grep, etc.) execute **inside the sidecar process** — the Rust host does NOT intercept or proxy tool calls.

```
LLM Response → pi SDK parses tool_use → SDK executes tool internally → 
SDK emits tool_call/tool_result events → sidecar forwards via stdout → 
Rust forwards to React (display only)
```

**Key insight**: The sidecar does NOT implement any tool bridge. pi's tools run inside `createAgentSession()` automatically. The sidecar only:
1. Provides the `cwd` at session creation (tools are bound to this directory)
2. Subscribes to events (for UI display)
3. Calls `session.abort()` to cancel stuck tools

### 4.1 Extension UI Bridge (The Only Tool Proxy)

The one exception is the **Extension UI Context** — extensions like `pi-ask-user` that call `ctx.ui.select()` or `ctx.ui.confirm()`. These are bridged:

```
Extension calls ctx.ui.select() 
  → createUiDialog() emits {"kind":"ui_request", method:"select", ...} via stdout
  → Rust forwards as Tauri event "ui_request" 
  → React renders dialog
  → User clicks → React calls invoke("send_ui_response", {id, value})
  → Rust writes {"type":"ui_response", id, value} to sidecar stdin
  → resolveUiResponse() resolves the pending Promise
  → Extension receives the user's selection
```

This is a **full round-trip** through: Extension → Sidecar → stdout → Rust → Tauri event → React → Tauri invoke → Rust → stdin → Sidecar → Extension Promise.

---

## 5. Extension Loading Architecture

### 5.1 The Problem (Issue #147)

The shipped sidecar is a single esbuild bundle with **no node_modules**. pi's native extension loader uses `require.resolve` against a real node_modules tree. Without one, every disk/npm/git extension fails silently.

### 5.2 The Solution: jiti + virtualModules

```typescript
// disk-extension-loader.ts

// 1. Statically import all packages extensions might need (bundled by esbuild)
import * as _piAgentCore from "@earendil-works/pi-agent-core";
import * as _typebox from "typebox";
// ... etc

// 2. Map bare specifiers to these bundled copies
const VIRTUAL_MODULES = {
  "typebox": _typebox,
  "@earendil-works/pi-agent-core": _piAgentCore,
  "@mariozechner/pi-agent-core": _piAgentCore,  // Legacy scope
  // ...
};

// 3. Create jiti with virtualModules (same pattern as pi's Bun binary path)
const jiti = createJiti(import.meta.url, {
  moduleCache: true,
  virtualModules: VIRTUAL_MODULES,
  tryNative: false,
});

// 4. Resolve extension entry paths via pi's own package manager
const pm = new DefaultPackageManager({cwd, agentDir, settingsManager});
const resolved = await pm.resolve(async () => "skip");

// 5. Load each extension through jiti
const factory = await jiti.import(entryPath, { default: true });
await factory(pi);  // Invoke the extension's factory function
```

### 5.3 Extension Types

| Type | Source | Installation |
|------|--------|-------------|
| **Vendored inline** | `piAnthropicMessages`, `zosmaOfficeDocs` | Statically imported, always present |
| **Disk/npm/git** | `~/.pi/agent/extensions/`, `~/.pi/agent/npm/` | Loaded via jiti + virtualModules |
| **pi packages** | `settings.json` → `packages` array | Resolved via `DefaultPackageManager` |

### 5.4 Extension Manager

The `extension-manager.ts` handles the CRUD side:
- **discover**: Scans `~/.pi/agent/extensions/`, `cowork-extensions.json` registry, and `settings.json` packages
- **install**: `npm pack` + tarball extraction OR git clone OR local symlink
- **pi-first dedup**: If pi already manages a package, skips duplicate installation
- **registry**: `~/.pi/agent/cowork-extensions.json` (kept alongside pi's own resources)

---

## 6. Auth Architecture

### 6.1 Dual Auth Stores

```
~/.zosmaai/cowork/auth.json    → Cowork's own credentials
~/.pi/agent/auth.json          → pi CLI's credentials (inheritance source)
```

### 6.2 First-Run Credential Inheritance

```typescript
// auth-seed.ts
if (authStorage.list().length === 0) {
  // Cowork has NO credentials → seed from pi
  const inherited = computeInheritedCredentials(
    {},  // Cowork is empty
    readAuthFile(piAuthPath()),  // pi's auth.json
  );
  for (const [id, cred] of Object.entries(inherited)) {
    authStorage.set(id, cred);
  }
}
// After seeding, Cowork owns its auth — logouts stick, no re-seeding
```

### 6.3 OAuth Flow

```
1. React calls invoke("start_oauth", {provider})
2. Rust sends {"type":"start_oauth",...} to sidecar
3. Sidecar calls authStorage.login(provider, {onAuth, onPrompt, onProgress})
4. SDK starts loopback HTTP server → opens browser
5. Sidecar emits {"kind":"oauth_open_url", url} → Rust → React → shell.open(url)
6. User completes browser flow → SDK callback fires
7. Sidecar persists credential → emits {"kind":"oauth_completed"}
8. Sidecar reinitializes agent (new models available)
```

**OpenAI Codex special case**: The SDK's `AuthStorage.login()` sends `originator=pi` which OpenAI rejects. Zosma bypasses and calls `loginOpenAICodex()` directly with `originator="codex_cli_rs"`.

---

## 7. Session Management

### 7.1 JSONL Persistence Format

```jsonl
{"type":"session","version":1,"title":"Chat","createdAt":1718012345678,"model":"claude-sonnet-4-20250514","provider":"anthropic","cwd":"/path/to/project","messageCount":5}
{"role":"user","content":"hello","timestamp":1718012346000}
{"role":"assistant","content":"Hi!","timestamp":1718012347000,"model":"claude-sonnet-4-20250514","provider":"anthropic"}
```

### 7.2 Session Restoration

When loading a saved session:
1. Rebuild `DefaultResourceLoader` (picks up new extensions/skills)
2. Create fresh `createAgentSession()` with restored `cwd`
3. Subscribe to events + bind extension UI
4. **Directly inject** messages into `session.agent.state.messages` (bypasses SDK API)

```typescript
function restoreSessionContext(session, messages) {
  // Convert ChatMessage → pi AgentMessage format
  // Set session.agent.state.messages = piMessages
  // This is a HACK — directly mutating SDK internals
}
```

### 7.3 New Session / Workspace Switching

```typescript
// new_session with cwd change:
const requestedCwd = resolveWorkspace(cmd.cwd);
if (requestedCwd !== workspaceCwd) {
  workspaceCwd = requestedCwd;
  resourceLoader = await buildResourceLoader(workspaceCwd);  // Rebuild for new cwd
}
const result = await createAgentSession({cwd: workspaceCwd, ...});
```

---

## 8. Prompt Scheduling & Steering

### 8.1 Prompt Scheduler

The scheduler solves a critical problem: `await session.prompt()` blocks the stdin read loop, so `abort` commands can't be read.

```typescript
// Promise chain: tasks run serially, scheduler returns immediately
function createPromptScheduler() {
  let chain = Promise.resolve();
  return {
    schedule(task, onError) {
      chain = chain.then(task).catch(onError);
    }
  };
}

// In the stdin loop — does NOT await:
promptScheduler.schedule(() => runPromptTask(cmd), errorHandler);
```

### 8.2 Steering Protocol

- **steer**: Delivered after current tool calls finish, before next LLM call
- **follow_up**: Delivered when agent has no more tool calls or steering pending
- **clear_queue**: Atomically drains both queues, returns what was drained

These bypass the prompt scheduler — they queue **into** the running session via the SDK.

---

## 9. Remote Server Architecture

```
Phone Browser ─── POST /api/command ──► commandQueue ──► sidecar dispatch
                ◄── SSE  /api/events ◄── EventBus (from send())
                ◄── WS   /ws        ◄── EventBus (from send())
```

- **Auth**: PIN-based (6-digit, 2-min expiry). Local requests (127.0.0.1) bypass PIN.
- **EventBus**: Node.js EventEmitter singleton. `send()` publishes to both stdout AND EventBus.
- **CommandQueue**: Ring buffer (max 100). Polled every 100ms by the main loop.
- **Static serving**: Serves the built React app from `dist/` (desktop) and `dist/mobile.html` (phone).

---

## 10. Key Files & Their Roles

| File | Lines | Role |
|------|-------|------|
| `index.ts` | ~2825 | Main sidecar — stdin/stdout protocol, SDK init, all command handlers |
| `disk-extension-loader.ts` | ~130 | jiti + virtualModules extension loading for bundled sidecar |
| `extension-manager.ts` | ~500 | Extension CRUD (install/uninstall/enable/disable), npm search |
| `steering.ts` | ~180 | steer/followUp/clearQueue command handlers |
| `settings-store.ts` | ~50 | Merge-based settings persistence |
| `event-bus.ts` | ~70 | EventEmitter singleton for remote server + stdout fanout |
| `command-queue.ts` | ~60 | Ring buffer for remote commands |
| `auth-seed.ts` | ~45 | First-run credential inheritance from pi CLI |
| `remote-server.ts` | ~400 | HTTP/WS/SSE server for phone access |
| `prompt-scheduler.ts` | ~30 | Promise-chain serial executor |
| `extract-chat-messages.ts` | ~90 | pi AgentMessage → ChatMessage conversion |
| `lib.rs` | ~2000 | Tauri backend — sidecar spawn, IPC relay, skill management |

---

## 11. Lessons for Terax Architecture

### 11.1 What Works Well

1. **Sidecar pattern**: Node.js sidecar + thin Rust relay is clean separation. The SDK needs Node.js (jiti, require.resolve), and the desktop shell is Rust. stdin/stdout JSON lines is simple and debuggable.

2. **Transparent event pipe**: `session.subscribe() → send({type:"event", event})` with zero interpretation means every SDK event reaches the UI without maintenance burden.

3. **Extension UI bridge**: The `ExtensionUIContext` implementation is elegant — `createUiDialog()` returns a Promise that resolves when the frontend sends `ui_response`. Supports timeouts, abort signals, and cancellation.

4. **Prompt scheduler**: Fire-and-forget scheduling with a Promise chain solves the "abort doesn't work" problem without complexity.

5. **Credential inheritance**: Seeding from pi on first run gives a zero-friction onboarding experience.

6. **Virtual modules**: The jiti + virtualModules approach lets extensions work in a bundled environment without a node_modules tree.

### 11.2 Pain Points & Risks

1. **Session restoration hack**: `session.agent.state.messages = piMessages` directly mutates SDK internals. This will break on SDK updates.

2. **Anthropic bridge vendoring**: Rewriting system prompts and tool names to impersonate Claude CLI is fragile and may break when Anthropic changes their fingerprinting.

3. **OpenAI originator hack**: Bypassing `AuthStorage.login()` for OpenAI Codex and calling `loginOpenAICodex` directly means maintaining a parallel auth path.

4. **No streaming control**: The sidecar forwards ALL events blindly. There's no backpressure, filtering, or aggregation — long tool outputs can flood the IPC channel.

5. **Extension dedup complexity**: The pi-first dedup logic in `extension-manager.ts` is complex (~100 lines) to handle the case where pi and Cowork both try to install the same npm package.

6. **Remote server polling**: The 100ms `setInterval` polling of the command queue is a latency source. A proper event-driven approach (notify on enqueue) would be better.

### 11.3 Architecture Decisions for Terax

| Decision | Zosma Approach | Terax Recommendation |
|----------|---------------|---------------------|
| **SDK host** | Node.js sidecar (Tauri) | Same — SDK requires Node.js |
| **IPC protocol** | stdin/stdout JSON lines | Same — simple, debuggable |
| **Event routing** | Blind pipe to stdout | Consider event filtering/aggregation for UI |
| **Extension loading** | jiti + virtualModules | Same pattern if bundling; or use pi's native loader if node_modules available |
| **Session persistence** | Custom JSONL | Consider using SDK's built-in persistence if available |
| **Auth** | Separate store + inheritance | Same pattern — gives flexibility |
| **System prompt** | Custom override | Same — required for brand identity |
| **UI bridge** | Promise-based dialog bridge | Same pattern — clean and extensible |
| **Remote access** | HTTP/WS inside sidecar | Consider separate process for isolation |
| **Skill management** | Rust-side (git2) | Good approach — avoids npx dependency |
