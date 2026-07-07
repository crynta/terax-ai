# Pi Integration SOTA Architecture Delta Report

**Date:** 2026-06-10 (re-check)
**Purpose:** Identify every discrepancy between the architecture doc and the actual codebase, plus new findings.

> Status 2026-07-07: historical only. This delta report predates full Node Pi sidecar deletion and several webview-native follow-up fixes. Use `docs/pi-runtime.md`, `docs/pi-sidebar-release-readiness.md`, and `docs/sota-plan-2026-06-11.md` for current implementation truth.

---

## Summary

The architecture doc (`pi-integration-sota-architecture.md`) is **~85% accurate**. The core thesis (use `createAgentSession` in webview, eliminate sidecar, route tools through Rust) remains correct. However, several specific details, types, tool names, and integration patterns have changed or were wrong. This report lists every delta.

---

## 1. CRITICAL DISCREPANCIES (affect implementation correctness)

### 1.1 `@earendil-works/pi-coding-agent` is NOT in package.json

**Doc says (Section 7.5):**
> "Add direct dependency on `@earendil-works/pi-coding-agent`"

**Reality:** The package exists in `node_modules/` (hoisted from `sidecars/pi-host/` dependency), but it is **NOT listed in the root `package.json`**. Only `pi-agent-core` and `pi-ai` are direct dependencies:
```json
"@earendil-works/pi-agent-core": "0.78.0",
"@earendil-works/pi-ai": "0.78.0"
```

**Impact:** The adapter files import from `@earendil-works/pi-coding-agent`, but this package isn't a declared dependency. It's hoisted through the sidecar workspace. When the sidecar is deleted (Phase 3), the package disappears.

**Fix:** Add `"@earendil-works/pi-coding-agent": "0.78.0"` to the root `package.json` dependencies before deleting the sidecar. Do this in Phase 1, not Phase 3.

---

### 1.2 Tool name mismatch between webview bridge and Rust

**Doc says (Section 11):** Recommends mapping tool names in `teraxToolExecutor` with a `TOOL_NAME_MAP`.

**Reality — the mapping is already needed and the names are known:**

| pi-coding-agent exports | webview bridge (pi-tools.ts) | Rust native_tools.rs |
|------------------------|------------------------------|---------------------|
| `createReadTool` → ? | `"read_file"` | `"read"` |
| `createWriteTool` → ? | `"write_file"` | `"write"` |
| `createEditTool` → ? | `"edit_file"` | `"edit"` |
| `createLsTool` → ? | `"list_directory"` | `"ls"` |
| `createBashTool` → ? | `"bash_run"` | `"bash"` |
| `createGrepTool` → ? | `"grep"` | `"grep"` |
| `createFindTool` → ? | `"glob"` | `"find"` |

Three different naming conventions are in play. The doc's `TOOL_NAME_MAP` in Section 11 guessed capitalized names (`"Read"`, `"Write"`, etc.) which may be wrong. The actual pi-coding-agent tool names need to be verified from its `createReadTool()`, etc. exports.

**Impact:** The `teraxToolExecutor` must map whatever `createAgentSession`'s internal tool registry uses to Rust's expected names (`"read"`, `"ls"`, `"bash"`, etc.).

**Fix:** At implementation time, read `pi-coding-agent`'s tool definition source to get exact names. The current best guess is that `createAgentSession` registers tools matching `createReadTool`'s `name` field.

---

### 1.3 `USE_WEBVIEW_AGENT = true` (not a feature flag)

**Doc says (Section 19, Phase 2):**
> "Add `USE_FULL_SDK_SESSION` flag (default false). When true, routes through `createAgentSessionWrapper` instead of `webview-session.ts`"

**Reality:** `USE_WEBVIEW_AGENT` is already set to `true` (line 495 of `pi-session.ts`). The webview path is the **active path**, not experimental. The sidecar is the legacy path.

**Impact:** The migration isn't "add a new path alongside the webview bridge." It's "replace the existing webview bridge (`new Agent()` + hand-built tools) with `createAgentSession` + adapters." The sidecar is already not the default.

**Fix:** Update the migration plan. Phase 2 isn't about enabling a new path — it's about swapping the webview bridge internals from `new Agent()` to `createAgentSession()` while keeping the webview-session.ts API surface identical.

---

### 1.4 `systemPromptOverride` may not exist as a top-level option

**Doc says (Section 7.5):** Passes `systemPromptOverride: () => systemPrompt` to `createAgentSession()`.

