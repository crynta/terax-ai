# Pi sidebar ideas to borrow while keeping the Node sidecar

## Purpose

This document captures practical ideas Terax can borrow from `Dicklesworthstone/pi_agent_rust` and similar Rust native Pi efforts without replacing the current Terax Pi implementation.

The goal is to improve the current `pi-sidebar` branch by strengthening diagnostics, provider behavior, Rust-mediated tool security, runtime lifecycle, tests, and user experience while keeping the existing Node based Pi sidecar.

## Current Terax Pi architecture

Terax currently integrates Pi through a Node sidecar, not through `pi_agent_rust`.

Main files:

- `sidecars/pi-host/host.js`
- `sidecars/pi-host/protocol.js`
- `sidecars/pi-host/sessions.js`
- `sidecars/pi-host/provider-config.js`
- `sidecars/pi-host/model-catalog.js`
- `src-tauri/src/modules/pi/host.rs`
- `src-tauri/src/modules/pi/mod.rs`
- `src-tauri/src/modules/pi/store.rs`
- `src/modules/pi/*`
- `src/settings/sections/ModelsSection.tsx`

The sidecar uses these Pi packages:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

Terax speaks to the sidecar over newline delimited JSON-RPC 2.0 on stdio. Rust owns process spawning, workspace authorization, keyring access, session history persistence, and Tauri events. The sidecar owns Pi SDK session objects, prompt execution, and the reviewed approval extension for the fixed Rust-mediated custom tool list.

## What not to do

Do not replace the Node sidecar with `pi_agent_rust` in this phase.

Reasons:

1. `pi_agent_rust` has a restrictive license rider. Treat it as an idea source only. Do not copy source code.
2. The Rust port exposes `pi --mode rpc`, but its protocol differs from Terax's current sidecar JSON-RPC protocol.
3. Terax already has a working Node sidecar and bundled runtime flow.
4. The current highest value work is hardening the existing branch, not changing backends.

Explicitly out of scope for this document:

- Adding an external `pi --mode rpc` backend.
- Replacing the Node sidecar with a single Rust binary.
- Copying implementation code from `pi_agent_rust`.

## Guiding principles

1. Keep Terax as the authority boundary.
   - Rust owns file system, shell, git, workspace authorization, keyring access, and process lifecycle.
   - The sidecar receives only the minimum data needed to run Pi prompts.

2. Keep Pi tools Rust-mediated by default.
   - The fixed allowlist is `read`, `ls`, `grep`, `find`, `bash`, `edit`, and `write`.
   - Shell and mutating tools must pause for explicit Terax approval before execution.

3. Prefer functional core and thin shells.
   - Protocol validation and model resolution should be pure and unit tested.
   - Tauri commands and React components should remain thin.

4. Diagnostics should be actionable.
   - Users should see what is missing and what to do next.
   - Avoid vague errors such as "runtime failed" when the real problem is missing auth or a missing bundled package.

5. Tests must model real runtime behavior.
   - Sidecar tests should use actual child processes where protocol corruption or stdio behavior matters.
   - Protocol tests should cover invalid input and redaction.

## Priority 0: Fix current branch blockers

### 0.1 Fix parallel host test flake

#### Problem

`pnpm test` can fail in normal parallel Vitest mode while the same tests pass when serialized with `--fileParallelism=false`.

Observed failure:

- File: `sidecars/pi-host/host.test.js`
- Failing line: around `readResponse(lines)` after `sessions.create`
- Error: `Timed out waiting for host envelope`

Likely cause:

- `sessions.create` imports Pi SDK modules and creates a real `AgentSession`.
- Under parallel load this can exceed the default `3000ms` envelope read timeout.
- The failure is not seen when the same test file runs alone or when file parallelism is disabled.

#### Reasoning

This is a test reliability problem, not necessarily a runtime correctness problem. The sidecar is intentionally doing real startup work in this test, and parallel test load increases startup latency. A host protocol test should still catch real hangs, but its timeout should account for expected cold imports under CI load.

#### Implementation options

Option A: Increase the default envelope read timeout.

```js
function createEnvelopeReader(input) {
  return {
    read: (timeoutMs = 8000) => {
      // existing implementation
    },
  };
}
```

Option B: Keep the default tight and use a longer timeout only for `sessions.create`.

