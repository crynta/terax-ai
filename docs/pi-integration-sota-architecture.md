# Pi Integration: SOTA Architecture

## Status: Proposed — ready for implementation

Date: 2026-06-10
Author: Architecture analysis — designed for handoff to another LLM for implementation

---

## Table of Contents

1. [Decision Record: Why This Architecture](#1-decision-record-why-this-architecture)
2. [Background: Current Terax Architecture](#2-background-current-terax-architecture)
3. [Background: Zosma Cowork Reference](#3-background-zosma-cowork-reference)
4. [Guiding Principles](#4-guiding-principles)
5. [Target Architecture Overview](#5-target-architecture-overview)
6. [Pi SDK API Surface (What createAgentSession Expects)](#6-pi-sdk-api-surface-what-createagentsession-expects)
7. [New Adapters (What to Build)](#7-new-adapters-what-to-build)
8. [Rust Side: New pi_native_tool Command](#8-rust-side-new-pi_native_tool-command)
9. [Event Bridge: AgentSession Events to PiSessionEvent Types](#9-event-bridge-agentsession-events-to-pisessionevent-types)
10. [Session Lifecycle (Create, Send, Resume, Stop, Delete, Rename)](#10-session-lifecycle)
11. [Tool Manifest and Registration](#11-tool-manifest-and-registration)
12. [Authentication and Provider Config](#12-authentication-and-provider-config)
13. [Extension, Skill, and Prompt Discovery](#13-extension-skill-and-prompt-discovery)
14. [MCP Integration Strategy](#14-mcp-integration-strategy)
15. [Session Persistence (Two-File Approach)](#15-session-persistence-two-file-approach)
16. [Files to Delete](#16-files-to-delete)
17. [Files That Stay Unchanged](#17-files-that-stay-unchanged)
18. [Files to Modify (Not Delete)](#18-files-to-modify-not-delete)
19. [Migration Phases](#19-migration-phases)
20. [Size and Performance Impact](#20-size-and-performance-impact)
21. [Error Handling and Edge Cases](#21-error-handling-and-edge-cases)
22. [Testing Strategy](#22-testing-strategy)
23. [Comparison Table: Zosma vs Terax Proposed](#23-comparison-table-zosma-vs-terax-proposed)
24. [Open Questions and Mitigations](#24-open-questions-and-mitigations)

---

## 1. Decision Record: Why This Architecture

### Decision 1: Webview over sidecar

We chose to run the pi SDK AgentSession in the Tauri webview (not a Node.js sidecar process).

| Factor | Sidecar | Webview (chosen) |
|--------|---------|-------------------|
| Process isolation | Sandboxed | Same process as UI |
| Startup latency | ~500ms spawn + ping | Instant (code loaded) |
| Crash recovery | Must detect + respawn child process | No crash domain |
| IPC complexity | JSON-RPC 2.0 framing, pending maps, stdin/stdout readers | Direct Tauri invoke |
| Bundle size | 463 MB node_modules + Node.js binary | 0 additional runtime |
| Dev iteration | Must rebuild sidecar + relaunch Tauri | Hot reload works |
| Extension API access | Full Node.js (fs, child_process) | Browser-limited (some extensions won't work) |

**Why webview wins:** Terax already has a full Rust backend for OS operations. The sidecar's main value — Node.js file/shell access — is already owned by Rust. The sidecar becomes an unnecessary intermediary. The browser API limitation for pi extensions is acceptable because most pi extensions use only the SDK extension API (tool registration, event hooks), not raw fs access.

### Decision 2: Rust owns tool execution, not pi

Every tool call goes through Rust's `CapabilityPolicy`, `WorkspaceAuth`, and `AuditLog`. Pi only defines the tool schema; Rust validates and executes.

**Why:** Terax is a terminal+editor+git workspace with security boundaries (workspace authorization, sensitive path deny-list, approval gating). Pi's built-in tool implementations (which run in-process and have no concept of workspace authorization) cannot provide this. Zosma has no equivalent — its tool calls run inside pi's Node.js process without any security mediation.

### Decision 3: DefaultResourceLoader over hand-built discovery

We use pi's `DefaultResourceLoader` for extension, skill, prompt, and theme discovery instead of Terax's current hand-built skill loader.

**Why:** `DefaultResourceLoader` is how the entire pi ecosystem works. It discovers from `~/.pi/agent/` and `.pi/` directories. Without it, Terax cannot run any pi extension, skill, or prompt template. Terax's current `skills.rs` and `pi-skills.ts` only handle SKILL.md files — they miss extensions, prompt templates, and themes.

### Decision 4: Two-file session persistence

Pi's `SessionManager` persists full message history in JSONL format. Terax's existing `pi-sessions.json` persists session metadata (title, status, timestamps) for the sidebar UI. Both coexist.

**Why:** The UI sidebar needs fast listing of all sessions with their titles and timestamps, which `pi-sessions.json` provides. Pi's JSONL format is optimized for message resumption. Trying to put everything in one file would require either parsing JSONL for the sidebar (slow) or duplicating metadata in pi's format.

### Decision 5: Single backend path (no USE_WEBVIEW_AGENT flag)

After migration, there is one path through `createAgentSession`, not a dual backend.

**Why:** The current `pi-session-backend.ts` routes between sidecar and webview based on `USE_WEBVIEW_AGENT`. This adds complexity, a test surface, and the maintenance burden of keeping two paths in sync. After migration, the sidecar path is deleted entirely.

---

## 2. Background: Current Terax Architecture

### Current State

Terax has **two overlapping pi integration paths** that share a Rust mediation layer.

#### Path A: Sidecar (`sidecars/pi-host/` + `src-tauri/src/modules/pi/host/`)

```
React UI → Tauri invoke → Rust PiState → JSON-RPC → Node.js sidecar
                                                          │
                                                    pi SDK (agent loop,
                                                     extension loading,
                                                     tool execution)
                                                          │
                                          nativeTools.execute ←──┐
                                               │                 │
                                               ▼                  │
                                        Rust bridge.rs            │
                                          ├── verify session+CWD │
                                          ├── CapabilityPolicy    │
                                          ├── audit log          │
                                          └── execute tool ───────┘
```

The sidecar (`sidecars/pi-host/host.js` + `protocol.js`) communicates via JSON-RPC 2.0 over stdin/stdout. It's spawned by Rust's `PiHost` struct, which manages lifecycle, timeouts, and crash recovery.

The sidecar uses `@earendil-works/pi-coding-agent` for:
- `listProfileModels(pi, params)` — model listing
- But does NOT use `createAgentSession`, `DefaultResourceLoader`, `AuthStorage`, `SessionManager`, or `SettingsManager`

Instead, the sidecar implements its own session state machine (create, send, resume, delete), tool approval queue, and event routing.

The sidecar is spawned from Rust via:
```rust
// src-tauri/src/modules/pi/host.rs
PiHost::spawn_inner_with_timeouts_and_native_tool_context(
    node_binary(resource_dir),    // bundled Node.js
    host_path,                    // sidecars/pi-host/host.js
    RequestTimeouts::production(),
    event_sink,
    native_tool_context,
)
```

Key files in the Rust sidecar management:
- `src-tauri/src/modules/pi/host.rs` — PiHost struct, spawn, call, shutdown
- `src-tauri/src/modules/pi/host/bridge.rs` — stdin/stdout reader threads, session verification, tool dispatch
- `src-tauri/src/modules/pi/host/protocol.rs` — JSON-RPC envelope types, PendingResponses, NativeToolApprovals
- `src-tauri/src/modules/pi/host/paths.rs` — Node binary + host script resolution
- `src-tauri/src/modules/pi/host/timeouts.rs` — Per-method request timeouts

#### Path B: Webview bridge (`src/modules/pi/bridge/` + `src/modules/pi/lib/webview-session.ts`)

This is duplicate code that manually builds a pi agent without using pi's session runtime. Key files:

- `src/modules/pi/bridge/pi-session.ts` — Creates raw `new Agent()` with hand-built tool definitions. Imports `Agent`, `streamSimple`, `getModel`, `estimateContextTokens`, `shouldCompact`, `generateSummary` from pi SDK. Defines `createTauriAgent()` which wires tools and a proxied stream.

- `src/modules/pi/bridge/pi-tools.ts` — Hand-builds tool definitions (read_file, write_file, edit_file, list_directory, bash_run, grep, glob) that call Tauri IPC directly. Reimplements path resolution, file editing (find+replace), and security checks that Rust already provides.

- `src/modules/pi/bridge/pi-env.ts` — Manual API key resolution from env vars via Tauri IPC.

- `src/modules/pi/bridge/pi-http.ts` — Installs a proxied global `fetch` to route through Tauri's `ai_http_request` (CORS bypass). Required because the raw `Agent` class doesn't handle HTTP routing.

- `src/modules/pi/bridge/pi-skills.ts` — Skill file resolution and system prompt building.

- `src/modules/pi/bridge/stubs/` — Dev stubs for fs, crypto, url, os, empty.

- `src/modules/pi/bridge/index.ts` — Exports `USE_WEBVIEW_AGENT` flag.

- `src/modules/pi/lib/webview-session.ts` — Session lifecycle management in the webview (create/send/resume/stop/rename/delete/tool_respond). Manages an in-memory `Map<string, SessionRecord>` of Agent instances. Emits PiSessionEvents via `emit("pi:session-event", ...)`. Has hand-rolled context compaction, tool approval gating, and event emission.

- `src/modules/pi/lib/pi-session-backend.ts` — Routes calls to either sidecar or webview backend based on `USE_WEBVIEW_AGENT`.

#### Shared Rust mediation layer (good, keep this)

- `src-tauri/src/modules/pi/native_tools.rs` — Tool dispatch (read, ls, grep, find, bash, edit, write, create_artifact, edit_artifact, read_artifact, list_artifacts, mcp__*). Security validation, workspace CWD verification, capability policy, audit logging.

- `src-tauri/src/modules/pi/native_tools/fs_tools.rs` — File system tool implementations.

- `src-tauri/src/modules/pi/native_tools/artifact_tools.rs` — Artifact tool implementations.

- `src-tauri/src/modules/pi/native_tools/mcp_tools.rs` — MCP tool routing.

- `src-tauri/src/modules/capabilities/` — Policy evaluation, audit logging, workspace auth.

- `src-tauri/src/modules/mcp/` — MCP server connections, tool registry, approval policies.

- `src-tauri/src/modules/artifacts/` — Artifact storage, React compilation, edit system.

- `src-tauri/src/modules/pi/store.rs` — Session history persistence (pi-sessions.json).

#### Frontend (keep everything)

- `src/modules/pi/components/` — PiChatPanel, PiComposer, PiPanel, PiTranscript, PiSection, all support cards.
- `src/modules/pi/lib/` — ControllerProvider, chatStore, panel-state, lifecycle, events, sessions, native, etc.
- `src/modules/pi/lib/sessions/` — Event types, merge logic, transcript building.
- `src/modules/pi/lib/usePiSessionEventStream.ts` — Real-time event stream from Tauri.

### Current Data Types (must preserve)

These existing types are used by the frontend and must be preserved. The new architecture emits the same types.

```typescript
// From src/modules/pi/lib/sessions/types.ts
interface PiSession {
  id: string;
  title: string;
  cwd: string | null;
  status: "idle" | "running" | "stopped" | "error";
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
  lastPrompt: string | null;
  workspaceEnv?: WorkspaceEnv | null;
  thinkingLevel?: string | null;
  sdkSessionFile?: string | null;
  archivedAt?: string | null;
  forkedFrom?: PiSessionForkRef | null;
}

// From src/modules/pi/lib/sessions/events.ts
enum PI_SESSION_EVENT {
  Created = "session.created",
  Resumed = "session.resumed",
  Input = "session.input",
  Progress = "session.progress",
  ReasoningDelta = "session.reasoning.delta",
  ReasoningText = "session.reasoning.text",
  OutputDelta = "session.output.delta",
  OutputText = "session.output.text",
  ToolStart = "session.tool.start",
  ToolUpdate = "session.tool.update",
  ToolApprovalRequested = "session.tool.approval.requested",
  ToolApprovalResponded = "session.tool.approval.responded",
  ToolResult = "session.tool.result",
  Status = "session.status",
  Renamed = "session.renamed",
  Deleted = "session.deleted",
  Error = "session.error",
  Forked = "session.forked",
  Archived = "session.archived",
  Restored = "session.restored",
}

interface PiSessionEvent {
  id: string;
  type: string;          // one of PI_SESSION_EVENT values
  sessionId: string;
  createdAt: string;     // ISO 8601
  payload: Record<string, unknown>;
}
```

---

## 3. Background: Zosma Cowork Reference

### Zosma's Architecture

Zosma Cowork is a desktop GUI for pi. It uses the full pi SDK in a Node.js sidecar:

```
Tauri Rust (thin relay) ↔ stdin/stdout JSON lines ↔ Node.js sidecar
                                                         │
                                                    createAgentSession({
                                                      resourceLoader: DefaultResourceLoader({
                                                        agentDir: ~/.pi/agent,
                                                        cwd: workspaceCwd,
                                                        extensionFactories: [piAnthropicMessages, zosmaOfficeDocs, ...],
                                                        systemPromptOverride: () => ZOSMA_SYSTEM_PROMPT,
                                                        noExtensions: false,
                                                      }),
                                                      authStorage: AuthStorage.create(authPath),
                                                      modelRegistry: ModelRegistry.create(...),
                                                      sessionManager: SessionManager.inMemory(cwd),
                                                      settingsManager: SettingsManager.inMemory(...),
                                                    })
                                                     │
                                              session.subscribe() → stdout events
                                              nativeTools.execute ← stdin host requests
```

**Key observations from Zosma:**

1. The sidecar calls `createAgentSession()` with all pi SDK components. It does NOT manually construct `new Agent()`. The SDK owns the agent loop.

2. Native tool execution works through a host request callback: when the SDK needs to execute a tool, it calls the `nativeTools.execute` method on the transport, which the Rust host intercepts, executes, and responds to. This is the same pattern we need for Terax but in the webview instead of a sidecar.

3. Extension loading requires `virtualModules` + `jiti` because the esbuild-bundled sidecar has no `node_modules`. In the webview, npm packages are resolved by Vite, so this complexity vanishes.

4. Zosma uses `AuthStorage.create(path)` with a file-based JSON auth file. Terax should use a custom backend that reads/writes through the OS keychain.

5. Zosma's sidecar is ~2825 lines (the index.ts alone). Terax's sidecar is ~1500 lines of Rust host management + ~2000 lines of webview bridge. Both are largely boilerplate that `createAgentSession` eliminates.

6. Zosma's session restoration directly mutates `session.agent.state.messages`, which is fragile. Pi's `SessionManager` + session file approach avoids this.

### What Terax Can Learn

- Use `createAgentSession` with the full suite of pi SDK components (same as Zosma)
- Route native tool execution through a host callback (same concept as Zosma, but Tauri `invoke` instead of JSON-RPC)
- Skip the sidecar entirely (Terax has Rust for OS operations; Zosma needs a sidecar because it has no Rust backend)

### What Terax Does Better

- Workspace authorization (Zosma has none)
- Capability policy with Auto/Ask/Deny per tool (Zosma has none)
- Audit logging of every tool call (Zosma has none)
- Sensitive path filtering (Zosma has none)
- Binary content mediated through artifact store (Zosma routes through Rust relay)
- OS keychain for API keys (Zosma uses file-based auth.json)

---

## 4. Guiding Principles

1. **Pi owns the agent brain.** The agent loop, tool schema definitions, streaming, context compaction, branching, steering, sub-agents, extensions, skills, prompt templates, auth workflows, model registry, and session persistence format are all pi's responsibility.

2. **Rust owns the agent hands.** Filesystem IO, shell execution, git operations, network requests (with SSRF guard), MCP transport, artifact storage, and workspace authorization are all Rust's responsibility. Every tool execution that touches the OS goes through Rust's `CapabilityPolicy` and `WorkspaceAuth` gate.

3. **The bridge is one callback.** The entire integration between pi and Rust is a single `nativeToolExecutor` async function that routes tool call requests to `invoke("pi_native_tool", request)` and returns the result. No JSON-RPC, no sidecar, no dual paths.

4. **No sidecar process.** The sidecar adds a process hop, JSON-RPC framing, crash-recovery logic, idle-shutdown controllers, and 463 MB of `node_modules` in the bundle. The webview + Rust is sufficient and simpler. The sidecar's only value was running pi SDK in Node.js — Terax can import the same SDK directly in the webview.

5. **No dual backends.** After migration, there is exactly one path for session operations: `createAgentSession` in the webview. The `USE_WEBVIEW_AGENT` flag and `PiSessionBackend` router are temporary migration tools and will be deleted.

6. **Existing frontend types survive.** All `PiSession`, `PiSessionEvent`, `PI_SESSION_EVENT` types remain unchanged. The frontend should not know or care that the backend switched from a sidecar + manual bridge to `createAgentSession`.

---

## 5. Target Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Webview (React + Pi SDK)                                                   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ createAgentSession({                                                 │   │
│  │   resourceLoader: DefaultResourceLoader({                            │   │
│  │     agentDir: piAgentDir(),   // ~/.pi/agent — extensions, skills    │   │
│  │     cwd: workspaceCwd,        // project root — .pi/ dirs           │   │
│  │     extensionFactories: [],   // vendored extensions if needed       │   │
│  │   }),                                                                │   │
│  │   authStorage: AuthStorage.create(keychainBackend),  // OS keychain  │   │
│  │   modelRegistry: ModelRegistry.create(auth, modelsPath),             │   │
│  │   sessionManager: SessionManager.inMemory(cwd),                      │   │
│  │   settingsManager: SettingsManager.inMemory({...}),                  │   │
│  │   nativeToolExecutor: teraxToolExecutor,          // -> Rust invoke  │   │
│  │   systemPromptOverride: buildTeraxSystemPrompt,  // TERAX.md+skills │   │
│  │ })                                                                   │   │
│  │     │                                                                   │
│  │     │ AgentSession.subscribe() → events                                 │
│  │     │     → map to PiSessionEvent                                       │
│  │     │     → emit("pi:session-event", event)                             │
│  │     │                                                                   │
│  │     ▼                                                                   │
│  │  usePiSessionEventStream → PiComposer, PiTranscript, PiPanel ...       │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ SessionFileAdapter: AgentSession events → pi-sessions.json           │   │
│  │ persistSessionEvent → invoke("pi_store_record_session", ...)          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ KeychainAuthAdapter: implements AuthStorageBackend → OS keychain     │   │
│  │ get/set/delete → invoke("secrets_*", ...)                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
                       │ invoke("pi_native_tool", request)
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Rust (Tauri) — security mediation layer                                     │
│                                                                              │
│  pi_native_tool command:                                                     │
│    ├── parse NativeToolRequest { sessionId, toolCallId, toolName,           │
│    │                               cwd, workspaceEnv, approval, input }     │
│    ├── verify session is known to workspace registry                         │
│    ├── verify canonical CWD matches the Rust-authorized session workspace    │
│    ├── evaluate CapabilityPolicy(toolName, approvalState): Auto|Ask|Deny    │
│    ├── if Deny → return CapabilityPolicyError                                │
│    ├── if Ask without approval → return ApprovalRequiredError                │
│    ├── record CapabilityAuditEntry                                           │
│    └── dispatch to execute_with_context(request, context):                   │
│         ├── fs_tools::read / ls / grep / find                               │
│         ├── bash (via shell::run_blocking_inner, timeout, truncation)        │
│         ├── edit / write (atomic, sensitive path filter)                     │
│         ├── create_artifact / edit_artifact / read_artifact / list_artifacts │
│         └── mcp__* (via McpState::call_tool, binary → artifact)             │
│                                                                              │
│  ArtifactStore (filesystem-backed, conversation-scoped)                      │
│  McpState (stdio/HTTP MCP client, tool registry, approval policies)          │
│  WorkspaceRegistry (authorized directories per workspace env)                │
│  CapabilityAuditLog (ring buffer, 1000 entries)                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Pi SDK API Surface (What createAgentSession Expects)

### `createAgentSession(options)` from `@earendil-works/pi-coding-agent`

This is the main function we'll use. It returns `{ session: AgentSession, agent: Agent }`.

```typescript
// Approximate type signature (read from actual SDK for exact interface)
function createAgentSession(options: {
  // REQUIRED: Resource loader for extensions, skills, prompts, themes
  resourceLoader: DefaultResourceLoader;

  // REQUIRED: Auth backend for API keys + OAuth tokens
  authStorage: AuthStorage;

  // REQUIRED: Model provider registry
  modelRegistry: ModelRegistry;

  // REQUIRED: Session persistence manager
  sessionManager: SessionManager;

  // REQUIRED: Settings provider
  settingsManager: SettingsManager;

  // OPTIONAL: Override the system prompt
  systemPromptOverride?: () => string;

  // OPTIONAL: Append to the system prompt
  appendSystemPromptOverride?: () => string[];

  // OPTIONAL: Provide tools to register (in addition to pi's defaults)
  extensionFactories?: ExtensionFactory[];

  // OPTIONAL: If true, don't auto-discover extensions from agentDir
  noExtensions?: boolean;

  // OPTIONAL: Custom tool executor — routes tool calls out of the SDK
  nativeToolExecutor?: (request: NativeToolRequest) => Promise<NativeToolResult>;
}): Promise<{ session: AgentSession; agent: Agent }>;
```

### `AgentSession` key methods

```typescript
class AgentSession {
  // Send a user prompt, returns when the agent finishes
  prompt(text: string): Promise<AgentResult>;

  // Subscribe to session events (streaming text, tool calls, status)
  subscribe(callback: (event: AgentEvent) => void): () => void;

  // Cancel the current prompt
  abort(): void;

  // Queue a steering message (delivered after current tool calls)
  steer(text: string): void;

  // Queue a follow-up (delivered after no more tools or steers)
  followUp(text: string): void;

  // Get/set the model
  setModel(provider: string, modelId: string): void;
  cycleModel(): void;
  model: Model;

  // Get/set thinking level
  setThinkingLevel(level: string): void;
  supportsThinking(): boolean;

  // Session metadata
  sessionId: string;
  sessionName: string;
  messages: AgentMessage[];
  isStreaming: boolean;
  state: AgentSessionState;

  // Compaction
  compact(): Promise<void>;
  autoCompactionEnabled: boolean;
  setAutoCompactionEnabled(enabled: boolean): void;

  // Retry
  autoRetryEnabled: boolean;
  setAutoRetryEnabled(enabled: boolean): void;

  // Session file management
  sessionFile: string | null;

  // Cleanup
  dispose(): void;
}
```

### `AgentEvent` types (from `@earendil-works/pi-agent-core`)

```typescript
type AgentEvent =
  | { type: "message_update"; message: AgentMessage }
  | { type: "tool_execution_start"; toolName: string; toolCallId: string; args: unknown }
  | { type: "tool_execution_end"; toolName: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "agent_error"; error: Error }
  | { type: "agent_retry"; attempt: number; error: Error }
  | { type: "compaction_start" }
  | { type: "compaction_end"; oldLength: number; newLength: number };
```

### `AuthStorage` (from pi-coding-agent)

```typescript
// AuthStorage is created by AuthStorage.create(backend)
// where backend implements AuthStorageBackend:

interface AuthStorageBackend {
  get(provider: string): Promise<string | null>;
  set(provider: string, value: string): Promise<void>;
  delete(provider: string): Promise<void>;
}

// AuthStorage.create() accepts EITHER:
//   - A file path string -> creates FileAuthStorageBackend
//   - An AuthStorageBackend object -> wraps it
// We pass an AuthStorageBackend that reads/writes OS keychain.
```

### `DefaultResourceLoader` constructor

```typescript
class DefaultResourceLoader {
  constructor(options: {
    cwd: string;
    agentDir: string;           // ~/.pi/agent
    settingsManager: SettingsManager;
    noExtensions?: boolean;     // skip loading pi's disk extensions
    extensionFactories?: ExtensionFactory[];  // vendored extensions
    systemPromptOverride?: () => string;
    appendSystemPromptOverride?: () => string[];
  });

  async reload(): Promise<void>;
  getExtensions(): { extensions: Extension[]; errors: ExtensionError[] };
  getSkills(): Skill[];
  getPromptTemplates(): PromptTemplate[];
  piPackageManager: PackageManager;
}
```

### `ModelRegistry`

```typescript
class ModelRegistry {
  static create(authStorage: AuthStorage, modelsPath: string): ModelRegistry;
  getSelectedModel(): Model;
  listModels(): Model[];
  setSelectedModel(provider: string, modelId: string): void;
  // ... more methods
}
```

### `SessionManager`

```typescript
class SessionManager {
  static inMemory(cwd: string): SessionManager;
  // Manages session list, resume from file, etc.
  listSessions(): { sessions: SessionSummary[] };
  // ...
}
```

### `SettingsManager`

```typescript
class SettingsManager {
  static inMemory(options?: Record<string, unknown>): SettingsManager;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
```

---

## 7. New Adapters (What to Build)

### 7.1 `KeychainAuthAdapter` — new file

**Path:** `src/modules/pi/lib/keychain-auth-adapter.ts`

**Purpose:** Implements pi's `AuthStorageBackend` interface using the OS keychain via Tauri IPC. Replaces pi's default file-based `auth.json`.

**Spec:**

```typescript
/**
 * Pi AuthStorageBackend implementation backed by OS keychain.
 *
 * Pi's AuthStorage.create() accepts a backend object. We pass this
 * to route all credential storage through Terax's keychain (keyring crate).
 *
 * The keychain service name is "terax-ai" (matching the existing
 * KEYRING_SERVICE in the Rust codebase).
 *
 * OAuth tokens (for Claude Pro/Max, OpenAI Codex) are stored
 * using the same interface — pi's AuthStorage handles the
 * OAuth dance, we just persist the resulting tokens.
 */

import type { AuthStorageBackend } from "@earendil-works/pi-coding-agent";
import { invoke } from "@tauri-apps/api/core";

const KEYRING_SERVICE = "terax-ai";

export const keychainAuthBackend: AuthStorageBackend = {
  async get(provider: string): Promise<string | null> {
    return invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      key: provider,
    });
  },

  async set(provider: string, value: string): Promise<void> {
    await invoke("secrets_set", {
      service: KEYRING_SERVICE,
      key: provider,
      value,
    });
  },

  async delete(provider: string): Promise<void> {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      key: provider,
    });
  },
};
```

**Usage in `createAgentSession`:**

```typescript
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { keychainAuthBackend } from "./keychain-auth-adapter";

const authStorage = AuthStorage.create(keychainAuthBackend);
```

### 7.2 `TeraxToolBridge` — new file

**Path:** `src/modules/pi/lib/terax-tool-bridge.ts`

**Purpose:** The single bridge point between pi's AgentSession and Terax's Rust mediation layer. Implements the `nativeToolExecutor` callback that `createAgentSession` calls when the model requests a tool execution.

**Spec:**

```typescript
/**
 * Maps pi AgentSession native tool requests to Tauri IPC.
 *
 * This is the single bridge point between pi and Rust.
 * Every tool call coming from the model (read, write, edit, bash, grep,
 * find, ls, create_artifact, etc.) is routed through this function,
 * which invokes the Rust pi_native_tool command.
 *
 * Rust handles:
 * 1. Session + CWD verification
 * 2. Capability policy evaluation (Auto/Ask/Deny)
 * 3. Audit logging
 * 4. Actual tool execution (fs, shell, MCP, artifacts)
 *
 * The result is returned to the AgentSession, which feeds it
 * back to the model.
 */

import { invoke } from "@tauri-apps/api/core";

// These match the Rust NativeToolRequest type
export interface TeraxToolRequest {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  cwd: string;
  workspaceEnv?: string | { distro: string } | null;
  approval?: { policy?: string; approved?: boolean } | null;
  input: unknown;
}

export interface TeraxToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}

/**
 * Native tool executor for pi's createAgentSession.
 *
 * Called by AgentSession when the model requests a tool execution.
 * Routes through Rust for verification, policy, and execution.
 */
export async function teraxToolExecutor(
  request: TeraxToolRequest,
): Promise<TeraxToolResult> {
  return invoke<TeraxToolResult>("pi_native_tool", { request });
}
```

### 7.3 `TeraxSystemPrompt` — new file

**Path:** `src/modules/pi/lib/terax-system-prompt.ts`

**Purpose:** Builds the system prompt for Terax sessions, incorporating TERAX.md content and discovered skills through pi's skill system.

**Spec:**

```typescript
/**
 * Builds the Terax system prompt.
 *
 * Uses pi's loadSourcedSkills + formatSkillsForSystemPrompt to
 * include skills from ~/.pi/agent/skills/ and project .pi/skills/.
 *
 * The system prompt includes:
 * - Terax's identity and capabilities
 * - Current date
 * - Working directory
 * - Available skills (formatted by pi)
 * - TERAX.md project context (read from workspace root)
 */

import { loadSourcedSkills, formatSkillsForSystemPrompt } from "@earendil-works/pi-agent-core";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@/modules/pi/lib/path-utils"; // existing path helpers

/** Default pi agent directory */
function piAgentDir(): string {
  return join(process.env.HOME || "~", ".pi", "agent");
}

/** Current date string for system prompt */
function currentDate(): string {
  return `Current date: ${new Date().toISOString().split("T")[0]}`;
}

/** Reads TERAX.md from workspace root */
async function readTeraxMd(cwd: string): Promise<string | null> {
  try {
    const result = await invoke<{ content: string }>("fs_read_file", {
      path: join(cwd, "TERAX.md"),
    });
    return result.content;
  } catch {
    return null;
  }
}

/**
 * Build the complete Terax system prompt.
 *
 * @param cwd - Current workspace directory
 * @returns The system prompt string
 */
export async function buildTeraxSystemPrompt(cwd: string): Promise<string> {
  const skills = await loadSourcedSkills({
    cwd,
    agentDir: piAgentDir(),
    extraSkillDirs: [join(cwd, ".pi")],
  });
  const skillsBlock = formatSkillsForSystemPrompt(skills);

  const teraxMd = await readTeraxMd(cwd);

  const parts: string[] = [
    "You are Terax, an AI-native terminal and development environment.",
    "You have access to files, shell, git, web preview, and MCP tools.",
    "All tool execution goes through a secure workspace authority.",
    currentDate(),
    `Current working directory: ${cwd}`,
  ];

  if (teraxMd) {
    parts.push(`\nProject context:\n${teraxMd}`);
  }

  if (skillsBlock) {
    parts.push(`\nSkills:\n${skillsBlock}`);
  }

  return parts.filter(Boolean).join("\n");
}
```

**Usage:**

```typescript
// Passed to DefaultResourceLoader or directly to createAgentSession
const session = await createAgentSession({
  // ...
  systemPromptOverride: () => buildTeraxSystemPrompt(cwd),
});
```

### 7.4 `SessionFileAdapter` — new file

**Path:** `src/modules/pi/lib/session-file-adapter.ts`

**Purpose:** Bridges AgentSession events to Terax's existing `pi-sessions.json` persistence. Listens to session lifecycle events from AgentSession and persists metadata via existing Rust store commands.

**Spec:**

```typescript
/**
 * Bridges AgentSession events to Terax's pi-sessions.json store.
 *
 * AgentSession manages its own message history in JSONL files.
 * Terax maintains a separate pi-sessions.json for the session sidebar UI.
 *
 * This adapter listens to AgentSession lifecycle events (created, deleted,
 * renamed, status changes) and keeps pi-sessions.json in sync.
 *
 * The AgentSession's sessionFile field points to the JSONL file
 * containing full message history for resumption.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PiSession, PiSessionEvent } from "@/modules/pi/lib/sessions/types";
import { PI_SESSION_EVENT } from "@/modules/pi/lib/sessions/events";

/**
 * Persist a single session event to pi-sessions.json.
 *
 * Routes through the existing Rust store which handles
 * deduplication and the 500-event cap.
 */
export async function persistSessionEvent(event: PiSessionEvent): Promise<void> {
  try {
    // Lifecycle events need both session metadata and the event
    if (
      event.type === PI_SESSION_EVENT.Created ||
      event.type === PI_SESSION_EVENT.Resumed ||
      event.type === PI_SESSION_EVENT.Status ||
      event.type === PI_SESSION_EVENT.Renamed ||
      event.type === PI_SESSION_EVENT.Deleted
    ) {
      const session = event.payload.session as PiSession;
      await invoke("pi_store_record_session", {
        session,
        events: [event],
      });
    } else {
      // Ordinary events (input, output, tool calls) just get recorded
      await invoke("pi_store_record_events", { events: [event] });
    }
  } catch (error) {
    // Non-fatal — session history persistence failures should not
    // interrupt the user experience
    console.warn("Session persistence failed:", error);
  }
}

/**
 * Subscribe to AgentSession events and persist them.
 *
 * Returns an unsubscribe function.
 *
 * @param agentSession - The pi AgentSession
 * @param sessionId - Terax's PiSession id
 * @returns unsubscribe function
 */
export function subscribeToAgentSessionForPersistence(
  subscribe: (cb: (event: unknown) => void) => () => void,
  sessionId: string,
  onEvent: (event: PiSessionEvent) => void,
): () => void {
  return subscribe((rawEvent: any) => {
    const piEvent = mapAgentEventToPiSessionEvent(rawEvent, sessionId);
    if (piEvent) {
      onEvent(piEvent);
      persistSessionEvent(piEvent);
    }
  });
}
```

### 7.5 `createAgentSessionWrapper` — new file

**Path:** `src/modules/pi/lib/agent-session-wrapper.ts`

**Purpose:** The main orchestration point. Wraps pi's `createAgentSession()` and adapts its output to Terax's existing `PiSession` / `PiSessionEvent` types. This file replaces what `webview-session.ts` + `bridge/pi-session.ts` currently do.

**Spec:**

```typescript
/**
 * Wraps pi's createAgentSession to produce Terax-compatible session objects.
 *
 * This is the replacement for webview-session.ts + bridge/pi-session.ts.
 *
 * It:
 * 1. Creates an AgentSession with DefaultResourceLoader, keychain auth, etc.
 * 2. Adapts AgentSession events to PiSessionEvent types for the frontend
 * 3. Manages the list of active sessions in memory
 * 4. Persists session metadata via SessionFileAdapter
 */

import {
  createAgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { keychainAuthBackend } from "./keychain-auth-adapter";
import { teraxToolExecutor } from "./terax-tool-bridge";
import { buildTeraxSystemPrompt } from "./terax-system-prompt";
import { persistSessionEvent } from "./session-file-adapter";
import { mapAgentSessionEventToPiEvent } from "./event-mapper";
import type {
  PiSession,
  PiSessionEvent,
  PiSessionCreateResult,
  PiSessionSendResult,
  PiSessionStopResult,
  PiSessionResumeResult,
  PiSessionRenameResult,
  PiSessionDeleteResult,
  PiSessionToolRespondResult,
} from "./sessions";
import { PI_SESSION_EVENT } from "./sessions/events";
import { v4 as uuid } from "./uuid";

// ─── State ───

interface SessionRecord {
  agentSession: AgentSession;
  piSession: PiSession;
  eventUnsubscriber: () => void;
}

const sessions = new Map<string, SessionRecord>();

/** Pi agent directory path */
function piAgentDir(): string {
  // Resolved from workspace settings or env
  return joinHome(".pi", "agent");
}

function joinHome(...parts: string[]): string {
  return ["/Users", ...parts].join("/"); // simplified; use actual platform-aware path
}

// ─── Event Emission ───

function emitToFrontend(piEvent: PiSessionEvent): void {
  emit(PI_SESSION_EVENT_NAME, piEvent).catch(() => {
    // Non-fatal
  });
}

const PI_SESSION_EVENT_NAME = "pi:session-event";

// ─── Session Factory ───

export async function createPiSession(
  title?: string,
  cwd?: string | null,
  providerConfig?: { provider: string; modelId: string; baseUrl?: string; thinkingLevel?: string } | null,
): Promise<PiSessionCreateResult> {
  const sessionId = uuid();
  const now = new Date().toISOString();
  const workingDir = cwd ?? "/";

  const defaultProviderConfig = providerConfig ?? {
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
  };

  // Build the system prompt (can be sync if we cache)
  const systemPrompt = await buildTeraxSystemPrompt(workingDir);

  // Resolve the models path for ModelRegistry
  const modelsPath = joinHome(".pi", "agent", "models.json");

  // Auth storage backed by OS keychain
  const authStorage = AuthStorage.create(keychainAuthBackend);

  // Model registry
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

  // Session manager
  const sessionManager = SessionManager.inMemory(workingDir);

  // Settings manager
  const settingsManager = SettingsManager.inMemory({
    autoCompact: true,
    autoRetry: true,
  });

  // Default resource loader — discovers extensions, skills, prompts, themes
  const resourceLoader = new DefaultResourceLoader({
    cwd: workingDir,
    agentDir: piAgentDir(),
    settingsManager,
    // We do NOT set noExtensions — let pi discover extensions normally
    // Extensions that use Node.js-specific APIs will fail gracefully
  });
  await resourceLoader.reload();

  // Create the pi AgentSession
  const result = await createAgentSession({
    resourceLoader,
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    nativeToolExecutor: teraxToolExecutor,
    systemPromptOverride: () => systemPrompt,
  });

  const { session: agentSession, agent } = result;

  // Create the Terax PiSession metadata object
  const piSession: PiSession = {
    id: sessionId,
    title: title ?? "New session",
    cwd: workingDir,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    lastPrompt: null,
  };

  // Subscribe to AgentSession events and forward them as PiSessionEvents
  const eventUnsubscriber = subscribeAgentEvents(
    agentSession,
    sessionId,
    piSession,
  );

  sessions.set(sessionId, {
    agentSession,
    piSession,
    eventUnsubscriber,
  });

  // Emit the created event
  const createdEvent: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Created,
    sessionId,
    createdAt: now,
    payload: { session: piSession },
  };

  emitToFrontend(createdEvent);
  await persistSessionEvent(createdEvent);

  return { session: piSession, events: [createdEvent] };
}

// ─── Event Subscription ───

function subscribeAgentEvents(
  agentSession: AgentSession,
  sessionId: string,
  piSession: PiSession,
): () => void {
  return agentSession.subscribe((rawEvent) => {
    const piEvents = mapAgentSessionEventToPiEvent(rawEvent, sessionId, piSession);
    for (const piEvent of piEvents) {
      emitToFrontend(piEvent);
      persistSessionEvent(piEvent);
    }
  });
}

// ─── Session Operations ───

export async function sendToPiSession(
  sessionId: string,
  promptText: string,
  options?: {
    thinkingLevel?: string;
    regenerateBranchGroupId?: string;
  },
): Promise<PiSessionSendResult> {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);

  const { agentSession } = record;

  // Guard against concurrent sends
  if (agentSession.isStreaming) {
    return { accepted: false, session: record.piSession, events: [] };
  }

  // Handle regeneration by setting think level
  if (options?.thinkingLevel) {
    agentSession.setThinkingLevel(options.thinkingLevel);
  }

  // Send the prompt — AgentSession handles everything:
  // context building, streaming, tool calls, compaction, retry
  try {
    await agentSession.prompt(promptText);
  } catch (error) {
    // AgentSession emits its own error events via subscribe
    // If it was an abort, the status event was already emitted
  }

  const updatedSession = {
    ...record.piSession,
    status: "idle" as const,
    lastPrompt: promptText,
    updatedAt: new Date().toISOString(),
  };
  record.piSession = updatedSession;

  return { accepted: true, session: updatedSession, events: [] };
}

export async function stopPiSession(sessionId: string): Promise<PiSessionStopResult> {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);

  record.agentSession.abort();

  const now = new Date().toISOString();
  const updatedSession = {
    ...record.piSession,
    status: "stopped" as const,
    updatedAt: now,
  };
  record.piSession = updatedSession;

  const event: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Status,
    sessionId,
    createdAt: now,
    payload: { status: "stopped" },
  };
  emitToFrontend(event);
  await persistSessionEvent(event);

  return { session: updatedSession, events: [event] };
}

export async function renamePiSession(
  sessionId: string,
  title: string,
): Promise<PiSessionRenameResult> {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);

  record.agentSession.setSessionName(title);

  const now = new Date().toISOString();
  const updatedSession = {
    ...record.piSession,
    title,
    updatedAt: now,
  };
  record.piSession = updatedSession;

  const event: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Renamed,
    sessionId,
    createdAt: now,
    payload: { title },
  };
  emitToFrontend(event);
  await persistSessionEvent(event);

  return { session: updatedSession, events: [event] };
}

export async function deletePiSession(
  sessionId: string,
): Promise<PiSessionDeleteResult> {
  const record = sessions.get(sessionId);
  if (record) {
    record.agentSession.abort();
    record.agentSession.dispose();
    record.eventUnsubscriber();
    sessions.delete(sessionId);
  }

  const event: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Deleted,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: { sessionId },
  };
  emitToFrontend(event);
  await persistSessionEvent(event);

  return { events: [event] };
}

export async function toolRespondPiSession(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
): Promise<PiSessionToolRespondResult> {
  // Tool approval is handled by the native tool executor in Rust.
  // The approval is sent via a separate Tauri command that updates
  // the NativeToolApprovals state.
  // AgentSession handles the response automatically through the
  // tool execution callback mechanism.

  const result = await invoke<{ session: PiSession; events: PiSessionEvent[] }>(
    "pi_session_tool_respond",
    { sessionId, toolCallId, approved },
  );

  for (const event of result.events) {
    emitToFrontend(event);
  }

  return result;
}
```

### 7.6 `EventMapper` — new file

**Path:** `src/modules/pi/lib/event-mapper.ts`

**Purpose:** Maps pi SDK `AgentEvent` types to Terax's existing `PiSessionEvent` types. This is the translation layer between the two event systems.

**Spec:**

```typescript
/**
 * Maps pi SDK AgentEvent types to Terax PiSessionEvent types.
 *
 * The pi SDK emits events through AgentSession.subscribe().
 * These need to be translated to Terax's PiSessionEvent format
 * and emitted via Tauri's event bus so the frontend React
 * hooks (usePiSessionEventStream) can process them.
 *
 * See Section 9 for the full mapping table.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiSession, PiSessionEvent } from "./sessions/types";
import { PI_SESSION_EVENT } from "./sessions/events";
import { v4 as uuid } from "./uuid";

export function mapAgentSessionEventToPiEvent(
  rawEvent: any,  // AgentEvent from pi SDK
  sessionId: string,
  piSession: PiSession,
): PiSessionEvent[] {
  switch (rawEvent.type) {
    case "message_update": {
      const msg = rawEvent.message;
      if (msg.role !== "assistant" || !msg.content) return [];

      const events: PiSessionEvent[] = [];
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i];
        if (block.type === "text" && block.text) {
          events.push({
            id: uuid(),
            type: PI_SESSION_EVENT.OutputDelta,
            sessionId,
            createdAt: new Date().toISOString(),
            payload: { text: block.text },
          });
        }
      }
      return events;
    }

    case "tool_execution_start":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.ToolStart,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          toolName: rawEvent.toolName,
          toolCallId: rawEvent.toolCallId,
          input: rawEvent.args,
        },
      }];

    case "tool_execution_end":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.ToolResult,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          toolName: rawEvent.toolName,
          toolCallId: rawEvent.toolCallId,
          output: {
            content: typeof rawEvent.result === "string"
              ? rawEvent.result
              : JSON.stringify(rawEvent.result),
            details: rawEvent.result,
          },
          isError: rawEvent.isError,
        },
      }];

    case "agent_end":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.OutputText,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          text: rawEvent.messages
            .filter((m: any) => m.role === "assistant")
            .map((m: any) => m.content?.map((c: any) => c.type === "text" ? c.text : "").join("") ?? "")
            .join(""),
        },
      }, {
        id: uuid(),
        type: PI_SESSION_EVENT.Status,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: { status: "idle" },
      }];

    case "agent_error":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.Error,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: { message: rawEvent.error?.message ?? String(rawEvent.error) },
      }];

    case "agent_retry":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.Progress,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          text: `Retrying (attempt ${rawEvent.attempt}): ${rawEvent.error?.message}`,
        },
      }];

    default:
      return [];
  }
}
```

---

## 8. Rust Side: New `pi_native_tool` Command

### Problem

Currently, native tool execution only works through the sidecar path. When the sidecar receives a tool call from pi SDK, it sends a JSON-RPC request (`method: "nativeTools.execute"`) back to Rust, which executes and responds. In the new architecture, there is no sidecar. The webview calls Rust directly via Tauri invoke.

### Solution

Add a new Tauri command `pi_native_tool` that wraps the existing `execute_verified_native_tool_with_policy` dispatch. This command has the same logic as the current sidecar bridge handler but is accessible directly from the webview.

### Tauri Command Signature

```rust
/// Receives native tool execution requests from the webview AgentSession.
///
/// This is the single entry point for all tool executions in the new architecture.
/// It performs the same verification, policy, and audit steps as the sidecar path.
///
/// Called via invoke("pi_native_tool", { request: NativeToolRequest })
#[tauri::command]
pub fn pi_native_tool(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    request: NativeToolRequest,
) -> Result<NativeToolResult, String> {
    // 1. Build the native tool context with current runtime backends
    let native_tool_context = build_native_tool_context(
        &app, &artifacts_state, &mcp_state,
    )?;

    // 2. Track tool sessions (register on first tool call for a session)
    // In the sidecar path, sessions were registered on create/resume.
    // In the webview path, we lazily register on first tool call.
    let native_tool_sessions = state.tool_sessions();  // RwLock<HashMap>
    let native_tool_approvals = state.tool_approvals(); // NativeToolApprovals
    let capability_audit = state.capability_audit();    // CapabilityAuditLog

    // 3. Execute with full verification + policy + audit
    execute_verified_native_tool_with_policy(
        &native_tool_sessions,
        &native_tool_approvals,
        &capability_audit,
        request,
        &native_tool_context,
    )
    .map_err(|error| error.to_string())
}
```

### What needs to change in PiState

The current `PiState` holds `Option<Arc<PiHost>>` for the sidecar. After the sidecar is removed, `PiState` no longer manages host lifecycle. Instead, it becomes a lightweight holder for:

```rust
pub struct PiState {
    // Native tool session registry (session_id -> { cwd, workspace_env })
    tool_sessions: Arc<RwLock<HashMap<String, NativeToolSession>>>,
    // Tool approval state
    tool_approvals: NativeToolApprovals,
    // Capability audit log (ring buffer)
    capability_audit: CapabilityAuditLog,
    // History path for pi-sessions.json
    history_path: Mutex<Option<PathBuf>>,
}
```

### NativeToolRequest (from webview)

Matches the existing Rust type:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolRequest {
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub cwd: String,
    #[serde(default)]
    pub workspace_env: Option<WorkspaceEnv>,
    #[serde(default)]
    pub approval: Option<NativeToolApprovalMetadata>,
    #[serde(default)]
    pub input: Value,
}
```

### NativeToolResult (returned to webview)

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolResult {
    pub content: Vec<NativeToolContent>,
    pub details: Value,
}

#[derive(Debug, Serialize)]
pub struct NativeToolContent {
    #[serde(rename = "type")]
    pub kind: &'static str,  // always "text"
    pub text: String,
}
```

### Tool Registration

The webview AgentSession also needs to register sessions with Rust's tool session registry. After `createAgentSession` returns, the webview should call:

```rust
// New Tauri command — registers a session for native tool access
#[tauri::command]
pub fn pi_native_tool_register_session(
    state: tauri::State<'_, PiState>,
    session_id: String,
    cwd: String,
    workspace_env: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&cwd)
        .map_err(|e| format!("cwd is not accessible: {e}"))?;
    let mut sessions = state.tool_sessions.write()
        .map_err(|e| format!("lock failed: {e}"))?;
    sessions.insert(session_id, NativeToolSession {
        cwd: canonical,
        workspace_env: workspace_env.unwrap_or_default(),
    });
    Ok(())
}

#[tauri::command]
pub fn pi_native_tool_unregister_session(
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.tool_sessions.write()
        .map_err(|e| format!("lock failed: {e}"))?;
    sessions.remove(&session_id);
    Ok(())
}
```

This replaces what `PiHost::remember_native_tool_session` and `PiHost::forget_native_tool_session` did during sidecar session create/resume/delete.

---

## 9. Event Bridge: AgentSession Events to PiSessionEvent Types

This table maps every pi SDK `AgentEvent` to the corresponding `PiSessionEvent`.

| AgentEvent type | AgentEvent fields | PiSessionEvent type | PiSessionEvent payload |
|----------------|-------------------|--------------------|----------------------|
| `message_update` | `message { role, content[] }` where content block.type = "text" | `session.output.delta` | `{ text: block.text }` (per content block) |
| `message_update` | `message { role, content[] }` where content block has thinking | `session.reasoning.delta` | `{ text: reasoning_text }` (if available) |
| `tool_execution_start` | `toolName, toolCallId, args` | `session.tool.start` | `{ toolName, toolCallId, input }` |
| `tool_execution_end` | `toolName, toolCallId, result, isError` | `session.tool.result` | `{ toolName, toolCallId, output: { content, details }, isError }` |
| `agent_end` | `messages[]` (full message list) | `session.output.text` | `{ text: concatenated assistant text }` |
| `agent_end` | — | `session.status` | `{ status: "idle" }` |
| `agent_error` | `error { message }` | `session.error` | `{ message }` |
| `agent_retry` | `attempt, error` | `session.progress` | `{ text: "Retrying (attempt N): ..." }` |
| `compaction_start` | — | `session.progress` | `{ text: "Compacting conversation..." }` |
| `compaction_end` | `oldLength, newLength` | `session.progress` | `{ text: "Compacted ${oldLength} → ${newLength} messages" }` |

**Not mapped (handled at a higher level by the wrapper):**
- `session.created` — emitted once by `createPiSession()` after AgentSession is created
- `session.input` — emitted once by `sendToPiSession()` when prompt starts
- `session.status` "running" — emitted by `sendToPiSession()` before calling `agentSession.prompt()`
- `session.tool.approval.requested` / `.responded` — tool approval is handled by Rust's `NativeToolApprovals` and the existing `pi_session_tool_respond` command

### Implementation in EventMapper

```typescript
export function mapAgentSessionEventToPiEvent(
  rawEvent: any,
  sessionId: string,
  piSession: PiSession,
): PiSessionEvent[] {
  switch (rawEvent.type) {
    case "message_update": { /* ... see Section 7.6 ... */ }
    case "tool_execution_start": { /* ... */ }
    case "tool_execution_end": { /* ... */ }
    case "agent_end": { /* ... */ }
    case "agent_error": { /* ... */ }
    case "agent_retry": { /* ... */ }
    case "compaction_start":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.Progress,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: { text: "Compacting conversation..." },
      }];
    case "compaction_end":
      return [{
        id: uuid(),
        type: PI_SESSION_EVENT.Progress,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          text: `Compacted ${rawEvent.oldLength} to ${rawEvent.newLength} messages.`,
        },
      }];
    default:
      return [];
  }
}
```

---

## 10. Session Lifecycle

### Creating a Session

```
Frontend call: pi_session_create(title, cwd, providerConfig)

Existing Rust command stays. But instead of creating a sidecar session,
the frontend flow changes:

Old flow:
  invoke("pi_session_create") → Rust → sidecar JSON-RPC "sessions.create"

New flow:
  createPiSession(title, cwd, providerConfig)   [in webview]
    → pi.createAgentSession({...})
    → invoke("pi_native_tool_register_session", { sessionId, cwd })
    → create PiSession metadata
    → emit "session.created" PiSessionEvent
    → persist to pi-sessions.json

The Rust command "pi_session_create" can be simplified to just
register the session in the tool sessions registry:
```

**Note:** The existing `pi_session_create` Rust command can be kept for backward compatibility during migration, but its implementation changes from "send JSON-RPC to sidecar" to "register session in tool sessions registry and persist metadata." After full migration, the frontend no longer calls `pi_session_create` — it uses `createPiSession()` directly.

### Sending a Prompt

```
Frontend call: pi_session_send(sessionId, promptText, context, options)

Old flow:
  invoke("pi_session_send") → Rust → sidecar JSON-RPC "sessions.send"
    → sidecar calls agentSession.prompt()
    → sidecar forwards events to stdout → Rust → Tauri emit

New flow:
  sendToPiSession(sessionId, promptText, options)
    → emit "session.input" PiSessionEvent
    → emit "session.status" (running) PiSessionEvent
    → agentSession.prompt(promptText)
        → AgentSession emits events via subscribe callback
        → EventMapper converts to PiSessionEvent
        → emit to frontend + persist
    → on completion (agent_end event):
        → emit "session.output.text" + "session.status" (idle)

Note: AgentSession handles retry, compaction, and branching internally.
The webview doesn't need to manage message history or retry logic.
```

### Resuming a Session

```
Frontend call: pi_session_resume(sessionId, providerConfig)

For resumption, pi's SessionManager needs to know the session file path.
The session file path is stored in pi-sessions.json as sdkSessionFile.

Old flow:
  invoke("pi_session_resume") → Rust → sidecar JSON-RPC "sessions.resume"
    → sidecar loads session file → restores messages → streams events

New flow:
  Load session metadata from pi-sessions.json (via invoke("pi_sessions_history"))
  Look up sdkSessionFile for the given sessionId
  → createPiSession({ sessionFile: sdkSessionFile, ...same as new session... })
    → AgentSession loads messages from JSONL file
    → invoke("pi_native_tool_register_session", { sessionId, cwd })
    → emit "session.resumed" PiSessionEvent

Note: The AgentSession's sessionFile parameter tells it which JSONL file
to load for message history. This file was originally created by
AgentSession when the session was first created.
```

### Stopping a Session

```
Frontend call: pi_session_stop(sessionId)

Old flow:
  invoke("pi_session_stop") → Rust → sidecar JSON-RPC "sessions.stop"
    → sidecar calls agentSession.abort()

New flow:
  stopPiSession(sessionId)
    → agentSession.abort()
    → emit "session.status" (stopped) PiSessionEvent
    → persist

AgentSession handles abort gracefully — it cancels the current LLM request
and emits an agent_end or agent_error event, which we catch and translate.
```

### Deleting a Session

```
Frontend call: pi_session_delete(sessionId)

Old flow:
  invoke("pi_session_delete") → Rust → sidecar JSON-RPC "sessions.delete"

New flow:
  deletePiSession(sessionId)
    → agentSession.abort()
    → agentSession.dispose()  // clean up resources
    → invoke("pi_native_tool_unregister_session", { sessionId })
    → emit "session.deleted" PiSessionEvent
    → persist
    → remove from in-memory sessions Map
```

### Renaming a Session

```
Frontend call: pi_session_rename(sessionId, title)

Old flow:
  invoke("pi_session_rename") → Rust → sidecar JSON-RPC "sessions.rename"

New flow:
  renamePiSession(sessionId, title)
    → agentSession.setSessionName(title)
    → emit "session.renamed" PiSessionEvent
    → persist
```

---

## 11. Tool Manifest and Registration

### How Tools Work in AgentSession

When `createAgentSession` is called, pi constructs a tool manifest from multiple sources:

1. **Pi's built-in tools** (read, write, edit, bash, grep, find, ls, etc.) — defined in pi-agent-core
2. **Custom tool factories** — from `extensionFactories` parameter
3. **Extension-discovered tools** — from `DefaultResourceLoader.getExtensions()`
4. **Capability manifest** — from `DefaultResourceLoader`, which reads the agent's capability configuration

The `nativeToolExecutor` callback intercepts ALL tool executions — both pi's built-in tools and extension tools. Every tool call goes through Rust's mediation layer.

### Tool Exclusion Strategy

Pi's built-in tool implementations run in-process (they use Node.js-like APIs for file system and shell access). In the webview, these implementations would fail because:

- They use Node.js `fs` module (not available in browser)
- They use `child_process` for bash (not available)
- They don't know about Terax's workspace authorization

**Solution:** The `nativeToolExecutor` intercepts all tool calls. Pi's built-in tool implementations may attempt to run, but the `nativeToolExecutor` is called BEFORE the built-in implementation, and the result returned by `nativeToolExecutor` is used instead of the built-in one.

Actually, looking at pi's SDK architecture: when `nativeToolExecutor` is provided, pi's built-in tool execution is bypassed entirely for tools that match the executor's route. The native executor is the authoritative implementation.

### Tool Names

The current Rust dispatch matches these tool names:

| Tool Name | Rust Handler | Capability Policy |
|-----------|-------------|-------------------|
| `read` | `fs_tools::execute_read` | Auto |
| `ls` | `fs_tools::execute_ls` | Auto |
| `grep` | `fs_tools::execute_grep` | Auto |
| `find` | `fs_tools::execute_find` | Auto |
| `bash` | `fs_tools::execute_bash` | Ask |
| `edit` | `fs_tools::execute_edit` | Ask |
| `write` | `fs_tools::execute_write` | Ask |
| `create_artifact` | `artifact_tools::execute_create_artifact` | Auto |
| `edit_artifact` | `artifact_tools::execute_edit_artifact` | Auto |
| `read_artifact` | `artifact_tools::execute_read_artifact` | Auto |
| `list_artifacts` | `artifact_tools::execute_list_artifacts` | Auto |
| `mcp__*` | `mcp_tools::execute_mcp_tool` | Per MCP config |

These names must match what `AgentSession` registers. Pi's default tool names may differ (e.g., `read_file` vs `read`). The `nativeToolExecutor` receives the tool name from pi's tool registry. If names differ, either:

1. **Option A:** Register custom tools with our names via `extensionFactories`, overriding pi's defaults
2. **Option B:** Map pi's default names to our names in the `teraxToolExecutor`
3. **Option C:** Rename Rust handlers to match pi's default names

**Recommendation: Option B** — keep the Rust dispatch unchanged, add a name map in `teraxToolExecutor`:

```typescript
const TOOL_NAME_MAP: Record<string, string> = {
  "Read": "read",
  "Write": "write",
  "Edit": "edit",
  "Bash": "bash",
  "Grep": "grep",
  "Glob": "find",
  "ListDirectory": "ls",
  // pi-agent-core uses capitalized names in its tool definitions
};

export async function teraxToolExecutor(request: TeraxToolRequest): Promise<TeraxToolResult> {
  const mappedName = TOOL_NAME_MAP[request.toolName] ?? request.toolName;
  return invoke("pi_native_tool", {
    request: { ...request, toolName: mappedName },
  });
}
```

**Important:** Verify pi's actual tool names at implementation time by reading pi-agent-core's tool definitions. The names may differ from those listed above.

---

## 12. Authentication and Provider Config

### Current flow

Terax stores API keys in the OS keychain via the `keyring` crate. The frontend reads/writes through `secrets_*` Tauri commands. Provider configuration (which provider, which model, base URL) is managed by the settings store.

In the existing pi-session-bridge, `pi-env.ts` resolves API keys by calling `invoke("secrets_get")` and passes them to `getModel()`.

### New flow

Pi's `AuthStorage` manages API keys. We provide a `KeychainAuthAdapter` (see Section 7.1) that reads/writes through the OS keychain. Pi's `ModelRegistry` then reads models from these credentials.

**Provisioning:** When the user configures a provider in Terax settings, the frontend writes the API key to the keychain via `invoke("secrets_set")`. On session creation, `AuthStorage.create(keychainBackend)` reads these keys via `invoke("secrets_get")`.

```typescript
// Provider config from settings → keychain
async function saveApiKey(provider: string, key: string): Promise<void> {
  await invoke("secrets_set", {
    service: "terax-ai",
    key: provider,
    value: key,
  });
}

// Keychain → pi AuthStorage (automatic via keychainBackend)
const authStorage = AuthStorage.create(keychainAuthBackend);
```

### Model Selection

Pi's `ModelRegistry` lists available models across configured providers. The user selects a model in the settings or composer. On session creation, the selected model is passed to `createAgentSession` via the model registry.

```typescript
// Current: providerConfig comes from settings
// { provider: "anthropic", modelId: "claude-sonnet-4-20250514", baseUrl?: "..." }
// →
// Pi ModelRegistry handles provider routing internally.
// The model is set on the AgentSession after creation:
const result = await createAgentSession({...});
result.session.setModel(provider, modelId);
```

### OAuth Flows

Pi's `AuthStorage.login()` handles browser-based OAuth for Claude Pro/Max and OpenAI Codex. It opens a browser window, handles the redirect, and stores the resulting tokens. No changes needed — `AuthStorage.create(keychainBackend)` stores OAuth tokens in the keychain automatically.

### Provider Config Migration

The existing `provider_config.rs` and `provider.ts` define 13+ providers with Terax-specific settings (base URL, thinking level, context limits). These should continue to feed into pi's model registry. The provider config UI stays unchanged — it writes to the keychain, and pi reads from the keychain through the adapter.

---

## 13. Extension, Skill, and Prompt Discovery

### Current

Terax has:
- `skill.rs` (Rust) — scans directories for SKILL.md files
- `pi-skills.ts` (webview) — resolves skill files and builds system prompt
- No extension or prompt template support

### New

`DefaultResourceLoader` auto-discovers everything from standard pi directories:

```
~/.pi/agent/
  ├── extensions/        → pi extensions (tool registration, event hooks)
  │   ├── my-extension/
  │   │   ├── index.js
  │   │   └── package.json
  │   └── ...
  ├── skills/            → reusable skill files
  │   ├── my-skill/
  │   │   └── SKILL.md
  │   └── ...
  ├── prompts/           → prompt templates
  │   ├── review.md
  │   └── ...
  └── themes/            → color themes
      └── ...
```

Project-local `.pi/` directories are also discovered:

```
<workspace>/.pi/
  ├── extensions/
  ├── skills/
  └── prompts/
```

The `DefaultResourceLoader` constructor takes `cwd` and `agentDir` and handles discovery automatically.

### Extension Compatibility Concern

Pi extensions that use Node.js-specific APIs (`fs`, `child_process`, `path`, `os`) will fail in the webview because these modules are not available in the browser. Zosma's sidecar avoids this by running in Node.js.

**Mitigation:** Most pi extensions use only the SDK extension API (registering tools, handling events, providing UI components). These work fine in the browser. Extensions that directly access the file system (like custom editor extensions or file watchers) will not work. This is acceptable — Terax provides filesystem access through its Rust layer, which is more secure.

The `noExtensions: true` flag + `extensionFactories` parameter can be used to selectively load only vetted extensions if compatibility becomes an issue.

### Skills

Pi's `loadSourcedSkills` from `@earendil-works/pi-agent-core` discovers SKILL.md files and returns parsed skill metadata. `formatSkillsForSystemPrompt` formats them for inclusion in the system prompt.

Replace Terax's current `skill.rs` and `pi-skills.ts` with pi's built-in functions.

### Prompt Templates

Pi's `loadPromptTemplates` from pi-agent-core discovers prompt template markdown files. These can be used with `formatPromptTemplateInvocation` to expand `#handle` references in the composer.

---

## 14. MCP Integration Strategy

### Current Architecture

Terax has a comprehensive MCP system:
- Rust owns all MCP connections (`McpState`, stdio/HTTP clients)
- MCP tools are discovered and registered in Rust
- Frontend queries MCP tools via `piNative.mcpTools()`
- Tool execution routes through Rust: `mcp__<server>__<tool>` → `McpState::call_tool()`
- Binary MCP results are stored as artifacts
- Per-tool approval policies are managed via settings UI

### New Architecture

Pi's `DefaultResourceLoader` also discovers MCP servers from `~/.pi/agent/mcp.json`. This creates a potential conflict where both systems discover different MCP servers.

**Decision:** Only Terax's MCP system is authoritative. Pi's MCP discovery is suppressed or the discovered servers are merged with Terax's config.

```typescript
// Option A: Suppress pi's MCP discovery by not exposing mcp.json from agentDir
// This requires no changes — just don't put mcp.json in the pi agent directory.

// Option B: Merge — read Terax's MCP servers and register them in pi's format
// This is more complex and not recommended initially.
```

The `nativeToolExecutor` routes `mcp__*` tools through Rust's `McpState`. This is already implemented in `native_tools/mcp_tools.rs` and doesn't change.

---

## 15. Session Persistence (Two-File Approach)

### Terax: `pi-sessions.json`

**Location:** `<app_data_dir>/pi-sessions.json`

**Contents:** Array of `PiSession` objects + recent events. Used by the UI sidebar for listing sessions, showing titles, status, and timestamps.

**Format (existing, unchanged):**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "title": "Refactor auth module",
      "cwd": "/Users/me/projects/my-app",
      "status": "idle",
      "createdAt": "2026-06-10T10:00:00.000Z",
      "updatedAt": "2026-06-10T11:30:00.000Z",
      "lastPrompt": "Refactor the auth middleware",
      "sdkSessionFile": "/.../pi-sdk-sessions/session-uuid.jsonl",
      "workspaceEnv": "Local"
    }
  ],
  "events": [ /* recent PiSessionEvents, max 500 */ ]
}
```

**Managed by:** `src-tauri/src/modules/pi/store.rs` (unchanged)
**Updated by:** `SessionFileAdapter` via `invoke("pi_store_record_session", ...)`

### Pi: JSONL session file

**Location:** `<app_data_dir>/pi-sdk-sessions/<sessionId>.jsonl`

**Contents:** Full message history in pi's JSONL format. Used by `AgentSession` for resumption (restoring message history when a session is reopened).

**Format** (pi SDK internal, one JSON object per line):

```jsonl
{"role":"user","content":[{"type":"text","text":"Hello"}]}
{"role":"assistant","content":[{"type":"text","text":"Hi! How can I help?"}]}
```

**Managed by:** `AgentSession` (when `sessionFile` option is provided)
**Created at:** Session creation by `createAgentSession({ sessionFile: ... })`
**Updated at:** After each prompt completion by `AgentSession` internally

### Bridge Between the Two

The `sdkSessionFile` field in `pi-sessions.json` links the metadata to the message history. When a session is resumed:

1. Frontend reads session metadata from `pi-sessions.json` (via existing `pi_sessions_history` or `pi_sessions_list`)
2. Frontend calls `createPiSession({ sessionFile: sdkSessionFile })` with the path from metadata
3. pi's `AgentSession` loads messages from the JSONL file

When a session is created for the first time:

1. `createPiSession()` determines the session file path: `<app_data_dir>/pi-sdk-sessions/<sessionId>.jsonl`
2. Passes `sessionFile: sessionFilePath` to `createAgentSession()`
3. On create, stores the session file path in `sdkSessionField` via `persistSessionEvent()`

---

## 16. Files to Delete

### Sidecar (entire directory)

```
sidecars/pi-host/
├── host.js              — Main sidecar entry point
├── protocol.js          — JSON-RPC protocol handler
├── sessions.js          — Session state machine (create, send, resume, etc.)
├── session-events.js    — Event types and emission
├── session-approvals.js — Tool approval queue
├── package.json         — Sidecar dependencies
├── package.test.js
├── protocol-schema.js   — Protocol validation schema
├── model-catalog.js     — Model listing
├── steering.js           — Steering/follow-up commands
├── extract-chat-messages.js
├── settings-store.js
├── auth-seed.js
├── event-bus.js
├── command-queue.js
├── prompt-scheduler.js
├── remote-server.js
├── extension-manager.js
├── disk-extension-loader.js
├── native-tools.js       — Tool definitions (not used in new arch)
├── google-calendar/
├── google-auth/
├── office-docs/
├── vendor/
└── dist/                — Built sidecar (463 MB node_modules)
```

**Total:** ~5000+ lines of TypeScript/JavaScript, 463 MB node_modules

### Rust host management

```
src-tauri/src/modules/pi/host/
├── mod.rs (or host.rs)   — PiHost struct, spawn, call, shutdown, lifecycle
├── bridge.rs             — stdin/stdout reader threads, host request handler
├── protocol.rs           — JSON-RPC types, PendingResponses, NativeToolApprovals, StderrTail
├── paths.rs              — Node binary + host script resolution
├── timeouts.rs           — Per-method request timeout config
├── tests.rs              — Host integration tests
```

**Total:** ~1500 lines of Rust

### Webview bridge (replaced by adapters)

```
src/modules/pi/bridge/
├── pi-session.ts         — createTauriAgent() — replaced by createAgentSession
├── pi-tools.ts           — Hand-built tool definitions — replaced by nativeToolExecutor
├── pi-env.ts             — API key resolution — replaced by KeychainAuthAdapter
├── pi-http.ts            — Fetch proxy — handled internally by pi-ai
├── pi-skills.ts          — Skill loading — replaced by pi's loadSourcedSkills
├── index.ts              — USE_WEBVIEW_AGENT flag — no longer needed
└── stubs/
    ├── crypto.ts
    ├── empty.ts
    ├── fs-stub.ts
    ├── os.ts
    └── url.ts
```

**Total:** ~2000 lines of TypeScript

### Webview session management (replaced by agent-session-wrapper)

```
src/modules/pi/lib/webview-session.ts    — Replaced by agent-session-wrapper.ts
src/modules/pi/lib/pi-session-backend.ts — Single path, no routing needed
```

**Total:** ~1000 lines of TypeScript

### Other sidecar dependencies

```
sidecars/node/     — Standalone Node.js binary bundled for sidecar (entire directory)
```

---

## 17. Files That Stay Unchanged

### Frontend UI Components

```
src/modules/pi/
├── PiChatPanel.tsx                    — Main chat panel (uses PiSessionBackend, unchanged interface)
├── PiPanel.tsx                        — Pi side panel container
├── PiComposer.tsx                     — Message composer/input
├── PiTranscript.tsx                   — Message transcript display
├── PiSection.tsx                      — Collapsible section
├── PiPanelHeader.tsx                  — Panel header
├── PiPanelSupportingSections.tsx      — Support section toggles
├── PiContextBar.tsx                   — Context indicators
├── PiDestructiveActionDialog.tsx      — Confirmation dialogs
├── PiFloatingWindow.tsx              — Floating window support
├── PiNotificationsBridge.tsx          — Notification bridge
├── components/
│   ├── PiCapabilityAuditCard.tsx      — Capability audit display
│   ├── PiDiagnosticsCard.tsx          — Diagnostics display
│   ├── PiLocalAgentsCard.tsx          — Local agent status
│   ├── PiMcpCard.tsx                  — MCP server status
│   ├── PiMcpConfig.tsx               — MCP configuration
│   ├── PiMcpConfigEditor.tsx         — MCP config editor
│   ├── PiMcpOAuthDialog.tsx          — MCP OAuth dialog
│   ├── PiMcpRows.tsx                 — MCP tool rows
│   ├── PiRuntimeCard.tsx             — Runtime status
│   ├── PiSkillsCard.tsx              — Skills display
│   ├── PiSessionList.tsx             — Session list sidebar
│   └── classes.ts                    — CSS classes
```

### State Management

```
src/modules/pi/lib/
├── PiControllerProvider.tsx           — Root provider (provides PiSessionBackend to React tree)
├── provider.ts                        — Provider config types and resolution
├── panel-state.ts                     — Panel UI state
├── lifecycle.ts                       — Pi module lifecycle
├── status.ts                          — Status snapshot types
├── diagnostics.ts                     — Diagnostics types
├── view.ts                            — View state
├── native.ts                          — piNative IPC wrapper (mcp, diagnostics, etc.)
├── notifications.ts                   — Notification handling
├── errors.ts                          — Error types
├── chatArtifacts.ts                   — Chat artifact types
├── local-agents.ts                    — Local agent detection
├── model-options.ts                   — Model selection options
├── useMcpSurface.ts                   — MCP UI hooks
├── useCopyToClipboard.ts              — Clipboard hook
├── usePiLocalAgentLaunch.ts           — Local agent launch
├── usePiLocalAgentsPanel.ts           — Local agent panel
├── usePiPanelRefreshers.ts            — Panel refresh hooks
├── usePiProviderConfig.ts             — Provider config hooks
├── usePiProviderKeyStatus.ts          — Key status hooks
├── usePiRuntimeActions.ts             — Runtime action hooks
├── usePiSessionEventStream.ts         — Event stream hook (listens for pi:session-event)
├── panel-defaults.ts                  — Default panel state
├── panel-refresh.ts                   — Panel refresh logic
```

### Session Types and Events

```
src/modules/pi/lib/sessions/
├── types.ts                           — PiSession, PiSessionEvent types (unchanged)
├── events.ts                          — PI_SESSION_EVENT enum (unchanged)
├── merge.ts                           — Event merge logic (unchanged)
├── transcript.ts                      — Transcript building (unchanged)
```

### Rust Infrastructure

```
src-tauri/src/modules/pi/
├── native_tools.rs                    — Tool dispatch (unchanged)
├── native_tools/fs_tools.rs           — File tool implementations (unchanged)
├── native_tools/artifact_tools.rs     — Artifact tool implementations (unchanged)
├── native_tools/mcp_tools.rs          — MCP tool routing (unchanged)
├── store.rs                           — Session history persistence (unchanged)
├── provider_config.rs                 — Provider configuration (unchanged)
├── skills.rs                          — Skill file discovery (can be removed later, keep for now)
├── local_agents.rs                    — Local agent detection (unchanged)
├── types.rs                           — Pi types (unchanged, may add NativeToolRequest if needed)
├── state.rs                           — PiState struct (SIMPLIFIED — remove PiHost, keep registries)
├── state/compat.rs                    — Backward compatibility (unchanged)
├── state/requests.rs                  — Session request types (unchanged)
├── tests.rs                           — Module tests (unchanged)
├── mod.rs                             — Module registration (SIMPLIFIED — remove host commands)
```

```
src-tauri/src/modules/
├── capabilities/                      — Policy, audit, approval (unchanged)
├── artifacts/                         — Artifact storage, compilation (unchanged)
├── mcp/                               — MCP connections, tool registry (unchanged)
├── workspace/                         — Workspace authorization (unchanged)
├── secrets/                           — Keychain access (unchanged)
├── shell/                             — Shell execution (unchanged)
├── pty/                               — PTY sessions (unchanged)
├── git/                               — Git operations (unchanged)
├── fs/                                — File system operations (unchanged)
└── net/                               — Network/HTTP proxy (unchanged)
```

---

## 18. Files to Modify (Not Delete)

| File | Change |
|------|--------|
| `src-tauri/src/modules/pi/mod.rs` | Remove sidecar commands (`pi_start`, `pi_stop`, `pi_host_info`, `pi_diagnostics`). Add `pi_native_tool`, `pi_native_tool_register_session`, `pi_native_tool_unregister_session`. Keep session CRUD commands (they now operate on registries, not sidecar). |
| `src-tauri/src/modules/pi/state.rs` | Remove `PiHost` lifecycle. Replace with `tool_sessions: Arc<RwLock<HashMap<...>>>`, `tool_approvals`, `capability_audit`. Simplify `PiState` from host manager to lightweight registry holder. |
| `src-tauri/src/modules/pi/store.rs` | Ensure `pi_store_record_session` and `pi_store_record_events` commands are accessible without PiHost running. They currently depend on the event sink from running host — make them standalone. |
| `src-tauri/src/lib.rs` | Remove sidecar-related pi commands from invoke handler. Add `pi_native_tool` and related commands. |
| `src-tauri/tauri.conf.json` | Remove `"../sidecars/pi-host/dist": "sidecars/pi-host"` and `"../sidecars/node/dist": "sidecars/node"` from resources. Update `beforeBuildCommand` to remove `pnpm build:sidecars`. |
| `pnpm-workspace.yaml` | If sidecar has its own package entry, remove it. |
| `package.json` | If sidecar build scripts exist, remove them. |
| `src/modules/pi/lib/provider.ts` | May need minor adjustments to pass provider config to pi's ModelRegistry format. |
| `src/modules/pi/lib/native.ts` | Add `mcpTools()` and `mcpCallTool()` if not already present (needed by MCP in new flow). |
| `src/modules/pi/PiChatPanel.context.tsx` | May need to wrap `createAgentSession` calls in provider if async setup is required. |
| `src/modules/pi/lib/PiControllerProvider.tsx` | May need to initialize the pi resource loader on app mount. |

---

## 19. Migration Phases

### Phase 1: Build (side-by-side, no visible changes)

**Goal:** Create the new architecture alongside the existing one. No deletions yet. Everything still works as before.

1. **Add direct dependency** on `@earendil-works/pi-coding-agent` (verify it's in package.json, add if hoisting doesn't resolve)

2. **Create 6 new adapter files** (these don't affect existing code):
   - `src/modules/pi/lib/keychain-auth-adapter.ts`
   - `src/modules/pi/lib/terax-tool-bridge.ts`
   - `src/modules/pi/lib/terax-system-prompt.ts`
   - `src/modules/pi/lib/session-file-adapter.ts`
   - `src/modules/pi/lib/event-mapper.ts`
   - `src/modules/pi/lib/agent-session-wrapper.ts`

3. **Add `pi_native_tool` Rust command** in `src-tauri/src/modules/pi/mod.rs`:
   ```rust
   #[tauri::command]
   pub fn pi_native_tool(
       app: AppHandle,
       state: tauri::State<'_, PiState>,
       mcp_state: tauri::State<'_, Arc<McpState>>,
       artifacts_state: tauri::State<'_, ArtifactsState>,
       request: NativeToolRequest,
   ) -> Result<NativeToolResult, String> { ... }
   ```
   Register it in `lib.rs`.

4. **Add `pi_native_tool_register_session` / `pi_native_tool_unregister_session`** Rust commands.

5. **Simplify `PiState`** to hold `tool_sessions`, `tool_approvals`, `capability_audit` instead of `PiHost`.

6. **Verify compilation:** `pnpm exec tsc --noEmit`, `cd src-tauri && cargo clippy`

**Tests:**
- Unit test `KeychainAuthAdapter` (mock invoke)
- Unit test `EventMapper` with sample AgentEvent data
- Unit test `TeraxSystemPrompt` with mock skills
- Unit test `TeraxToolBridge` (mock invoke)

### Phase 2: Enable (parallel to existing)

**Goal:** Route session operations through the new path behind a feature flag.

7. **Change `USE_FULL_SDK_SESSION` flag** from false to true in a config:
   ```typescript
   // In a new config file (not bridge/index.ts which will be deleted)
   export const USE_FULL_SDK_SESSION = true; // set to true to enable
   ```

8. **Create a router** analogous to the current `pi-session-backend.ts`:
   ```typescript
   function getSessionBackend(): PiSessionBackend {
     return USE_FULL_SDK_SESSION
       ? newFullSdkBackend   // uses agent-session-wrapper.ts
       : existingBackend;    // uses sidecar or webview bridge
   }
   ```

9. **Test systematically:**
   - Session creation → verify PiSessionEvent.Created emitted
   - Send prompt → verify streaming events (output.delta, tool.start, tool.result)
   - Tool execution → verify Rust tool dispatch is called (check audit log)
   - Session stop → verify agent.abort() works
   - Session resume → verify AgentSession loads from session file
   - Session list → verify sessions appear in sidebar
   - Session delete → verify cleanup
   - Multiple sessions → verify isolation
   - Extension loading → verify DefaultResourceLoader discovers from ~/.pi/agent/
   - Skill discovery → verify skills appear in system prompt

### Phase 3: Delete

**Goal:** Remove all sidecar and old bridge code.

10. Delete `sidecars/pi-host/` entire directory
11. Delete `sidecars/node/` entire directory
12. Delete `src/modules/pi/bridge/` entire directory
13. Delete `src/modules/pi/lib/webview-session.ts`
14. Delete `src/modules/pi/lib/pi-session-backend.ts`
15. Delete `src-tauri/src/modules/pi/host/` entire directory
16. Remove from `mod.rs`: `mod host;`, `use host::*;`
17. Remove from `lib.rs`: sidecar pi commands (`pi_start`, `pi_stop`, `pi_host_info`, `pi_diagnostics`)
18. Remove from `tauri.conf.json`: sidecar resource entries
19. Remove from `package.json`: sidecar build scripts
20. Remove `USE_WEBVIEW_AGENT` flag — there is only one path now
21. Ensure `buildTeraxSystemPrompt` doesn't depend on any deleted file

### Phase 4: Polish

**Goal:** Clean up, profile, and harden.

22. **Remove unused Rust code:**
    - Remove `host/timeouts.rs` (no more sidecar timeouts)
    - Remove `host/paths.rs` (no more binary resolution)
    - Remove `host/protocol.rs` (no more JSON-RPC types)
    - Clean up unused imports in `native_tools.rs`, `state.rs`, `mod.rs`

23. **Add test coverage for** `agent-session-wrapper.ts`:
    - Test session lifecycle (create, send, stop, delete)
    - Test event mapping with real AgentEvent types
    - Test error handling (network failure, rate limit, abort)

24. **Profile:**
    - Measure webview JS heap before/after (expect +5-15 MB)
    - Measure cold-start session creation time
    - Measure prompt send latency vs sidecar path

25. **Document:**
    - Update `CONTEXT.md` and `TERAX.md` to reflect the new architecture

---

## 20. Size and Performance Impact

### Binary Size

| Component | Before | After | Delta |
|-----------|--------|-------|-------|
| Bundled Node.js binary | ~45 MB | 0 | -45 MB |
| Sidecar node_modules | ~463 MB | 0 | -463 MB (development only, not in release) |
| Sidecar JS source | ~100 KB | 0 | -100 KB |
| Rust host management | ~1500 lines | ~200 lines (shim) | -1300 lines |
| Webview bridge | ~2000 lines | ~300 lines (adapters) | -1700 lines |
| Webview session mgmt | ~1000 lines | ~200 lines (wrapper) | -800 lines |
| Extra tree-shaken pi SDK | ~13 MB npm | ~200-400 KB bundle | +200-400 KB |

**Net effect on release binary:** The sidecar's Node.js binary (~45 MB) was already bundled into the Tauri resource directory. Removing it saves ~45 MB. The extra pi SDK code added to the webview bundle is ~200-400 KB. **Final app size ~7-8 MB, no significant change.**

### Performance

| Metric | Sidecar | Webview (new) | Improvement |
|--------|---------|---------------|-------------|
| Cold-start session creation | ~500ms (spawn node + load + ping + init) | ~50ms (code already loaded) | ~10x faster |
| Prompt send latency | ~5ms IPC round-trip | ~0ms (in-process) | Eliminated IPC hop |
| Tool execution latency | ~2ms IPC round-trip to Rust | ~1ms direct invoke | Marginally faster |
| Memory (idle) | ~30 MB Node.js process + ~5 MB JS heap | ~10-15 MB total JS heap | Less total |
| Memory (active) | ~30 MB Node.js + ~20 MB JS heap | ~25-35 MB JS heap | Comparable |

---

## 21. Error Handling and Edge Cases

### Concurrent Sends

The AgentSession is single-threaded — calling `agentSession.prompt()` while another prompt is active will throw. The wrapper checks `agentSession.isStreaming` before sending:

```typescript
if (agentSession.isStreaming) {
  return { accepted: false, session: piSession, events: [] };
}
```

The frontend should disable the send button while `isStreaming` is true.

### Abort During Tool Execution

When the user clicks "stop", `agentSession.abort()` is called. This:

1. Aborts the current LLM request (signal passed through streamFn)
2. If a tool was mid-execution in Rust, it may still complete — the result is discarded
3. AgentSession emits `agent_end` (possibly with a truncated message list)
4. Our EventMapper emits a "stopped" status event

### Rate Limits

AgentSession has built-in `autoRetryEnabled` that handles 429/503 responses automatically. It retries with exponential backoff. The current manual retry logic in `webview-session.ts` is no longer needed.

### Extension Load Failures

If an extension fails to load (Node.js API, parse error), `DefaultResourceLoader` collects the error silently and continues loading other extensions. Errors are available via `resourceLoader.getExtensions().errors`. The SessionFileAdapter logs these but does not fail session creation.

### Network Failures

Pi's `streamSimple` handles network errors and returns them as `agent_error` events. The EventMapper converts these to `session.error` PiSessionEvents. If auto-retry is enabled, AgentSession retries before emitting the error.

### Tool Approval Policy

If the capability policy requires approval (Ask policy) and the user hasn't approved:
- Rust returns `CapabilityPolicyError::ApprovalRequired`
- The `nativeToolExecutor` (TeraxToolBridge) throws
- The AgentSession receives the error
- The frontend should show the approval dialog via the existing `pi_session_tool_respond` mechanism

Actually, tool approval requires more thought. In the sidecar architecture:
1. AgentSession fires `session.tool.approval.requested` event
2. Rust records the pending approval in `NativeToolApprovals`
3. Frontend shows approval UI
4. User approves → `pi_session_tool_respond` → Rust records approved → AgentSession proceeds

In the webview architecture, this flow needs the `nativeToolExecutor` to check approval state before executing:

```typescript
// In agent-session-wrapper.ts
export async function sendToPiSession(sessionId: string, promptText: string, ...) {
  // Before calling agentSession.prompt(), register a higher-order nativeToolExecutor
  // that checks approval:
  const wrappedExecutor = async (request: TeraxToolRequest) => {
    const result = await invoke("pi_native_tool", { request });
    
    // If the result indicates approval required, emit ToolApprovalRequested
    // and wait for user response before retrying
    if (result.details?.approvalRequired) {
      const approved = await waitForUserApproval(sessionId, request.toolCallId);
      if (!approved) {
        return { content: [{ type: "text", text: "Tool execution denied by user." }], details: { denied: true } };
      }
      // Retry with approval
      return invoke("pi_native_tool", { request: { ...request, approval: { approved: true } } });
    }
    
    return result;
  };
  
  // ... agentSession.prompt with the wrapped executor
}
```

**Edge case:** The `nativeToolExecutor` is set once at session creation time. If the approval state changes (user approves mid-stream), the executor needs access to the up-to-date approval state. Use a shared `Ref` or closure:

```typescript
const approvalStateRef = { current: new Map<string, boolean>() };

const executor = async (request) => {
  const key = `${request.sessionId}:${request.toolCallId}`;
  const preapproved = approvalStateRef.current.get(key);
  if (preapproved !== undefined) {
    approvalStateRef.current.delete(key);
    request.approval = { approved: preapproved };
  }
  return invoke("pi_native_tool", { request });
};
```

### Session File Cleanup

When a session is deleted, the JSONL session file on disk should also be deleted. This is handled in `deletePiSession()` by calling `agentSession.dispose()` and optionally removing the file:

```typescript
export async function deletePiSession(sessionId: string) {
  // ... abort + dispose
  // Optionally clean up the session file:
  try {
    const sessionFile = record.agentSession.sessionFile;
    if (sessionFile) {
      await invoke("fs_delete_file", { path: sessionFile });
    }
  } catch { /* non-fatal */ }
}
```

### Multiple Windows

Tauri currently has a single window. If multi-window support is added, each window would have its own AgentSession instances. The Rust tool session registry is shared (global), so tool verification works across windows. Each window manages its own sessions Map.

---

## 22. Testing Strategy

### Phase 1 Tests (unit, no sidecar needed)

| Test | File | What to verify |
|------|------|----------------|
| KeychainAuthAdapter | `keychain-auth-adapter.test.ts` | get/set/delete call correct invoke commands |
| EventMapper | `event-mapper.test.ts` | Each AgentEvent type maps to correct PiSessionEvent |
| TeraxSystemPrompt | `terax-system-prompt.test.ts` | System prompt includes TERAX.md, date, cwd, skills |
| TeraxToolBridge | `terax-tool-bridge.test.ts` | Invoke is called with correct params |
| Rust pi_native_tool | `native_tools/tests.rs` | Tool dispatch works without sidecar |

### Phase 2 Tests (integration, full stack)

| Test | Scope | What to verify |
|------|-------|----------------|
| Session creation | Frontend → wrapper → pi SDK | PiSessionEvent.Created emitted, session in sidebar |
| Send prompt | Frontend → wrapper → AgentSession → Rust | Streaming events flow, tool results return |
| Tool approval | AgentSession → Rust policy → approval gate | Approved tools execute, denied tools return error |
| Session resume | Wrapper → AgentSession from file | Messages restored, session continues |
| Multiple sessions | Wrapper | Sessions isolated, tool sessions registered separately |
| Extension loading | DefaultResourceLoader | Extensions from ~/.pi/agent/ discovered and available |
| MCP tool execution | AgentSession → Rust MCP | MCP tools routed through McpState |

### Phase 3 Tests (regression, old vs new)

| Test | Scope | What to verify |
|------|-------|----------------|
| All session operations | Side-by-side | Old path and new path produce same PiSessionEvents |
| Tool execution | Side-by-side | Same tool results from both paths |
| Session persistence | Side-by-side | pi-sessions.json updated identically |

---

## 23. Comparison Table: Zosma vs Terax Proposed

| Aspect | Zosma Cowork | Terax (current) | Terax (proposed) |
|--------|-------------|-----------------|-------------------|
| Agent process | Node.js sidecar | JSON-RPC sidecar OR webview bridge | Webview (pi SDK) |
| Tool execution | Sidecar → Rust relay | Hand-built in TS OR Rust dispatch | Rust dispatch (unchanged) |
| Pi SDK usage | Full (createAgentSession) | Partial (raw Agent) | Full (createAgentSession) |
| Extensions | DefaultResourceLoader | None | DefaultResourceLoader |
| Skills | DefaultResourceLoader | Custom skills.rs + pi-skills.ts | Pi's loadSourcedSkills |
| MCP | Via sidecar proxy | Rust McpState (good) | Rust McpState (unchanged) |
| Auth | File-based auth.json | OS keychain | OS keychain (via adapter) |
| OAuth | AuthStorage handles | Not supported | AuthStorage handles |
| Workspace auth | None | Rust workspace registry (good) | Rust workspace registry (unchanged) |
| Capability policy | None | Auto/Ask/Deny (good) | Auto/Ask/Deny (unchanged) |
| Audit log | None | CapabilityAuditLog (good) | CapabilityAuditLog (unchanged) |
| Binary content | Relay via Rust | Artifact store (good) | Artifact store (unchanged) |
| Context compaction | Pi SDK internal | Hand-rolled in webview | Pi SDK internal |
| Branching | Pi SDK | Hand-rolled | Pi SDK |
| Steering | Pi SDK | Not supported | Pi SDK |
| Sub-agents | Pi SDK | Not supported | Pi SDK |
| Auto-retry | Pi SDK | Not supported | Pi SDK |
| Startup latency | ~500ms (spawn) | ~500ms (spawn) OR instant | Instant |
| Bundle size | ~100 MB (with Node) | ~7-8 MB | ~7-8 MB (no change) |
| Sidecar complexity | ~2800 lines TS | ~1500 lines Rust + ~2000 lines TS | None |

**Key insight:** Terax's proposed architecture takes the best of both worlds. It uses the full pi SDK (like Zosma) for the agent runtime. It keeps its Rust security mediation layer (unlike Zosma) for workspace authorization and audit. And it eliminates the sidecar (unlike Zosma) by running pi in the webview, keeping the binary small.

---

## 24. Open Questions and Mitigations

### Q1: AgentSession memory in webview

**Concern:** Pi's `AgentSession` holds the full message history and tool registry in JS heap memory. For sessions with hundreds of messages, this could be 5-15 MB.

**Mitigation:** Pi's auto-compaction reduces memory by summarizing old messages. Test with a session of 200+ messages and measure JS heap. If memory is excessive, increase compaction frequency or reduce `reserveTokens` in compaction settings.

### Q2: Browser compatibility of provider SDKs

**Concern:** pi-ai bundles `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`. These may use Node.js APIs (like `stream`) that don't work in the browser.

**Mitigation:** `@anthropic-ai/sdk` and `openai` have browser builds. Verify each provider's SDK works in Tauri's webview (which is based on WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux). If a provider fails, fall back to using Terax's current HTTP proxy (`ai_http_request` / `ai_http_stream`) for that provider.

### Q3: Pi SDK version compatibility

**Concern:** The pi SDK is actively developed. Breaking changes in `createAgentSession`'s API could require updates.

**Mitigation:** Pin the pi SDK version in package.json. The adapters abstract the pi SDK API — most changes would only affect `agent-session-wrapper.ts`. Monitor pi releases for breaking changes.

### Q4: Extensions with Node.js APIs

**Concern:** Pi extensions that use `fs`, `child_process`, or other Node.js modules will fail in the webview.

**Mitigation:** Set `noExtensions: false` (allow discovery) but log errors for individual extension failures. Most extensions use only the SDK extension API (tool registration, event hooks), which works in the browser. If specific popular extensions need Node.js, consider running them in a Web Worker or small helper process.

### Q5: Session file format compatibility

**Concern:** Pi's JSONL session format may change between SDK versions, and Terax's `pi-sessions.json` references `sdkSessionFile` paths that may become invalid.

**Mitigation:** The `SessionManager.inMemory()` creates sessions without persistence. The `sessionFile` parameter tells AgentSession where to persist. If the format changes, old session files may not be resumable. Mitigated by pinning the SDK version and testing session resumption after SDK updates.

### Q6: Concurrent session limits

**Concern:** Running multiple AgentSession instances in the webview could exhaust memory.

**Mitigation:** Limit active sessions to a reasonable number (e.g., 5 concurrent). Older sessions are disposed when the limit is reached. Sessions can still be listed in the sidebar and re-created on click (loading from their session file).

### Q7: DefaultResourceLoader initialization time

**Concern:** `DefaultResourceLoader.reload()` scans the filesystem for extensions, skills, prompts, and themes. On first load with a large pi agent directory (~/.pi/agent/), this could take 100-500ms.

**Mitigation:** Initialize the resource loader once at app startup (when the Pi module is first opened), not on every session creation. Cache the loaded extensions for reuse across sessions.

---

## Appendix A: Key Source Files Reference

### For the Implementor

These are the most important files to read before implementing:

| File | Why |
|------|-----|
| `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` | Pi SDK type declarations for createAgentSession, AuthStorage, etc. |
| `node_modules/@earendil-works/pi-agent-core/dist/index.d.ts` | Agent, AgentEvent, AgentSession types |
| `node_modules/@earendil-works/pi-ai/dist/index.d.ts` | Provider SDK integration, getModel, streamSimple |
| `src/modules/pi/lib/sessions/types.ts` | Existing PiSession, PiSessionEvent types (must preserve) |
| `src/modules/pi/lib/sessions/events.ts` | PI_SESSION_EVENT enum (must preserve) |
| `src/modules/pi/lib/usePiSessionEventStream.ts` | Frontend event listener (must keep working) |
| `src/modules/pi/lib/pi-session-backend.ts` | Current routing logic (replace) |
| `src/modules/pi/lib/webview-session.ts` | Current webview session management (replace) |
| `src/modules/pi/bridge/pi-session.ts` | Current agent construction (replace) |
| `src/modules/pi/bridge/pi-tools.ts` | Current tool definitions (replace) |
| `src-tauri/src/modules/pi/mod.rs` | Rust command registration (modify) |
| `src-tauri/src/modules/pi/native_tools.rs` | Tool dispatch (keep, add pi_native_tool command) |
| `src-tauri/src/modules/pi/host/bridge.rs` | Sidecar bridge logic (extract tool verification for reuse) |
| `src-tauri/src/modules/pi/state.rs` | PiState struct (simplify) |
| `src-tauri/src/modules/pi/store.rs` | Session persistence (keep, ensure standalone) |

### New Files to Create

All under `src/modules/pi/lib/`:

```
src/modules/pi/lib/
├── keychain-auth-adapter.ts       — AuthStorageBackend → OS keychain
├── terax-tool-bridge.ts           — nativeToolExecutor → Tauri invoke
├── terax-system-prompt.ts         — Build system prompt from TERAX.md + skills
├── session-file-adapter.ts        — AgentSession events → pi-sessions.json
├── event-mapper.ts                — AgentEvent → PiSessionEvent mapping
└── agent-session-wrapper.ts       — Main orchestration: createPiSession, sendToPiSession, etc.
```

---

## 25. Resolved Design Issues (Critical Implementation Details)

### 25.1 System Prompt: Async → Sync Bridging

**Problem:** `DefaultResourceLoader` and `createAgentSession` accept `systemPromptOverride` as a **sync** function `() => string`, but `buildTeraxSystemPrompt()` is **async** (reads TERAX.md via Tauri IPC, loads skills via `loadSourcedSkills`).

**Solution:** Precompute the system prompt before calling `createAgentSession`. Use a cached value, not a function reference.

```typescript
// In agent-session-wrapper.ts:

// Cache for the system prompt (computed once per workspace)
let cachedSystemPrompt: string | null = null;
let cachedCwd: string | null = null;

async function getOrBuildSystemPrompt(cwd: string): Promise<string> {
  if (cachedSystemPrompt !== null && cachedCwd === cwd) {
    return cachedSystemPrompt;
  }
  cachedSystemPrompt = await buildTeraxSystemPrompt(cwd);
  cachedCwd = cwd;
  return cachedSystemPrompt;
}

// In createPiSession():
const systemPrompt = await getOrBuildSystemPrompt(workingDir);

// Then pass a sync closure that returns the cached value:
const result = await createAgentSession({
  // ...
  systemPromptOverride: () => systemPrompt,  // sync — returns cached string
});
```

**Why cached:** The system prompt only changes when the workspace changes (i.e., user opens a different project). Within a session, it's constant. Cache invalidation happens on workspace switch.

**Alternative for dynamic prompts:** If the system prompt needs to change mid-session (e.g., user adds a skill), use `appendSystemPromptOverride`:

```typescript
// DefaultResourceLoader also supports:
appendSystemPromptOverride: () => {
  return ["Additional instructions..."];
}
```

### 25.2 sendToPiSession: Missing Input and Status Events

The current `sendToPiSession` stub in Section 7.5 does not emit `session.input` or `session.status(

"running"`) events. Before calling `agentSession.prompt()`, the wrapper must emit these so the frontend shows the prompt and the "running" indicator:

```typescript
export async function sendToPiSession(
  sessionId: string,
  promptText: string,
  options?: {
    thinkingLevel?: string;
    regenerateBranchGroupId?: string;
  },
): Promise<PiSessionSendResult> {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);
  const { agentSession } = record;

  if (agentSession.isStreaming) {
    return { accepted: false, session: record.piSession, events: [] };
  }

  // ── Emit input event ──
  const inputEvent: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Input,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: { text: promptText },
  };
  emitToFrontend(inputEvent);
  persistSessionEvent(inputEvent);

  // ── Emit status "running" event ──
  const statusEvent: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.Status,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: { status: "running" },
  };
  emitToFrontend(statusEvent);
  persistSessionEvent(statusEvent);

  if (options?.thinkingLevel) {
    agentSession.setThinkingLevel(options.thinkingLevel);
  }

  try {
    await agentSession.prompt(promptText);
  } catch (error) {
    // Errors are emitted as agent_error events by AgentSession
  }

  const updatedSession = { ...record.piSession, status: "idle" as const, lastPrompt: promptText, updatedAt: new Date().toISOString() };
  record.piSession = updatedSession;
  return { accepted: true, session: updatedSession, events: [] };
}
```

### 25.3 createPiSession: Session Resumption Support

The `createPiSession` function in Section 7.5 does not accept a `sessionFile` parameter for resumption. Add it:

```typescript
export async function createPiSession(options: {
  title?: string;
  cwd?: string | null;
  providerConfig?: { provider: string; modelId: string; baseUrl?: string; thinkingLevel?: string } | null;
  sessionFile?: string | null;  // For resumption — points to AgentSession JSONL file
}): Promise<PiSessionCreateResult> {
  const {
    title,
    cwd,
    providerConfig,
    sessionFile,
  } = options;
  
  const sessionId = uuid();
  let sessionIdForResume = sessionId;

  // If resuming, use the existing session ID from the metadata
  // The sessionFile path encodes the session UUID in its name
  if (sessionFile) {
    const match = sessionFile.match(/([a-f0-9-]+)\.jsonl$/);
    if (match) sessionIdForResume = match[1];
  }

  // For resumption: sessionIdForResume is the original session UUID
  // This ensures pi-sessions.json and the JSONL file stay linked
  
  // ... same createAgentSession logic ...
  
  // Pass sessionFile to AgentSession for persistence:
  const result = await createAgentSession({
    // ...
    sessionFile: sessionFile ?? getDefaultSessionFilePath(sessionId),
  });
  
  // For resumed sessions, use the original ID:
  const effectiveId = sessionFile ? sessionIdForResume : sessionId;
  const piSession: PiSession = {
    id: effectiveId,
    title: title ?? "Resumed session",
    // ...
    sdkSessionFile: sessionFile ?? getDefaultSessionFilePath(sessionId),
  };
}
```

**Session file path convention:**

```typescript
function getDefaultSessionFilePath(sessionId: string): string {
  // Use the Tauri app data dir, not a user-visible path
  // The pi SDK resolves relative paths against cwd
  return `pi-sdk-sessions/${sessionId}.jsonl`;
}
```

### 25.4 Tool Approval End-to-End Flow

**Problem:** In the sidecar architecture, tool approval works through a side channel:
1. Sidecar requests tool execution → Rust returns "ApprovalRequired" → sidecar emits `ToolApprovalRequested` event → frontend shows dialog → user approves → Rust records approval → sidecar retries the tool
2. In the webview architecture, the AgentSession calls `nativeToolExecutor` which calls `invoke("pi_native_tool", request)`. If Rust requires approval, it needs to block and wait.

**Solution:** Use a two-phase approach where the `nativeToolExecutor` checks approval state in a shared Ref:

```typescript
// In agent-session-wrapper.ts — shared state for tool approvals

interface ApprovalState {
  pendingApprovals: Map<string, ApprovalPromise>;
}

interface ApprovalPromise {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

// Global registry shared across all sessions
const pendingApprovals = new Map<string, ApprovalPromise>();

// Called by teraxToolExecutor when Rust returns ApprovalRequired
function waitForUserApproval(sessionId: string, toolCallId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const key = `${sessionId}:${toolCallId}`;
    pendingApprovals.set(key, { resolve, reject });
    
    // Emit the approval requested event so the frontend shows a dialog
    const event: PiSessionEvent = {
      id: uuid(),
      type: PI_SESSION_EVENT.ToolApprovalRequested,
      sessionId,
      createdAt: new Date().toISOString(),
      payload: { toolCallId, sessionId },
    };
    emitToFrontend(event);
    persistSessionEvent(event);
    
    // Timeout: auto-deny after 30 seconds
    setTimeout(() => {
      const p = pendingApprovals.get(key);
      if (p) {
        pendingApprovals.delete(key);
        p.resolve(false);  // timeout = deny
      }
    }, 30_000);
  });
}

// Called by toolRespondPiSession when user approves or denies
export async function toolRespondPiSession(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
): Promise<PiSessionToolRespondResult> {
  const key = `${sessionId}:${toolCallId}`;
  const p = pendingApprovals.get(key);
  if (p) {
    pendingApprovals.delete(key);
    p.resolve(approved);
  }
  
  // Also invoke the Rust side to record the approval
  await invoke("pi_session_tool_respond", { sessionId, toolCallId, approved });
  
  const event: PiSessionEvent = {
    id: uuid(),
    type: PI_SESSION_EVENT.ToolApprovalResponded,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: { toolCallId, approved },
  };
  emitToFrontend(event);
  persistSessionEvent(event);
  
  return { events: [event] };
}
```

Then the `teraxToolExecutor` uses this approval gate:

```typescript
// In terax-tool-bridge.ts
import { pendingApprovals } from "./agent-session-wrapper";

export async function teraxToolExecutor(request: TeraxToolRequest): Promise<TeraxToolResult> {
  // First attempt without approval
  try {
    return await invoke<TeraxToolResult>("pi_native_tool", { request });
  } catch (error: any) {
    // Check if the error indicates approval required
    if (error?.approvalRequired) {
      // Wait for user approval
      const approved = await waitForUserApproval(request.sessionId, request.toolCallId);
      if (!approved) {
        return {
          content: [{ type: "text", text: "Tool execution denied by user." }],
          details: { denied: true },
        };
      }
      // Retry with approval flag
      return invoke<TeraxToolResult>("pi_native_tool", {
        request: {
          ...request,
          approval: { approved: true, policy: "ask" },
        },
      });
    }
    throw error;
  }
}
```

**Important:** The `nativeToolExecutor` is called from within `agentSession.prompt()`. If it blocks waiting for user approval, the entire prompt() is suspended. This is acceptable because `prompt()` is already async and the event loop handles other work. The user sees the approval dialog, approves, and the executor resumes.

---

## 26. Rust Implementation Details: pi_native_tool Command

### 26.1 Full Command Implementation

The `pi_native_tool` command reuses the same `execute_verified_native_tool_with_policy` function that the sidecar bridge uses. This function is defined in `host/bridge.rs`. After Phase 3 deletion, it should be extracted to a shared location like `native_tools/mod.rs` or `native_tools/dispatch.rs`.

```rust
// src-tauri/src/modules/pi/native_tools.rs — add this function

/// Execute a verified native tool with capability policy checking.
///
/// This function was originally only reachable through the sidecar bridge.
/// Now it's also reachable directly from the webview via the pi_native_tool
/// Tauri command.
///
/// Steps:
/// 1. Verify the session has a registered native tool context
/// 2. Canonicalize and verify the CWD
/// 3. Check capability policy (Auto/Ask/Deny)
/// 4. If Deny → return CapabilityPolicyError
/// 5. If Ask without approval → return ApprovalRequired
/// 6. Execute the tool against the appropriate backend
/// 7. Record audit entry
/// 8. Return result
pub fn execute_verified_native_tool_with_policy(
    sessions: &HashMap<String, NativeToolSession>,
    approvals: &NativeToolApprovals,
    audit: &CapabilityAuditLog,
    request: NativeToolRequest,
    context: &NativeToolContext,
) -> Result<NativeToolResult, ToolError> {
    // Step 1: Find the session's native tool context
    let session = sessions.get(&request.session_id)
        .ok_or(ToolError::SessionNotFound(request.session_id.clone()))?;

    // Step 2: Verify canonical CWD matches the authorized workspace
    let canonical_cwd = std::fs::canonicalize(&request.cwd)
        .map_err(|e| ToolError::InvalidCwd(request.cwd.clone(), e.to_string()))?;
    if canonical_cwd != session.cwd {
        // Also allow subdirectories of the authorized CWD
        if !canonical_cwd.starts_with(&session.cwd) {
            return Err(ToolError::CwdMismatch {
                expected: session.cwd.display().to_string(),
                got: canonical_cwd.display().to_string(),
            });
        }
    }

    // Step 3: Check capability policy
    let effective_cwd = canonical_cwd.clone();
    let policy_eval = context.capability_policy.evaluate(
        &request.tool_name,
        &request.cwd,
    );

    // Step 4: Deny
    if policy_eval == PolicyDecision::Deny {
        let entry = CapabilityAuditEntry::new(
            &request.session_id,
            &request.tool_name,
            &request.cwd,
            PolicyOutcome::Denied,
        );
        audit.record(entry);
        return Err(ToolError::CapabilityPolicyError("denied".into()));
    }

    // Step 5: Approval check
    if policy_eval == PolicyDecision::Ask && !request_has_approval(&request) {
        let approval_key = NativeToolApprovalKey::new(
            &request.session_id,
            &request.tool_call_id,
        );
        // Record the pending approval
        approvals.record_pending(approval_key, &request);
        
        let entry = CapabilityAuditEntry::new(
            &request.session_id,
            &request.tool_name,
            &request.cwd,
            PolicyOutcome::ApprovalRequested,
        );
        audit.record(entry);
        
        return Err(ToolError::ApprovalRequired);
    }

    // Step 6: Execute the tool
    let result = execute_with_context(
        &request,
        &NativeToolExecutionCtx {
            cwd: &effective_cwd,
            workspace_env: &session.workspace_env,
            artifacts: &context.artifacts,
            mcp: &context.mcp,
        },
    )?;

    // Step 7: Audit
    let outcome = if policy_eval == PolicyDecision::Ask {
        PolicyOutcome::Approved
    } else {
        PolicyOutcome::Auto
    };
    let entry = CapabilityAuditEntry::new(
        &request.session_id,
        &request.tool_name,
        &request.cwd,
        outcome,
    );
    audit.record(entry);

    Ok(result)
}
```

### 26.2 NativeToolSession Type

```rust
// src-tauri/src/modules/pi/types.rs

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct NativeToolSession {
    /// Canonical (absolute, resolved) working directory
    pub cwd: PathBuf,
    /// Optional workspace environment configuration
    pub workspace_env: WorkspaceEnv,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnv {
    pub distro: Option<String>,
    // Other fields as defined in the existing type
}
```

### 26.3 NativeToolApprovals (reused, unchanged)

The existing `NativeToolApprovals` struct manages pending tool approvals. It should remain in `native_tools.rs` or be extracted to a shared module. Key methods reused from the sidecar:

```rust
// Key methods on NativeToolApprovals (already exist in the codebase)
impl NativeToolApprovals {
    pub fn record_pending(&self, key: NativeToolApprovalKey, request: &NativeToolRequest);
    pub fn is_approved(&self, session_id: &str, tool_call_id: &str) -> bool;
    pub fn mark_responded(&self, session_id: &str, tool_call_id: &str, approved: bool);
    pub fn clear_pending(&self, session_id: &str);
}
```

### 26.4 ToolError Type

```rust
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("Session {0} not found in native tool registry")]
    SessionNotFound(String),

    #[error("Invalid CWD {0}: {1}")]
    InvalidCwd(String, String),

    #[error("CWD mismatch: expected {expected}, got {got}")]
    CwdMismatch { expected: String, got: String },

    #[error("Capability policy: {0}")]
    CapabilityPolicyError(String),

    #[error("Tool requires user approval")]
    ApprovalRequired,

    #[error("Execution failed: {0}")]
    ExecutionError(String),
}
```

### 26.5 PiState Simplification (from state.rs)

```rust
// src-tauri/src/modules/pi/state.rs — simplified PiState

use std::sync::{Arc, RwLock};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct PiState {
    /// Native tool session registry — session_id → authorized workspace
    pub tool_sessions: Arc<RwLock<HashMap<String, NativeToolSession>>>,
    
    /// Tool approval state — pending and completed approvals
    pub tool_approvals: NativeToolApprovals,
    
    /// Capability audit log
    pub capability_audit: CapabilityAuditLog,
    
    /// Path to pi-sessions.json for history persistence
    pub history_path: Mutex<Option<PathBuf>>,
}

impl PiState {
    pub fn new(history_path: Option<PathBuf>) -> Self {
        Self {
            tool_sessions: Arc::new(RwLock::new(HashMap::new())),
            tool_approvals: NativeToolApprovals::new(),
            capability_audit: CapabilityAuditLog::new(1000),
            history_path: Mutex::new(history_path),
        }
    }

    /// Register a session for native tool access
    pub fn register_session(&self, session_id: &str, cwd: &PathBuf, workspace_env: Option<WorkspaceEnv>) -> Result<(), String> {
        let canonical = std::fs::canonicalize(cwd)
            .map_err(|e| format!("cwd is not accessible: {e}"))?;
        let mut sessions = self.tool_sessions.write()
            .map_err(|e| format!("lock failed: {e}"))?;
        sessions.insert(session_id.to_string(), NativeToolSession {
            cwd: canonical,
            workspace_env: workspace_env.unwrap_or_default(),
        });
        Ok(())
    }

    /// Unregister a session
    pub fn unregister_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.tool_sessions.write()
            .map_err(|e| format!("lock failed: {e}"))?;
        sessions.remove(session_id);
        // Also clean up any pending approvals
        self.tool_approvals.clear_pending(session_id);
        Ok(())
    }
}
```

### 26.6 mod.rs — Command Registration

The existing `mod.rs` exports Tauri commands. After simplification, it registers the new commands instead of the sidecar commands:

```rust
// src-tauri/src/modules/pi/mod.rs

use tauri::Manager;

pub fn register_commands(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Create PiState (no PiHost needed)
    let pi_state = PiState::new(
        app.path().app_data_dir().map(|p| p.join("pi-sessions.json"))
    );

    app.manage(pi_state);

    // Register commands
    Ok(())
}

// Commands registered in lib.rs:
// - pi_native_tool (new)
// - pi_native_tool_register_session (new)
// - pi_native_tool_unregister_session (new)
// - pi_store_record_session (existing, unchanged)
// - pi_store_record_events (existing, unchanged)
// - pi_sessions_history (existing, unchanged)
//
// NOT registered (deleted):
// - pi_start (sidecar lifecycle)
// - pi_stop (sidecar lifecycle)
// - pi_host_info (sidecar diagnostics)
// - pi_diagnostics (sidecar diagnostics)
```

### 26.7 store.rs — Making It Standalone

The existing `store.rs` likely depends on `PiHost` for recording events (it may send events through the sidecar). It needs to be made standalone:

```rust
// src-tauri/src/modules/pi/store.rs — extracted to work without PiHost

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use std::sync::Mutex;

const MAX_EVENTS: usize = 500;

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionStore {
    pub sessions: Vec<StoredSession>,
    pub events: Vec<StoredEvent>,
}

// ... existing types for StoredSession, StoredEvent ...

pub struct SessionPersistence {
    path: PathBuf,
    data: Mutex<SessionStore>,
}

impl SessionPersistence {
    pub fn new(path: PathBuf) -> Self {
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<SessionStore>(&s).ok())
            .unwrap_or(SessionStore {
                sessions: vec![],
                events: vec![],
            });
        
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn record_session(&self, session: &PiSession, events: &[PiSessionEvent]) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|e| e.to_string())?;
        
        // Upsert session
        if let Some(existing) = data.sessions.iter_mut().find(|s| s.id == session.id) {
            *existing = session_to_stored(session);
        } else {
            data.sessions.push(session_to_stored(session));
        }

        // Append events, cap at MAX_EVENTS
        for event in events {
            data.events.push(event_to_stored(event));
        }
        if data.events.len() > MAX_EVENTS {
            data.events.drain(0..data.events.len() - MAX_EVENTS);
        }

        // Write atomically
        let tmp = self.path.with_extension("tmp");
        let json = serde_json::to_string(&*data).map_err(|e| e.to_string())?;
        fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        
        Ok(())
    }

    pub fn record_events(&self, events: &[PiSessionEvent]) -> Result<(), String> {
        // Same as above but only appends events, no session upsert
        // ...
    }
}

// Tauri commands:
#[tauri::command]
pub fn pi_store_record_session(
    state: tauri::State<'_, PiState>,
    store: tauri::State<'_, Arc<SessionPersistence>>,
    session: PiSession,
    events: Vec<PiSessionEvent>,
) -> Result<(), String> {
    store.record_session(&session, &events)
}

#[tauri::command]
pub fn pi_store_record_events(
    store: tauri::State<'_, Arc<SessionPersistence>>,
    events: Vec<PiSessionEvent>,
) -> Result<(), String> {
    store.record_events(&events)
}
```

---

## 27. Frontend Integration: PiControllerProvider and Backend Interface

### 27.1 PiSessionBackend Interface (unchanged)

The frontend uses a `PiSessionBackend` interface. The existing `pi-session-backend.ts` provides this. The new wrapper must implement the same interface:

```typescript
// From src/modules/pi/lib/sessions/types.ts (existing)

interface PiSessionBackend {
  create(title?: string, cwd?: string | null, providerConfig?: ProviderConfig | null): Promise<PiSessionCreateResult>;
  send(sessionId: string, promptText: string, context?: { thinkingLevel?: string; regenerateBranchGroupId?: string }): Promise<PiSessionSendResult>;
  stop(sessionId: string): Promise<PiSessionStopResult>;
  resume(sessionId: string, providerConfig?: ProviderConfig | null): Promise<PiSessionResumeResult>;
  rename(sessionId: string, title: string): Promise<PiSessionRenameResult>;
  delete(sessionId: string): Promise<PiSessionDeleteResult>;
  toolRespond(sessionId: string, toolCallId: string, approved: boolean): Promise<PiSessionToolRespondResult>;
  getHistory?(): Promise<PiSessionHistoryResult>;
}
```

The new `agent-session-wrapper.ts` exports functions that the backend dispatches to. The router in Phase 2 chooses between old and new:

```typescript
// In a new pi-session-backend.ts (Phase 2+)

import * as newBackend from "./agent-session-wrapper";

const USE_FULL_SDK_SESSION = true; // feature flag

export const piSessionBackend: PiSessionBackend = {
  async create(title, cwd, providerConfig) {
    if (USE_FULL_SDK_SESSION) {
      return newBackend.createPiSession({ title, cwd, providerConfig });
    }
    // fall back to old sidecar/webview path
  },
  async send(sessionId, promptText, context) {
    if (USE_FULL_SDK_SESSION) {
      return newBackend.sendToPiSession(sessionId, promptText, context);
    }
    // fall back
  },
  // ... etc for all methods
};
```

### 27.2 PiControllerProvider Initialization

The `PiControllerProvider` mounts at the root of the Pi panel. It provides the backend to all child components. The provider may need an async initialization phase:

```typescript
// In PiControllerProvider.tsx — variations for new architecture

// The provider currently creates the backend synchronously from imports.
// For the new architecture, it may need:
// 1. Initialize DefaultResourceLoader (cached)
// 2. No PiHost spawn needed
// 3. Session backend is just imported functions

export function PiControllerProvider({ children }: { children: React.ReactNode }) {
  // No async initialization needed for new backend
  // The backend functions work immediately — they spin up
  // createAgentSession on demand
  
  return (
    <PiControllerContext.Provider value={/* backend */}>
      {children}
    </PiControllerContext.Provider>
  );
}
```

### 27.3 Event Stream — No Changes Needed

The frontend listens for `pi:session-event` via `usePiSessionEventStream.ts`. This hook uses `listen("pi:session-event", ...)` from Tauri's event system. In the new architecture, events are still emitted via `emit("pi:session-event", event)` from the webview. The frontend doesn't need changes.

**Important:** Verify that `emit()` from `@tauri-apps/api/event` works within the webview to emit events to the same window. Tauri's `emit` function can emit events to the current window (not just to the Rust backend). If it doesn't, use `window.dispatchEvent(new CustomEvent("pi:session-event", { detail: event }))` as a fallback, or use a Zustand store as an event bus.

---

## 28. Rust Command Changes in lib.rs

The `lib.rs` file registers Tauri commands. Here's the diff:

```rust
// Before (current):
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // ... other commands ...
            
            // Pi sidecar commands (to be removed):
            pi_start,
            pi_stop,
            pi_host_info,
            pi_diagnostics,
            
            // Pi session commands (keep):
            pi_session_create,
            pi_session_send,
            pi_session_stop,
            pi_session_resume,
            pi_session_rename,
            pi_session_delete,
            pi_session_tool_respond,
            pi_session_list,
            
            // Pi store commands (keep):
            pi_store_record_session,
            pi_store_record_events,
            pi_sessions_history,
            
            // Secrets commands (keep):
            secrets_get,
            secrets_set,
            secrets_delete,
        ])
        .setup(|app| {
            // Start PiHost if configured
            let pi_state = PiState::new();
            pi_state.start_host(app.handle())?; // spawning sidecar
            app.manage(pi_state);
            Ok(())
        })
        .run(tauri::generate_context!());
}

// After (simplified):
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // ... other commands ...
            
            // REMOVED: pi_start, pi_stop, pi_host_info, pi_diagnostics
            
            // NEW native tool commands:
            pi_native_tool,
            pi_native_tool_register_session,
            pi_native_tool_unregister_session,
            
            // Pi session commands (keep for now, frontend will stop calling
            // some of these after migration):
            pi_session_create,   // simplified — no sidecar
            pi_session_send,     // simplified — no sidecar
            pi_session_stop,     // simplified — no sidecar
            pi_session_resume,   // simplified — no sidecar
            pi_session_rename,   // simplified — no sidecar
            pi_session_delete,   // simplified — no sidecar
            pi_session_tool_respond,
            pi_session_list,
            
            // Pi store commands (keep, made standalone):
            pi_store_record_session,
            pi_store_record_events,
            pi_sessions_history,
            
            // Secrets commands (keep):
            secrets_get,
            secrets_set,
            secrets_delete,
        ])
        .setup(|app| {
            // NO sidecar spawning
            let pi_state = PiState::new(
                app.path().app_data_dir().map(|p| p.join("pi-sessions.json"))
            );
            app.manage(pi_state);
            Ok(())
        })
        .run(tauri::generate_context!());
}
```

---

## 29. Tauri Configuration and Build Script Changes

### 29.1 tauri.conf.json

Remove sidecar resource references:

```json
// Before:
"resources": {
  "../sidecars/pi-host/dist": "sidecars/pi-host",
  "../sidecars/node/dist": "sidecars/node"
},
"beforeBuildCommand": "pnpm build:sidecars && pnpm build",

// After:
"resources": {},
"beforeBuildCommand": "pnpm build",
```

### 29.2 package.json

Remove sidecar build scripts:

```json
// Before:
"scripts": {
  "build:sidecars": "cd sidecars/pi-host && pnpm build",
  "dev:sidecars": "cd sidecars/pi-host && pnpm dev"
}

// After:
"scripts": {
  // Remove build:sidecars and dev:sidecars
}
```

### 29.3 pnpm-workspace.yaml

Remove sidecar workspace entry:

```yaml
# Before:
packages:
  - 'sidecars/pi-host'

# After:
packages:
  # Remove sidecars entry
```

---

## 30. tauri.conf.json Resource Cleanup

The Tauri resource bundling for the sidecar's Node.js binary (~45 MB) is the single largest contributor to Terax's download size. Removing it saves 45 MB.

### Current resource structure in release builds:

```
Terax.app/
├── Contents/
│   ├── MacOS/terax
│   ├── Resources/
│   │   ├── sidecars/
│   │   │   ├── pi-host/
│   │   │   │   └── dist/           # Compiled sidecar JS (~100KB)
│   │   │   └── node/
│   │   │       └── dist/           # Standalone Node.js binary (~45 MB)
│   │   └── ...
```

### After cleanup:

```
Terax.app/
├── Contents/
│   ├── MacOS/terax
│   ├── Resources/
│   │   └── ...  (no more sidecars/)
```

---

## 31. Session Backend Implementation Decision: Sidecar Commands

During Phase 2 (parallel), the frontend still calls `pi_session_create` etc. because the backend abstraction (`PiSessionBackend`) routes through Tauri invoke. After Phase 3 (delete), the webview no longer needs to invoke these commands — it calls `createPiSession()` directly.

**Migration path for session commands:**

| Phase | Frontend calls | Rust handler |
|-------|---------------|--------------|
| Phase 1 (side-by-side) | `invoke("pi_session_create")` | Existing sidecar handler (unchanged) |
| Phase 2 (enabled) | `invoke("pi_session_create")` → router decides | Sidecar handler (old) OR simplified handler (new) |
| Phase 3 (deleted) | `createPiSession()` directly (no invoke) | Not called from frontend; simplified handler still available for external callers |

**Simplified Rust handler for Phase 2+**: Instead of sending JSON-RPC to sidecar, the simplified handler just registers the session in `PiState.tool_sessions`:

```rust
#[tauri::command]
pub fn pi_session_create(
    state: tauri::State<'_, PiState>,
    title: String,
    cwd: String,
    provider_config: Option<ProviderConfig>,
) -> Result<CreateResult, String> {
    // New behavior: just register in tool sessions
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd_path = std::path::PathBuf::from(&cwd);
    state.register_session(&session_id, &cwd_path, None)?;
    
    // Return the session metadata (the actual session is created in webview)
    Ok(CreateResult { session: PiSession { id: session_id, /* ... */ } })
}
```

**But wait** — in Phase 3, the frontend creates sessions directly in the webview via `createPiSession()`. The Rust `pi_session_create` command becomes unnecessary. It should be removed from `lib.rs`.

The migration plan should be:

1. **Phase 1:** Add new Rust commands (`pi_native_tool`, register, unregister). Old commands still work with sidecar.
2. **Phase 2:** Router in frontend chooses between old invoke path and new webview-only path. When new path is active:
   - Session CRUD happens in webview (no invoke needed)
   - Tool execution goes through `pi_native_tool` invoke
   - Session persistence goes through `pi_store_record_session` invoke
3. **Phase 3:** Remove old Rust commands and their handlers.

---

## 32. Development Flow Changes for Contributors

### Before (current)

```
1. Start Tauri app → Rust spawns sidecar (Node.js)
2. Modify sidecar code → must rebuild sidecar (pnpm build:sidecars)
3. Modify Rust host management → must recompile Rust
4. Modify webview code → hot reload works
```

### After (new)

```
1. Start Tauri app → no sidecar spawning
2. Modify webview code (including pi SDK integration) → hot reload works
3. Modify Rust tool dispatch → must recompile Rust
4. No sidecar build step needed at all
```

**Contributor impact:** Faster iteration, no Node.js binary management, no sidecar lifecycle complexity. The tradeoff is that pi extensions using Node.js APIs won't work (but most extensions don't need them).

---

## 33. Testing: Session Persistence Independence

A critical thing to verify early: the existing `pi_store_record_session` and `pi_store_record_events` commands work without the sidecar running. Currently, these may be called by the sidecar through the bridge. After Phase 1, they should be callable directly from the webview.

**Verification test (do this in Phase 1):**

```typescript
// In webview dev console or a test script
const testEvent = {
  id: "test-123",
  type: "session.test",
  sessionId: "session-456",
  createdAt: new Date().toISOString(),
  payload: { hello: "world" },
};

const result = await invoke("pi_store_record_events", { events: [testEvent] });
console.log("Store result:", result);

// Then verify the file was written:
const history = await invoke("pi_sessions_history");
console.log("History:", history);
```

If this fails without the sidecar, the store commands need refactoring to remove their dependency on `PiHost`.

---

## 34. Phase 1 Implementation Checklist (Detailed)

This checklist is for the implementor to track exact steps.

### Prerequisites

- [ ] Read `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` — verify `createAgentSession` signature
- [ ] Read `node_modules/@earendil-works/pi-agent-core/dist/index.d.ts` — verify `AgentEvent` types
- [ ] Read `src-tauri/src/modules/pi/host/bridge.rs` — locate `execute_verified_native_tool_with_policy` function signature
- [ ] Read `src-tauri/src/modules/pi/state.rs` — understand current PiState fields
- [ ] Read `src-tauri/src/modules/pi/store.rs` — understand persistence API
- [ ] Read `src/modules/pi/lib/sessions/types.ts` — confirm PiSession and PiSessionEvent types
- [ ] Read `src/modules/pi/lib/sessions/events.ts` — confirm PI_SESSION_EVENT enum values
- [ ] Read `src/modules/pi/lib/pi-session-backend.ts` — understand the PiSessionBackend interface
- [ ] Read `src/modules/pi/lib/usePiSessionEventStream.ts` — confirm event name is `pi:session-event`

### Webview Adapter Files

- [ ] Create `src/modules/pi/lib/keychain-auth-adapter.ts`
- [ ] Create `src/modules/pi/lib/terax-tool-bridge.ts`
- [ ] Create `src/modules/pi/lib/terax-system-prompt.ts`
- [ ] Create `src/modules/pi/lib/session-file-adapter.ts`
- [ ] Create `src/modules/pi/lib/event-mapper.ts`
- [ ] Create `src/modules/pi/lib/agent-session-wrapper.ts`

### Rust Changes

- [ ] In `src-tauri/src/modules/pi/mod.rs`: add `pub mod native_tool;` (or add to existing native_tools mod)
- [ ] In native tool module: add `execute_verified_native_tool_with_policy` or make it accessible
- [ ] Add `NativeToolRequest`, `NativeToolResult`, `NativeToolSession` types to `types.rs`
- [ ] Add `ToolError` enum (see Section 26.4)
- [ ] Simplify `PiState` to hold `tool_sessions`, `tool_approvals`, `capability_audit`, `history_path`
- [ ] Add `pi_native_tool` command
- [ ] Add `pi_native_tool_register_session` command
- [ ] Add `pi_native_tool_unregister_session` command
- [ ] Refactor `store.rs` to be independent of PiHost (if needed)
- [ ] Register new commands in `lib.rs`

### Configuration

- [ ] Ensure `@earendil-works/pi-coding-agent` is in `package.json` dependencies
- [ ] Remove sidecar build scripts from `package.json` (Phase 3)
- [ ] Remove sidecar resource entries from `tauri.conf.json` (Phase 3)
- [ ] Update `pnpm-workspace.yaml` (Phase 3)

### Verification

- [ ] `cd src-tauri && cargo check` compiles
- [ ] `pnpm exec tsc --noEmit` compiles
- [ ] `pnpm tauri dev` starts and shows the Pi panel
- [ ] Existing sessions still load (through old path)
- [ ] Sidecar still works (old path not affected)
- [ ] `pi_store_record_events` works without sidecar (test from dev console)

---

## 35. Known pi SDK Exports and Their Usage (Snapshot)

This section documents the known public API of the pi SDK at the time of writing. Verify against actual SDK before implementing.

```typescript
// From @earendil-works/pi-coding-agent

// Core
export { createAgentSession } from ".";            // ← USE THIS
export { DefaultResourceLoader } from ".";         // ← USE THIS
export { AuthStorage } from ".";                    // ← USE THIS
export { ModelRegistry } from ".";                  // ← USE THIS
export { SessionManager } from ".";                 // ← USE THIS
export { SettingsManager } from ".";                // ← USE THIS

// AgentSession type
export type { AgentSession } from "@earendil-works/pi-agent-core";
export type { AgentEvent } from "@earendil-works/pi-agent-core";

// Supporting
export { loadSourcedSkills, formatSkillsForSystemPrompt } from "@earendil-works/pi-agent-core";
export { loadPromptTemplates, formatPromptTemplateInvocation } from "@earendil-works/pi-agent-core";

// NOT used (Terax uses Rust equivalents):
// - Agent (raw class — we use createAgentSession instead)
// - streamSimple (internal to createAgentSession)
// - getModel (handled by ModelRegistry)
// - listProfileModels (handled by ModelRegistry)
```

---

## Appendix B: Why NOT Use Pi's SessionManager for Session Listing

Pi's `SessionManager` lists sessions from its internal format. We deliberately do NOT use it for the session sidebar. Here's why:

| Concern | Pi's SessionManager | Terax's pi-sessions.json |
|---------|-------------------|------------------------|
| Format | Internal JSONL | Custom JSON with all metadata fields |
| Fields | Title, timestamps, message count | Title, status, cwd, lastPrompt, workspaceEnv, sdkSessionFile, created/updated timestamps, fork references |
| UI needs | Title + timestamp | Title + status + lastPrompt + timestamp + cwd |
| Event history | Not stored (messages only) | Last 500 PiSessionEvents stored |
| Read speed | Must parse JSONL (full history) for each session | Single JSON file, O(1) read |
| Write method | AgentSession flushes internally | Tauri invoke (standalone) |
| Reuse | Yes (for message resumption via sessionFile) | Yes (for sidebar listing) |

**Conclusion:** pi-sessions.json is the source of truth for the sidebar. The JSONL session file is the source of truth for message history during resumption. Both coexist. The `sdkSessionFile` field on the PiSession metadata object links them.