**Reality:** `createAgentSession`'s type signature needs verification. The `pi-coding-agent` `index.d.ts` exports `AgentSessionConfig` — the system prompt override might be on `DefaultResourceLoader`, not on `createAgentSession` directly.

**Fix:** Read `AgentSessionConfig` type at implementation time. If `systemPromptOverride` is on `DefaultResourceLoader`, move the precomputed prompt there instead.

---

### 1.5 `store.rs` is already standalone

**Doc says (Section 26.7):** "store.rs likely depends on PiHost. It needs to be made standalone."

**Reality:** `store.rs` **already works standalone**. It takes `app: &AppHandle` and resolves paths independently. The webview path already uses `pi_store_record_session` and `pi_store_record_events` without any sidecar running.

**Impact:** No refactoring needed for `store.rs`. This is a simplification — one less thing to implement.

---

## 2. MODERATE DISCREPANCIES (affect details, not architecture)

### 2.1 `PiState` has `IdleShutdownController`, not just `PiHost`

**Doc says (Section 8):**
```rust
pub struct PiState {
    tool_sessions: Arc<RwLock<HashMap<String, NativeToolSession>>>,
    tool_approvals: NativeToolApprovals,
    capability_audit: CapabilityAuditLog,
    history_path: Mutex<Option<PathBuf>>,
}
```

**Reality:**
```rust
pub struct PiState {
    host: Arc<Mutex<Option<Arc<PiHost>>>>,
    history_path: Arc<Mutex<Option<PathBuf>>>,
    idle_shutdown: IdleShutdownController,
}
```

The current `PiState` is simpler than what the doc proposes — tool sessions, approvals, and audit are all inside `PiHost`, not in `PiState` directly. After the sidecar is removed:
- `NativeToolSessions` must be moved out of `PiHost` into `PiState`
- `NativeToolApprovals` must be moved out of `PiHost` into `PiState`
- `CapabilityAuditLog` must be moved out of `PiHost` into `PiState`
- `IdleShutdownController` becomes unnecessary (no process to shut down)

**Impact:** More refactoring of `PiState` than the doc implies. The `PiHost` currently owns all the tool-related state. These must be extracted.

---

### 2.2 `webview-session.ts` is ~1000 lines, not ~670

**Doc says (Section 16):** "Replaced by agent-session-wrapper.ts"

**Reality:** `webview-session.ts` is ~1000 lines with sophisticated session management including:
- Fork and rollback support
- Interactive question handling (`PendingQuestionRegistry`)
- Approval gating (`PendingApprovalRegistry`)
- Transcript persistence for resumption (`rehydrateSession`, `prepareTranscriptForResume`)
- Usage tracking
- Archive/restore

The architecture doc's `agent-session-wrapper.ts` stub is ~300 lines and misses fork, rollback, question handling, and transcript persistence.

**Impact:** The wrapper needs to be significantly larger than the doc estimates, or these features must be confirmed as handled by `createAgentSession` internally.

---

### 2.3 `PiSessionEvent` uses `event_type` (snake_case), not `type` (camelCase)

**Doc says (Section 2):**
```typescript
interface PiSessionEvent {
  type: string;  // one of PI_SESSION_EVENT values
}
```

**Reality (Rust types.rs):**
```rust
pub struct PiSessionEvent {
    pub event_type: String,  // serialized as "eventType" via serde
    // ...
}
```

**And in frontend types.ts:**
```typescript
type PiSessionEvent = {
  type: PiSessionEventType | string;  // frontend uses "type"
  // ...
}
```

The Rust side uses `event_type` with `#[serde(rename = "eventType")]` (camelCase). The frontend uses `type`. The doc's code uses `type` which matches the frontend, so the code is correct for the webview adapters. No change needed, but the implementor should be aware of the serde rename.

---

### 2.4 `pi-coding-agent` exports different function names than assumed

**Doc says (Section 6):** Lists `DefaultResourceLoader` as a class constructor.

**Reality from `index.d.ts`:**
- `createAgentSession` — correct
- `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent` — correct
- `SessionManager`, `SettingsManager`, `ModelRegistry` — correct
- Tool factories: `createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createGrepTool`, `createFindTool`, `createLsTool` — these exist
- `formatSkillsForPrompt` (not `formatSkillsForSystemPrompt` as the doc says)
- `loadSkills`, `loadSkillsFromDir` (not `loadSourcedSkills` as the doc says)
- `createExtensionRuntime`, `defineTool` — extension system