```js
writeRequest(child, 1, "sessions.create", { title: "stdio" });
await expect(lines.read(8000)).resolves.toMatchObject({
  jsonrpc: "2.0",
  id: 1,
  result: { session: { id: "pi-1", status: "idle" } },
});
```

Option B is more precise because it avoids weakening all protocol reads.

#### Files

- `sidecars/pi-host/host.test.js`

#### Acceptance criteria

- `pnpm test` passes in normal parallel mode.
- `pnpm exec vitest run --fileParallelism=false` passes.
- A real hung host still fails within a reasonable time.
- The test continues to verify that stdout contains only JSON-RPC envelopes.

#### Verification

```bash
pnpm test
pnpm exec vitest run --fileParallelism=false
pnpm exec vitest run sidecars/pi-host/host.test.js --reporter=verbose
```

### 0.2 Fix incomplete custom endpoint enabling the Pi model picker

#### Problem

The Pi model picker currently enables itself if any custom endpoint exists, even if the endpoint has no base URL or model id.

Current pattern:

```ts
providerGroups.length > 0 || prefs.customEndpoints.length > 0
```

This can make the dropdown look usable while all custom endpoint choices inside it are disabled.

#### Reasoning

An incomplete custom endpoint is configuration in progress, not a usable model source. The picker should become enabled only when at least one selectable model source exists.

#### Desired behavior

The picker is enabled in Terax mode when either:

1. A provider group has models, or
2. At least one custom endpoint has both `baseURL` and `modelId`.

Suggested logic:

```ts
const hasReadyCustomEndpoint = prefs.customEndpoints.some(
  (endpoint) => endpoint.baseURL.trim() && endpoint.modelId.trim(),
);

const hasAny =
  prefs.piAuthMode === "profile"
    ? profileLoading || profileGroups.length > 0
    : providerGroups.length > 0 || hasReadyCustomEndpoint;
```

#### Files

- `src/settings/sections/ModelsSection.tsx`
- Optional test file if the picker behavior is extracted or already testable.

#### Acceptance criteria

- Empty custom endpoints do not enable the Pi model picker.
- Half configured custom endpoints do not enable the Pi model picker.
- Complete custom endpoints still appear and are selectable.
- No regression for built in providers.

## Priority 1: Runtime health model

### Goal

Borrow the rich diagnostics mindset: diagnostics should explain the exact runtime state, not just whether a package loaded.

Terax already has useful diagnostics. Expand them into a health model that can power UI actions, bug reports, and support workflows.

### Current relevant files

- `sidecars/pi-host/protocol.js`
- `src-tauri/src/modules/pi/mod.rs`
- `src/modules/pi/lib/diagnostics.ts`
- `src/modules/pi/components/PiDiagnosticsCard.tsx`
- `docs/pi-runtime.md`

### Add or improve these diagnostics

#### Provider readiness

Expose non-secret provider status:

```ts
type PiProviderHealth = {
  authMode: "terax" | "profile";
  provider: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  keySupported: boolean;
  keyRequired: boolean;
  keyConfigured: boolean | null;
  ready: boolean;
  error: string | null;
};
```

Reasoning:

- Users need to know if they chose a model that requires setup.
- Missing key and unknown model should be distinct.
- Profile auth should be clearly separate from Terax keyring auth.

Example UI messages:

- `OpenRouter key missing. Add a key in Settings > Models.`
- `Pi profile model is unavailable. Authenticate in terminal Pi or choose another model.`
- `LM Studio model id missing. Enter the loaded model id.`

#### Model registry status

Expose status for model catalogs:

```ts
type PiModelRegistryHealth = {
  source: "terax" | "profile" | "runtime";
  loaded: boolean;
  modelCount: number;
  loadError: string | null;
  cacheAgeMs?: number;
};
```

Reasoning:

- Dynamic model fetching and profile catalog loading can fail independently from the sidecar runtime.
- The UI should show catalog failures separately from prompt failures.

#### Session status

Add summary fields:

```ts
type PiSessionHealth = {
  total: number;
  idle: number;
  running: number;
  stopped: number;
  error: number;
  lastError: string | null;
};
```

Reasoning:

- A stuck running session should be visible in diagnostics.
- Users need a clear path to stop or restart sessions.

#### Runtime details

Current diagnostics include Node version, platform, arch, pid, and cwd. Consider adding:

```ts
type PiRuntimeHealth = {
  hostVersion: string;
  sidecarPath: string;
  nodeExecPath: string;
  nodeVersion: string;
  pid: number;
  packageCount: number;
  loadedPackageCount: number;
  lastError: string | null;
};
```