**Impact:** Several function names in the adapter code are wrong:
- `loadSourcedSkills` → probably `loadSkills` or `loadSkillsFromDir`
- `formatSkillsForSystemPrompt` → probably `formatSkillsForPrompt`
- `DefaultResourceLoader` may not be a class — need to verify

---

### 2.5 `AuthStorage` may not have a `.create()` static method

**Doc says (Section 7.1):**
```typescript
const authStorage = AuthStorage.create(keychainAuthBackend);
```

**Reality:** The `AuthStorage` API needs verification from `pi-coding-agent`'s actual types. It might be `new AuthStorage(backend)` or a different factory method.

**Fix:** Check `AgentSessionConfig` to see how auth is passed to `createAgentSession`.

---

### 2.6 `prompt-context.ts` already handles TERAX.md

**Doc says (Section 7.3):** Create `TeraxSystemPrompt` that reads TERAX.md.

**Reality:** `src/modules/pi/lib/prompt-context.ts` already implements this:
```typescript
readProjectMemory(workspaceRoot, readText)  // reads TERAX.md
withProjectMemory(systemPrompt, memory)     // wraps in <project-memory> XML
```
With a 32KB cap (`TERAX_MD_MAX_BYTES = 32 * 1024`).

**Impact:** The `TeraxSystemPrompt` adapter should reuse `prompt-context.ts`, not reimplement TERAX.md reading.

---

### 2.7 Skill discovery already works via Tauri commands

**Doc says (Section 7.3):** Use pi's `loadSourcedSkills` from pi-agent-core.

**Reality:** `pi-skills.ts` already discovers skills via `invoke("pi_skills_status")` which scans:
- `.pi/skills`
- `.agents/skills`
- `~/.pi/agent/skills`

And `buildSystemPromptWithSkills()` already formats them as XML.

**Impact:** The new architecture should either:
- Replace `pi-skills.ts` with pi's `DefaultResourceLoader` (gets extensions + prompts too), OR
- Keep `pi-skills.ts` for skills and add `DefaultResourceLoader` for extensions/prompts only

The doc's approach of replacing with pi's `loadSourcedSkills` may lose the existing Rust-based skill scanning which works well.

---

## 3. MINOR DISCREPANCIES (cosmetic or documentation)

### 3.1 Additional Rust commands not mentioned in doc

The doc lists ~15 Rust commands. The actual count is **28**. Missing from the doc:
- `pi_local_agents_status`
- `pi_session_archive` / `pi_session_restore`
- `pi_session_fork` / `pi_session_rollback`
- `pi_session_delete_with_artifacts`
- `pi_usage_summary`
- `pi_store_record_transcript` / `pi_store_load_transcript` / `pi_store_delete_transcript`
- `workflow_pi_session_create`

**Impact:** The doc's "Files to Modify" table in Section 18 doesn't account for fork, rollback, archive, transcript commands. These are important features.

---

### 3.2 Event types are more numerous than documented

**Doc says (Section 2):** Lists ~18 event types.

**Reality:** **25 event types** exist:
```
Created, Resumed, Input, Progress,
ReasoningDelta, ReasoningText, OutputDelta, OutputText,
ToolStart, ToolUpdate, ToolApprovalRequested, ToolApprovalResponded,
ToolResult, Status, Renamed, Deleted, Archived, Restored,
Forked, Rollback, Usage, TurnDiff,
QuestionAsked, QuestionResponded, Error
```

Missing from the doc: `QuestionAsked`, `QuestionResponded`, `Usage`, `TurnDiff`, `Rollback`, `Archived`, `Restored`.

**Impact:** The `EventMapper` (Section 7.6) must handle more event types. The doc's mapper only handles `message_update`, `tool_execution_start/end`, `agent_end`, `agent_error`, `agent_retry`, `compaction_start/end`.

---

### 3.3 `sidecars/node/` is empty (no Node.js binary)

**Doc says (Section 16):** Lists `sidecars/node/` as "Standalone Node.js binary bundled for sidecar (~45 MB)."

**Reality:** `sidecars/node/dist/` contains only a `.gitkeep` placeholder. There is no standalone Node.js binary in the repo. The Node.js runtime may be built at release time from a separate build step (`build:node-runtime` script in package.json).

**Impact:** The 45 MB savings claim needs verification. The actual bundled binary size depends on what `build:node-runtime` produces. It's likely downloaded/built during CI, not stored in the repo.

---

### 3.4 17 docs exist, not just the architecture doc