Reasoning:

- Packaging bugs are common in sidecar systems.
- Knowing the sidecar path and package versions helps debug release builds.

#### Build and bundle metadata

Expose non-sensitive bundle status:

```ts
type PiBundleHealth = {
  bundledRuntimePresent: boolean;
  hostScriptPresent: boolean;
  nodeModulesPresent: boolean;
  packageVersions: Array<{ name: string; version: string | null }>;
};
```

Reasoning:

- A user can have app files but missing sidecar bundle files.
- This makes `smoke:pi-host` style checks visible inside the app.

### Example diagnostics response

```json
{
  "hostVersion": "0.1.0",
  "piSdkLoaded": true,
  "provider": {
    "authMode": "terax",
    "provider": "openrouter",
    "providerLabel": "OpenRouter",
    "modelId": "anthropic/claude-sonnet-4.6",
    "modelLabel": "Claude Sonnet 4.6",
    "keySupported": true,
    "keyRequired": true,
    "keyConfigured": false,
    "ready": false,
    "error": "OpenRouter key missing"
  },
  "sessionsSummary": {
    "total": 3,
    "idle": 2,
    "running": 1,
    "stopped": 0,
    "error": 0,
    "lastError": null
  }
}
```

### Acceptance criteria

- Diagnostics never include API key values.
- Missing provider setup produces a precise issue in `PiDiagnosticsCard`.
- Package load errors show package names and versions when available.
- Diagnostics work before any session is created.
- Tests verify secret redaction.

## Priority 2: Provider timeout controls

### Goal

Use different timeouts for different classes of sidecar calls.

### Current risk

`src-tauri/src/modules/pi/host.rs` currently has one timeout concept for host requests. Fast control calls and slower provider or session setup calls have different expected latency.

A provider backed by remote auth, profile model loading, or cold Pi SDK import can take longer than a status call. Treating all calls the same can turn slow setup into a false runtime failure.

### Suggested timeout classes

```rust
enum PiHostTimeoutClass {
    Control,
    SessionCreate,
    SessionSend,
    SessionStop,
}
```

Suggested defaults:

- Control calls: 15 seconds
- Session create: 60 seconds
- Session send accept: 30 seconds
- Session stop: 30 seconds

Control calls:

- `ping`
- `status`
- `info`
- `diagnostics`
- `sessions.list`
- `models.list` if it only reads local metadata

Slower calls:

- `sessions.create`
- `sessions.send`
- `sessions.stop`
- dynamic network backed model discovery if added

### Example Rust shape

```rust
fn request_timeout_for_method(method: &str) -> Duration {
    match method {
        "sessions.create" => Duration::from_secs(60),
        "sessions.send" => Duration::from_secs(30),
        "sessions.stop" => Duration::from_secs(30),
        "models.discover" => Duration::from_secs(30),
        _ => Duration::from_secs(15),
    }
}
```

If `PiHost` stores a single default timeout today, move timeout choice into `call_json` so each method can choose its own timeout.

### Reasoning

- Slow provider setup should not make the host look dead.
- Fast control calls should still fail quickly when the process is broken.
- Session prompt completion is already asynchronous, so `sessions.send` only needs enough time to accept the prompt, not enough time for the model to finish.

### Files

- `src-tauri/src/modules/pi/host.rs`
- `docs/pi-session-protocol.md`
- Optional tests in `src-tauri/src/modules/pi/host.rs`

### Acceptance criteria

- Control calls still fail quickly when the sidecar is stuck.
- `sessions.create` allows cold Pi SDK import and provider setup.
- Timeout errors include method name and timeout duration.
- Tests cover method to timeout mapping.

## Priority 3: Dynamic model catalog

### Goal

Borrow the dynamic model fetching idea and implement it inside the existing Node sidecar.

### Why this matters

Hardcoded model lists become stale quickly. Dynamic catalog support improves:

- OpenRouter model choice.
- Local server model choice for Ollama and LM Studio.
- OpenAI compatible endpoint usability.
- Pi profile mode discovery after terminal auth changes.

### Target providers

1. OpenRouter
2. Ollama
3. LM Studio
4. MLX OpenAI compatible server
5. Generic OpenAI compatible endpoints
6. Existing Pi profile model catalog

### Protocol shape

Option A: Add a new method.

```ts
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "models.discover",
  "params": {
    "authMode": "terax",
    "provider": "openrouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "forceRefresh": false
  }
}
```

```ts
// Result
type PiDiscoveredModels = {
  provider: string;
  baseUrl: string | null;
  cached: boolean;
  fetchedAt: string;
  ttlMs: number;
  loadError: string | null;
  models: Array<{
    id: string;
    label: string;
    contextWindow: number | null;
    maxTokens: number | null;
    reasoning: boolean;
  }>;
};
```

Option B: Extend `models.list` with a mode.

```ts
{
  mode: "profile" | "runtime",
  provider?: string,
  baseUrl?: string,
  forceRefresh?: boolean
}
```

Option A is cleaner because profile listing and runtime discovery have different auth and failure modes.

### TTL cache

Use a 5 minute TTL by default.

Example sidecar cache shape:

```js
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelDiscoveryCache = new Map();

function cacheKey({ authMode, provider, baseUrl }) {
  return `${authMode}:${provider}:${baseUrl ?? ""}`;
}

function readCachedModels(key, forceRefresh) {
  if (forceRefresh) return null;
  const entry = modelDiscoveryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAtMs > MODEL_CACHE_TTL_MS) return null;
  return entry;
}
```

### Provider discovery examples

#### OpenRouter

Endpoint:

```text
GET https://openrouter.ai/api/v1/models
```

Headers:

```text
Authorization: Bearer <runtime key>
HTTP-Referer: https://terax.ai
X-Title: Terax
```

Reasoning:

- OpenRouter has many models and changes often.
- User should not need to paste exact ids manually.

#### Ollama

Endpoint options:

```text
GET http://localhost:11434/api/tags
GET http://localhost:11434/v1/models
```

Reasoning:

- Ollama users usually know model names from `ollama list`, but discovery avoids typos.

#### LM Studio

Endpoint:

```text
GET http://localhost:1234/v1/models
```

Reasoning:

- LM Studio exposes the currently available models through OpenAI compatible metadata.

#### Generic OpenAI compatible

Endpoint:

```text
GET <baseUrl>/models
```

Reasoning:

- Many custom endpoints support OpenAI style model listing.
- Failure should be graceful because not every endpoint supports it.

### Security rules

- Rust reads Terax keyring entries.
- Runtime keys are passed to the sidecar only in memory.
- Sidecar must not write runtime keys to disk.
- Model discovery responses never include keys.
- Diagnostics show only key presence booleans.

### UI behavior

In Settings > Models:

- Add a refresh button near model id fields for dynamic providers.
- Show loading state.
- Show last refreshed time.
- Keep manual model id entry as fallback.
- If discovery fails, keep existing manual value.

Example UI states:

- `OpenRouter models refreshed just now.`
- `LM Studio is not reachable at http://localhost:1234/v1.`
- `This endpoint does not expose /models. Enter the model id manually.`
- `Using cached model list from 3 minutes ago.`

### Files

- `sidecars/pi-host/model-catalog.js`
- `sidecars/pi-host/protocol.js`
- `sidecars/pi-host/model-catalog.test.js`
- `src-tauri/src/modules/pi/mod.rs`
- `src-tauri/src/modules/pi/host.rs`
- `src/modules/pi/lib/native.ts`
- `src/settings/sections/ModelsSection.tsx`

### Acceptance criteria

- Model discovery works for at least one local provider and one cloud provider.
- Cache prevents repeated network calls inside TTL.
- Manual refresh bypasses cache.
- Missing auth returns an actionable error.
- No secrets appear in logs, diagnostics, or responses.
- Unit tests cover cache hit, cache miss, force refresh, and redaction.

## Priority 4: Security posture and capability gates

### Goal

Borrow the capability gate mindset from Rust native agent work while keeping Terax's authority boundary.

### Current default to preserve

The sidecar creates Pi sessions with the reviewed Rust-mediated custom tool policy:

```js
tools: ["read", "ls", "grep", "find", "bash", "edit", "write"]
```

This policy keeps useful workspace assistance available while requiring explicit approval for shell commands and file mutations.

### Capability state

Keep an explicit capability object that mirrors the approved boundary.

```ts
type PiToolCapabilities = {
  canReadFiles: true;
  canWriteFiles: true;
  canRunShell: true;
  canUseGit: false;
  canUseNetwork: false;
};
```

Reasoning:

- Explicit capabilities are safer than implicit absence.
- Diagnostics and UI can show the Rust-mediated Pi tool boundary.
- Future tool expansion has a clear place to attach approvals and additional validation.

### Tool rule

The sidecar must not bypass Terax authority checks.

Instead:

1. Pi requests an action.
2. The sidecar validates the allowlist, workspace path, and sensitive-path deny-list.
3. Terax UI shows an approval prompt for shell commands and mutations.
4. Rust forwards the user decision through `sessions.tool.respond`.
5. Approval resumes the SDK tool call; denial blocks it without running the command or mutation.

Actions that must route through Rust:

- File read.
- File write.
- Create, rename, delete.
- Shell command.
- Persistent shell session.
- Background process.
- Git operations.

### Kill switches

Add or expose these controls:

1. Stop all Pi sessions.
2. Restart sidecar.
3. Disable Pi runtime.
4. Deny or clear pending Pi tool approvals.
5. Clear in-memory runtime keys from sidecar by restarting it.

Example Tauri commands:

```rust
#[tauri::command]
pub fn pi_stop_all_sessions(...) -> Result<(), String> {
    // ask sidecar to stop sessions, then persist stopped status
}

#[tauri::command]
pub fn pi_restart_runtime(...) -> Result<PiRuntimeSnapshot, String> {
    // stop current host, spawn fresh host
}
```

### Diagnostics example

```json
{
  "toolMode": "rust-mediated",
  "capabilities": {
    "canReadFiles": true,
    "canWriteFiles": true,
    "canRunShell": true,
    "canUseGit": false,
    "canUseNetwork": false
  }
}
```

### Acceptance criteria

- Sidecar cannot bypass Rust workspace checks.
- Diagnostics show rust-mediated mode, enabled tools, and approval-required tools.
- Future capability toggles default to false.
- Restarting the sidecar clears in-memory runtime auth.

## Priority 5: Conformance testing

### Goal

Borrow the useful parts of conformance testing without adopting heavyweight evidence infrastructure.

### Test groups

#### Sidecar smoke tests

Verify:

- Bundle exists.
- Host starts.
- `ping` responds.
- `info` loads expected Pi packages.
- Shutdown exits cleanly.

Commands:

```bash
pnpm run build:sidecars
pnpm run smoke:pi-host
```

#### Protocol contract tests

Verify:

- Invalid JSON returns parse error.
- Unknown method returns method not found.
- Invalid params return invalid params.
- Diagnostics never expose secrets.
- Model list never exposes secrets.
- Notifications do not block responses.

Files:

- `sidecars/pi-host/protocol.test.js`
- `sidecars/pi-host/model-catalog.test.js`
- `sidecars/pi-host/provider-config.test.js`

#### Session streaming tests

Verify:

- Create session.
- Send prompt.
- Receive deltas.
- Receive final text.
- Receive final status.
- Reject concurrent prompt.
- Stop running session.
- Late events after stop are ignored.

Files:

- `sidecars/pi-host/sessions.test.js`
- `sidecars/pi-host/host.test.js`
- `src/modules/pi/lib/sessions.test.ts`

#### Bundle verification tests

Verify:

- `scripts/build-pi-host-bundle.mjs` includes all sidecar files.
- `package.json` `files` list stays in sync.
- Smoke test uses bundled output, not source tree.

### Example protocol invalid method test

```js
writeRequest(child, 1, "not.real");
await expect(readResponse(lines)).resolves.toMatchObject({
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32601,
  },
});
```

### Acceptance criteria

- `pnpm test` passes in normal parallel mode.
- Serialized Vitest run passes.
- Sidecar smoke passes after bundle build.
- Tests are stable under CI load.
- Timeouts are long enough for cold imports and short enough to catch hangs.

## Priority 6: Runtime prewarm

### Goal

Borrow startup optimization ideas while preserving zero idle cost for users who never use Pi.

### Desired behavior

Lazy start by default, with targeted prewarm.

Start the Pi sidecar when:

1. User opens the Pi sidebar.
2. User has Pi enabled and a workspace is ready.
3. User opens Settings > Models and enters Pi profile mode.

Do not start Pi when:

1. App starts and Pi is never opened.
2. No workspace is authorized.
3. Settings are opened for unrelated sections.

### Reasoning

- Sidecar cold start costs time and memory.
- Prewarming on Pi sidebar open makes first prompt faster.
- Avoiding startup for non-Pi users preserves Terax's lightweight product goal.