The architecture doc references itself as the primary document, but there are **16 other docs** in the `docs/` directory including:
- `pi-native-tool-bridge.md`
- `pi-runtime.md`
- `pi-sidebar-verification.md`
- `pi-session-protocol.md`
- `pi-frontend-design.md`
- `terax-agent-runtime-roadmap.md`
- And 11 more

**Impact:** The implementor should read these for additional context. The architecture doc should reference them.

---

### 3.5 `AGENTS.md` content differs from what doc assumes

**Doc says:** `AGENTS.md` is referenced in project context.

**Reality:** `AGENTS.md` contains only `TERAX.md` (a pointer to the main file). This is a minimal agent configuration, not a comprehensive guide.

---

## 4. THINGS THE DOC GOT RIGHT

These are confirmed accurate:

- **`createAgentSession`** is the correct entry point (verified in `index.d.ts`)
- **Rust owns tool execution** through `native_tools.rs` with capability policy + audit
- **Two-file persistence** (pi-sessions.json + per-session transcripts) is implemented and working
- **`store.rs` standalone** — confirmed, it works without PiHost
- **Event emission via `emit("pi:session-event", event)`** — confirmed working
- **`PiControllerProvider` provides backend to React tree** — confirmed
- **`usePiSessionEventStream` listens for `pi:session-event`** — confirmed
- **PiSession and PiSessionEvent types** — match between Rust and frontend (with serde rename)
- **`sidecars/pi-host/` uses raw Agent, not `createAgentSession`** — confirmed
- **`webview-session.ts` uses `new Agent()`, not `createAgentSession`** — confirmed
- **pi-coding-agent is version 0.78.0** — confirmed
- **28 Rust Tauri commands registered** — confirmed
- **Capability policy (Auto/Ask/Deny) per tool** — confirmed
- **MCP tools routed through `mcp__*` prefix** — confirmed
- **Provider config supports 13+ providers** — confirmed
- **OS keychain for API keys via `secrets_*` commands** — confirmed
- **The sidecar is legacy, webview is active** — confirmed (`USE_WEBVIEW_AGENT = true`)

---

## 5. NEW FINDINGS (not in the doc at all)

### 5.1 Interactive Question Support

`webview-session.ts` implements interactive question handling:
- `PendingQuestionRegistry` — tracks pending questions from the agent
- `sessionQuestionRespond(sessionId, questionId, answers)` — user answers
- Events: `QuestionAsked`, `QuestionResponded`

The doc's `agent-session-wrapper.ts` doesn't handle questions. If `createAgentSession` doesn't handle them internally, the wrapper must implement question gates.

### 5.2 Session Fork and Rollback

`webview-session.ts` supports:
- `webviewSessionFork(parentSessionId, forkEventId, title)` — fork from checkpoint
- `webviewSessionRollback(sessionId, rollbackEventId)` — rollback to event
- Events: `Forked`, `Rollback`

The doc's wrapper doesn't implement fork or rollback. `createAgentSession` may handle branching internally, but rollback might need custom implementation.

### 5.3 Session Archive/Restore

Rust commands `pi_session_archive` and `pi_session_restore` exist. The doc doesn't mention these. They set `archivedAt` on the session and filter it from the active list.

### 5.4 Transcript Persistence

`pi_store_record_transcript`, `pi_store_load_transcript`, `pi_store_delete_transcript` — these persist the full `AgentMessage[]` array as opaque JSON for session resumption. The doc mentions JSONL files from pi's `SessionManager`, but the current system uses a simpler JSON transcript format.

**Impact:** After migration, the wrapper must decide: use pi's `SessionManager` JSONL format OR keep the existing JSON transcript format. Keeping the existing format means less migration risk.

### 5.5 `pi-http.ts` Ref-Counted Fetch Proxy

The webview bridge installs a **global fetch proxy** (`installProxiedFetch()`) that intercepts all `fetch()` calls and routes them through Tauri's `ai_http_stream` (for SSE) and `ai_http_request` (for REST). This is critical because the webview can't call LLM APIs directly due to CORS.