### Example frontend shape

```ts
useEffect(() => {
  if (!isPiPanelVisible) return;
  if (!workspaceRoot) return;
  void piNative.start();
}, [isPiPanelVisible, workspaceRoot]);
```

### Acceptance criteria

- Pi sidecar starts automatically when Pi panel is opened with a workspace.
- Closing the panel does not kill active sessions unexpectedly.
- Users who never open Pi do not pay sidecar startup cost.
- Diagnostics show `starting` and `ready` states clearly.

## Priority 7: Stdout isolation

### Goal

Keep JSON-RPC stdout clean even if Pi SDK or dependencies write to stdout.

### Rule

The sidecar stdout stream must contain only JSON-RPC envelopes. Any log output must go to stderr or to structured JSON-RPC notifications.

### Reasoning

Rust reads sidecar stdout line by line and parses JSON. Any random stdout text can corrupt the protocol and break all pending calls.

### Existing test to preserve

`sidecars/pi-host/host.test.js` includes a test named:

```text
keeps Pi SDK stdout writes off the JSON-RPC stream
```

Strengthen this by making sure:

- The sidecar captures or redirects noisy stdout during prompt execution.
- Notifications are valid JSON-RPC envelopes.
- Raw text never appears on stdout.

### Example expected notification

```json
{
  "jsonrpc": "2.0",
  "method": "session.event",
  "params": {
    "id": "evt-3",
    "type": "session.output.delta",
    "sessionId": "pi-1",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "payload": { "text": "hello" }
  }
}
```

### Acceptance criteria

- All stdout lines parse as JSON.
- Unknown stdout text fails tests.
- Stderr tail is available for diagnostics on host failure.

## Priority 8: Event ordering and transcript stability

### Goal

Borrow the emphasis on stable streaming and reproducible session state.

### Invariants

1. Event IDs are monotonic within a sidecar process.
2. Persisted history and live events dedupe by event id.
3. Final text does not duplicate deltas in the transcript.
4. Session status transitions are deterministic.
5. Stopped sessions remain visible after restart.

### Current event types

- `session.created`
- `session.input`
- `session.status`
- `session.output.delta`
- `session.output.text`
- `session.error`

### Example event merge rule

```ts
function mergePiSessionEvents(
  current: PiSessionEvent[],
  incoming: PiSessionEvent[],
): PiSessionEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort(compareEventIds);
}
```

### Reasoning

Live notifications and method responses can both contain events. Without dedupe, transcripts can duplicate user prompts or output. Without stable ordering, transcript rendering can flicker or show final text before deltas.

### Files

- `sidecars/pi-host/sessions.js`
- `src/modules/pi/lib/sessions.ts`
- `src-tauri/src/modules/pi/store.rs`
- `src/modules/pi/components/PiTranscript.tsx`

### Acceptance criteria

- Duplicate event IDs replace old versions or are ignored consistently.
- Transcript order is stable after reload.
- Final text handling is tested.
- Restarted app loads session history without duplicate output.

## Priority 9: Session cleanup

### Goal

Borrow stronger lifecycle discipline.

### Required cleanup behavior

When a session is stopped:

1. Abort active prompt if running.
2. Dispose the Pi SDK session if supported.
3. Unsubscribe event listeners.
4. Run test cleanup hooks.
5. Mark the session `stopped`.
6. Ignore late completion or error callbacks.

When sidecar shuts down:

1. Stop all sessions.
2. Dispose all subscriptions.
3. Exit cleanly.

When Rust detects transport failure:

1. Clear the current host handle.
2. Mark live sessions as stopped or runtime lost in UI.
3. Allow a fresh sidecar spawn on next action.

### Existing sidecar cleanup shape

`sidecars/pi-host/sessions.js` already has `disposeSession(session)` and late callback checks. Keep expanding tests around this behavior.

### Example tests

- Stop an idle session.
- Stop a running session.
- Stop twice.
- Stop missing session.
- Abort raises internally but session still becomes stopped.
- Late `runPrompt` completion does not turn a stopped session back to idle.

### Acceptance criteria

- No event listener leak after stop.
- No prompt continues after stop from the user's perspective.
- `pi_stop` shuts down the child process.
- `PiHost::shutdown` falls back to kill if graceful shutdown fails.

## Priority 10: Profile mode refresh

### Goal

Make existing Pi profile mode easier to use after the user changes terminal Pi auth or model files.