**Impact:** If `createAgentSession` uses the global `fetch` internally (which pi-ai's `streamSimple` does), the proxy should work automatically. But the proxy must be installed before `createAgentSession` is called. The doc doesn't mention this prerequisite.

### 5.6 `pi-coding-agent` exports tool factory functions

`createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createGrepTool`, `createFindTool`, `createLsTool` — these are exported by `pi-coding-agent`. The doc doesn't mention these. They might be useful for registering tools that match pi's expected schema while routing execution through Rust.

### 5.7 Workflow-Gated Session Creation

`workflow_pi_session_create` — a separate command that wraps `pi_session_create` with workflow-specific gating. The doc doesn't mention this. It should be preserved during migration.

### 5.8 `pi_models_list` Command

`pi_models_list` calls `listProfileModels` in the sidecar. After sidecar removal, model listing must work differently — either through pi's `ModelRegistry` in the webview or through a Rust command that calls the model listing API directly.

---

## 6. RECOMMENDED UPDATES TO THE ARCHITECTURE DOC

| Section | Update Needed |
|---------|--------------|
| 1 (Decisions) | No change — decisions remain valid |
| 2 (Background) | Update `webview-session.ts` line count to ~1000. Note it's the active path. Add `prompt-context.ts`, `pi-http.ts`, approval/question registries. |
| 3 (Zosma) | No change |
| 4 (Principles) | No change |
| 5 (Target Arch) | Add `installProxiedFetch()` as prerequisite. Add question handling to event flow. |
| 6 (SDK API) | Fix function names: `loadSkills` not `loadSourcedSkills`, `formatSkillsForPrompt` not `formatSkillsForSystemPrompt`. Verify `AuthStorage.create()`. Verify `systemPromptOverride` location. |
| 7 (Adapters) | Reuse `prompt-context.ts` for TERAX.md. Add question handling to wrapper. Add fork/rollback to wrapper. Expand wrapper to ~500 lines. |
| 8 (Rust) | Note that `NativeToolSessions`, `NativeToolApprovals`, `CapabilityAuditLog` must be extracted from `PiHost` into `PiState`. |
| 9 (Events) | Add missing event types: QuestionAsked, QuestionResponded, Usage, TurnDiff, Rollback, Archived, Restored. |
| 10 (Lifecycle) | Add fork, rollback, archive, restore, question respond flows. |
| 11 (Tools) | Fix tool name mapping table with actual names from all three sources. |
| 12 (Auth) | No significant change |
| 13 (Extensions) | Note existing Rust skill scanning via `pi_skills_status`. Decide: replace or augment. |
| 14 (MCP) | No change |
| 15 (Persistence) | Note existing transcript JSON format vs pi's JSONL. Decide which to use. |
| 16 (Files to Delete) | Remove 45 MB claim for sidecars/node/ (it's empty in repo). Note `build:node-runtime` script. |
| 17 (Files Unchanged) | Add `prompt-context.ts`, `approval-registry.ts`, `question-registry.ts`, `tool-approval-policy.ts` |
| 18 (Files to Modify) | Add `state.rs` extraction details. Add `pi_models_list` handling. |
| 19 (Migration) | Phase 1: Add `pi-coding-agent` to root package.json. Phase 2: Replace webview bridge, not add a new path. Phase 3: Sidecar is already not the default. |
| 20 (Size) | Verify 45 MB claim. Node binary is built, not stored. |
| 21 (Errors) | Add question timeout handling. Add fork/rollback error cases. |
| 22 (Testing) | Add tests for fork, rollback, question handling, transcript persistence. |
| 25 (Resolved) | Fix system prompt: reuse `prompt-context.ts`. Fix `store.rs`: already standalone. |
| 26 (Rust Impl) | Update `PiState` extraction plan — more state to move from `PiHost`. |
| 34 (Checklist) | Add: install proxied fetch before createAgentSession. Add: verify pi-coding-agent is direct dep. |

---

## 7. ACTION ITEMS FOR IMPLEMENTOR

Before writing any code:

1. **Read `pi-coding-agent`'s `AgentSessionConfig` type** — this defines exactly what `createAgentSession` accepts. All adapter code depends on this.
2. **Read `pi-coding-agent`'s tool factory functions** — `createReadTool` etc. — to get the exact tool names and schemas that `createAgentSession` registers.
3. **Add `@earendil-works/pi-coding-agent: "0.78.0"` to root package.json** — it's currently only a transitive dependency through the sidecar.
4. **Verify `installProxiedFetch()` compatibility** — ensure the global fetch proxy works with pi-ai's `streamSimple`.
5. **Decide transcript format** — keep existing JSON or switch to pi's JSONL?
6. **Plan PiState extraction** — `NativeToolSessions`, `NativeToolApprovals`, `CapabilityAuditLog` must move from `PiHost` to `PiState`.
7. **Reuse `prompt-context.ts`** — don't reimplement TERAX.md reading.
8. **Handle fork/rollback/question features** — either `createAgentSession` handles them or the wrapper must.