### Current behavior

Profile catalog loads when profile mode is enabled.

### Problems

- If the user authenticates in terminal Pi while Terax is open, the profile catalog may stay stale.
- If `models.json` changes, the dropdown may not update until profile mode is toggled.

### Improvements

1. Add a refresh button in the Pi model picker when profile mode is active.
2. Refetch profile catalog when the dropdown opens.
3. Keep the current selected profile model if it still exists.
4. Show profile directory.
5. Show profile catalog load error.
6. Show unavailable models as disabled with `Needs auth in Pi profile`.

### Example UI copy

- `Existing Pi profile`
- `Refresh profile models`
- `Profile catalog loaded from /Users/name/.pi/agent`
- `Pi profile directory not found. Run Pi once in your terminal or set PI_CODING_AGENT_DIR.`

### Files

- `src/settings/sections/ModelsSection.tsx`
- `src/modules/pi/lib/native.ts`
- `sidecars/pi-host/model-catalog.js`

### Acceptance criteria

- User can refresh profile models without toggling profile mode off and on.
- Errors are visible and actionable.
- Profile path is shown but no secret values are shown.
- Tests cover unavailable profile models.

## Priority 11: Version and provenance diagnostics

### Goal

Borrow the idea of making runtime provenance visible without adopting heavyweight evidence gates.

### Add lightweight provenance

Expose:

- Terax app version.
- Pi host version.
- Pi package versions.
- Node runtime version.
- Sidecar bundle path.
- Build mode if available.

Example:

```json
{
  "hostVersion": "0.1.0",
  "packages": [
    { "name": "@earendil-works/pi-coding-agent", "version": "0.78.0", "loaded": true }
  ],
  "node": {
    "version": "v22.0.0",
    "execPath": "/path/to/node"
  }
}
```

### Reasoning

When a packaged app differs from development, users need a quick way to report exactly which runtime Terax used.

### Acceptance criteria

- Diagnostics card can copy or display compact version details.
- No local secret paths are exposed beyond sidecar path and profile directory that the user opted into.

## Priority 12: User facing recovery actions

### Goal

Diagnostics should not only report problems. They should provide next actions.

### Examples

| Problem | Action |
| --- | --- |
| Pi runtime stopped | Start runtime |
| Runtime error | Restart runtime |
| Missing key | Open Settings > Models |
| Missing workspace | Open workspace |
| Profile directory missing | Show setup guidance |
| Sidecar package missing | Rebuild sidecars in development |
| Session stuck running | Stop session |

### Implementation shape

`buildPiDiagnosticsView` can emit action ids:

```ts
type PiDiagnosticsAction =
  | "open-settings"
  | "refresh"
  | "start-runtime"
  | "restart-runtime"
  | "stop-session";
```

UI can map actions to handlers in `PiDiagnosticsCard` or `PiPanel`.

### Acceptance criteria

- Each destructive or blocking issue has a next step.
- No issue shows a dead button.
- Actions are tested in view model tests where possible.

## Suggested implementation order

1. Fix `host.test.js` parallel flake.
2. Fix incomplete custom endpoint picker state.
3. Improve diagnostics payload and diagnostics UI.
4. Add timeout classes for sidecar calls.
5. Add dynamic model catalog with TTL.
6. Add explicit capability state and kill switches.
7. Expand conformance and smoke coverage.
8. Add runtime prewarm.
9. Harden event ordering and transcript stability.
10. Harden session cleanup.
11. Improve profile mode refresh.
12. Add provenance diagnostics and recovery actions.

## Verification commands

Frontend and sidecar:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm exec vitest run --fileParallelism=false
pnpm run build:sidecars
pnpm run smoke:pi-host
```

Rust, when disk space allows:

```bash
cd src-tauri
cargo clippy
cargo test --locked
```

Known local limitation from the review session:

```text
cargo test failed because the machine had only about 1.4 GiB free and rustc could not build the test archive.
```

## Definition of done for any item in this document

A change is done only when:

1. It preserves the Node sidecar architecture.
2. It does not copy `pi_agent_rust` source code.
3. It keeps secrets out of diagnostics, logs, and protocol responses.
4. It keeps tools Rust-mediated and preserves the reviewed capability bridge invariants.
5. It has tests for the core invariant.
6. It passes:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm run build:sidecars
pnpm run smoke:pi-host
```

7. Rust checks pass when local disk space allows.
