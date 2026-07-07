# Terax Architecture Review (June 2026)

> Superseded on 2026-06-11 by `docs/sota-plan-2026-06-11.md` after the webview-native Pi agent landed (commits 8560add..3d4fcff). Kept for point-in-time per-layer detail only; the Pi runtime sections predate the deleted Node Pi sidecar and no longer reflect the codebase. Use `docs/pi-runtime.md` and `docs/pi-sidebar-release-readiness.md` for current Pi runtime truth.

Scope: full codebase on the `pi-sidebar` branch (794 files changed vs `main`, +127k lines).
Method: four parallel deep audits (Rust backend, React frontend, pi agent runtime, engineering infrastructure), cross-checked against TERAX.md, the pi SOTA architecture docs, and the live code.

Companion document: `docs/improvement-plan-2026-06.md` (the actionable plan derived from this review).

---

## 1. Executive summary

Terax is a well-engineered Tauri 2 desktop app with an unusually strong security posture for its category (industry-grade SSRF guard, OS keychain secrets, Rust-mediated tool execution, capability policy with audit log, signed updater). Module boundaries are clean, naming is consistent, and the living architecture doc (TERAX.md) is accurate and current.

The dominant architectural problem is not quality but **duplication and incomplete convergence**: the codebase currently carries **three parallel agent stacks**:

1. The legacy AI stack (`src/modules/ai/`, 13.1k LOC): AI SDK v6 `Experimental_Agent`, own tools, own approval flow, own sessions.
2. The pi sidecar path (`sidecars/pi-host/`, ~7.4k LOC JS + ~3k LOC Rust bridge): Node sidecar running `pi-coding-agent` over JSON-RPC, plus a bundled Node runtime (~50-70 MB per platform).
3. The pi webview path (`src/modules/pi/lib/webview-session.ts`, ~1k LOC, active via `USE_WEBVIEW_AGENT=true`): hand-rolled `new Agent()` integration that does not yet use `createAgentSession` as the SOTA architecture doc intends.

Each stack maintains its own provider config, model catalog, tool definitions, and approval flow. The intended target (documented in `docs/pi-integration-sota-architecture.md`) is a single webview-resident pi runtime with Rust-owned tool execution and no sidecar. The implementation is roughly 85% aligned on principles and 35% aligned on code. Finishing that convergence, then deleting the other two stacks, is the single highest-leverage improvement available, in correctness, bundle size, security surface, and maintenance cost.

Secondary themes, in priority order:

- Robustness gaps in the sidecar path (orphan processes, no auto-restart, approval state lost on crash) that matter only while the sidecar survives.
- Frontend scaling debt: `App.tsx` is a 934-line fat coordinator with 18 hooks and 17 ref maps; `useChatStore` fans out wide re-renders; `PiTranscript` and `AiChat` render unvirtualized lists.
- Quality-gate gaps: Biome linter disabled, no frontend coverage in CI, `pnpm audit` non-blocking, no bundle-size regression gate, zero tests in editor/git-history/theme.

Overall risk level: moderate. Nothing critical was found; the codebase is shippable. The plan focuses on convergence, hardening, and scaling.

---

## 2. System overview

```
+--------------------------------------------------------------+
| Webview (React 19, ~116k LOC)                                 |
|  modules/: terminal editor explorer tabs ai pi workflow       |
|            artifacts inbox model-compare source-control ...   |
|  3 agent stacks: ai/ (legacy), pi/ webview path, pi/ bridge   |
+------------------------------invoke()-------------------------+
| Rust (src-tauri, ~32k LOC, 154 commands)                      |
|  pty fs git shell net secrets workspace capabilities          |
|  pi (host supervisor + native tool dispatch) mcp artifacts    |
+----------------+----------------------+-----------------------+
                 | stdio JSON-RPC v2    | OS
        +--------v---------+     +------v------+
        | Node sidecar     |     | keychain,   |
        | pi-host (~7.4k)  |     | PTY, git,   |
        | + bundled Node   |     | processes   |
        +------------------+     +-------------+
```

Key invariants that hold today and must keep holding:

- The webview never touches the OS directly; all access goes through `invoke()`.
- All agent tool execution is Rust-mediated (`native_tools.rs` dispatch), policy-checked (Auto/Ask/Deny), and audited.
- Secrets live only in the OS keychain; the secret-path deny-list applies on read and write.
- The sidecar is spawned with `env_clear()` and never receives or persists API keys beyond in-memory session config.

---

## 3. Rust backend (src-tauri, ~32k LOC)

### Strengths

- **SSRF guard** (`net.rs`, 752 LOC): scheme whitelist, metadata-IP blocking, RFC1918/CGNAT classification, DNS-rebinding defense via IP pinning, redirect re-validation, header sanitization, timeout and body-size clamping. 13 tests. Industry-grade.
- **Capability policy** (`capabilities/`): Auto/Ask/Deny evaluation per tool, with a thread-safe audit log and per-operation entries. Applied to HTTP, file writes, shell, pi tools, MCP tools.
- **Secret-path deny-list** (`fs/safety.rs`): exact, substring, and extension matching with normalization; tested.
- **Error discipline**: thiserror enums, no unwrap/expect in production paths (lint-enforced), lock errors propagated rather than panicking.
- **497 test functions** across 62 files; pi host lifecycle and artifacts store are well covered.
- Correct `spawn_blocking` usage for subprocess work (git, shell, WSL, MCP, PTY spawn).

### Findings (ranked)

| # | Finding | Severity | Where |
|---|---------|----------|-------|
| R1 | Pi sidecar crash leaves sessions dead with no auto-restart; stale `PiHost` handles persist | Medium | `pi/state.rs`, `pi/host.rs` |
| R2 | Sidecar kill does not terminate the process group; grandchildren (in-flight HTTP tasks) can orphan | Medium | `pi/host.rs:172` |
| R3 | `shell_run_command` and PTY spawn bypass the capability audit entirely (mitigated by explicit user action, but inconsistent with the rest of the surface) | Medium | `shell/mod.rs:74`, `pty/mod.rs` |
| R4 | Symlink TOCTOU window between canonicalization and file access in workspace authorization | Low-Med | `workspace.rs:27`, `fs/safety.rs` |
| R5 | Secret deny-list misses `~/.aws/credentials` content patterns, `~/.docker/config.json`, gcloud config | Low | `fs/safety.rs:143` |
| R6 | `workspace_authorize` registers arbitrary roots with no UI confirmation step recorded | Low | `workspace.rs:142` |
| R7 | Vestigial modules: `skills.rs` (7 LOC), `sync.rs` (21 LOC), `proc.rs` (14 LOC) | Cleanup | `modules/` |
| R8 | `mcp/connections/http.rs` carries file-level `#![allow(dead_code)]`, signaling experimental status without a feature gate | Cleanup | `mcp/connections/http.rs:1` |

The 154-command IPC surface is large but coherent (consistent `module_verb` naming, no batch bypasses). Roughly 80% of high-risk commands carry explicit capability gates; the gaps are listed above.

---

## 4. Frontend (src/, ~116k LOC, 670 files)

### Strengths

- Clean module layout with barrels; zero `any`, 3 `@ts-expect-error` total, zero live TODO comments, ~90% `@/` import discipline.
- Theme engine, tabs, explorer, source-control are mature and appropriately sized.
- Virtualization already used in explorer, git-history rail, and source-control.

### Module size and test coverage

| Module | LOC | Test files | Note |
|--------|-----|------------|------|
| pi | 23,782 | 43 | active branch focus, two internal session paths |
| workflow | 22,725 | 44 | mature but `WorkflowCanvas.tsx` is 1,053 LOC |
| ai | 13,092 | 8 | legacy agent stack, 12% test ratio |
| artifacts | 5,632 | 16 | mature |
| explorer | 5,370 | 1 | thin coverage |
| model-compare | 4,646 | 7 | experimental |
| editor | 2,715 | 0 | zero tests, core surface |
| git-history | 1,574 | 0 | zero tests |
| theme | 2,084 | 0 | zero tests |

pi + workflow + ai together are 59.6k LOC, 51% of the frontend.

### Findings (ranked)

| # | Finding | Severity | Where |
|---|---------|----------|-------|
| F1 | `App.tsx` (934 LOC) is a fat root coordinator: 18 custom hooks, 17 ref maps for cross-module communication, 18 callback props into surfaces; any tab/sidebar state change re-renders wide | High | `src/app/App.tsx` |
| F2 | Two (three counting the sidecar) parallel agent stacks with incompatible session models, transports, and approval flows | High | `modules/ai/`, `modules/pi/` |
| F3 | `useChatStore` fan-out: 19 subscriptions in `AiMiniWindow`, 9 in `AgentRunBridge`; every token delta re-renders the AI surface | High | `ai/store/chatStore.ts` |
| F4 | `PiTranscript.tsx` (1,010 LOC) renders every session event with no virtualization; long sessions degrade linearly | High | `pi/components/PiTranscript.tsx` |
| F5 | `WorkflowCanvas.tsx` (1,053 LOC) monolith without sub-component memoization; full redraw on drag | Medium | `workflow/` |
| F6 | Store inter-coupling: chatStore imports planStore, todosStore, agentsStore directly | Medium | `ai/store/` |
| F7 | Module-scoped singletons (chats LRU `Map`, debounce timers) live outside the store lifecycle | Medium | `chatStore.ts:241-267` |
| F8 | `PiPanel.tsx` (1,008 LOC) makes 20+ `usePiControllerState` calls against a custom provider rather than a store | Medium | `pi/components/PiPanel.tsx` |
| F9 | Zero tests in editor, git-history, theme, statusbar, command-palette (46 files) | Medium | several |
| F10 | `AiChat.tsx` (841 LOC) message list unvirtualized | Medium | `ai/components/AiChat.tsx` |

Note: 15 components exceed 500 LOC; only 25 components in the whole app are `memo()`-wrapped.

---

## 5. Pi agent runtime (the current branch focus)

### Intended architecture (per `docs/pi-integration-sota-architecture.md`)

Pi SDK (`createAgentSession`) runs in the webview. Rust owns tool execution, workspace auth, artifacts, keychain. The bridge is a single `nativeToolExecutor` callback hitting a `pi_native_tool` command. No sidecar, no bundled Node, one code path, two-file persistence (`pi-sessions.json` metadata + SDK JSONL history).

### Actual state

| Aspect | Target | Actual |
|--------|--------|--------|
| Sidecar process | eliminated | still present and bundled (~50-70 MB/platform) |
| Webview uses `createAgentSession` | yes | no, hand-rolled `new Agent()` in `webview-session.ts` (~1,000 LOC) |
| `pi_native_tool` Tauri command | exists | does not exist (dispatch only reachable via sidecar bridge) |
| `DefaultResourceLoader` (extensions, prompts, themes) | used | not used |
| Pi `AuthStorage` via keychain adapter | used | hand-rolled |
| Rust-mediated tools | yes | yes (both paths) |
| Two-file persistence | yes | yes (both paths) |
| Approval gates | single Rust gate | two overlapping gates (sidecar extension + Rust policy) |

Verdict: ~85% aligned on principles, ~35% on implementation. The migration is blocked primarily by the missing `pi_native_tool` command and unresolved tool-name mapping between pi SDK factories, the webview bridge, and Rust dispatch.

### Findings (ranked)

| # | Finding | Severity |
|---|---------|----------|
| P1 | `pi_native_tool` command missing; SOTA migration blocked | Critical (migration blocker) |
| P2 | Tool approval state is in-memory only in the sidecar; lost on crash, and a denied tool can silently retry after resume | High |
| P3 | Sidecar kill leaves orphaned grandchildren (no process-group termination) | High |
| P4 | Protocol version check is all-or-nothing (`!= 2` fails everything); no capability negotiation | Medium (moot if sidecar is deleted) |
| P5 | No backpressure on the event stream; `protocolWriteQueue` and `_turnEvents` are unbounded | Medium |
| P6 | Resume does not validate JSONL integrity; a crash mid-send can corrupt history silently | Medium |
| P7 | `check-pi-approval-boundary.mjs` is string-matching, not behavioral; the boundary can be broken while the check passes | Medium |
| P8 | Provider config, model catalog, tool definitions, approval policy all duplicated between sidecar, webview pi, and legacy ai stacks | Medium |
| P9 | Sidecar is plain JS with ~40% JSDoc coverage; schema is hand-written and can drift from implementation | Low (moot if deleted) |
| P10 | `webview-session.ts` implements fork/rollback/questions that the SOTA adapter design does not yet account for; migrating without them is a feature regression | Medium |

---

## 6. Engineering infrastructure

### Strengths

- CI runs tsc, vitest, sidecar build + boundary check + smoke test, cargo check/clippy(-D warnings)/nextest across Ubuntu/macOS/Windows, with Rust LLVM coverage uploaded.
- Release pipeline: cross-platform matrix, Tauri updater minisign signing, Apple notarization, NSIS currentUser installer.
- Node runtime download is SHA256-verified and version-pinned (24.16.0); pi-host bundle is aggressively pruned.
- Dependabot for npm, cargo, and actions. Documentation (TERAX.md, CONTRIBUTING, SECURITY, ROADMAP, PRODUCT) is current and consistent.

### Gaps (ranked)

| # | Gap | Severity |
|---|-----|----------|
| I1 | Biome linter disabled (`biome.json`: `"enabled": false`); formatting only | High |
| I2 | `pnpm audit` runs with continue-on-error; known CVEs can ship | Med-High |
| I3 | No frontend coverage tracking or thresholds in CI (Rust has lcov; frontend has nothing) | Medium |
| I4 | No bundle-size regression gate (7-8 MB target enforced only by a Vite warning) | Medium |
| I5 | No e2e tests (no tauri-driver/WebdriverIO); only the pi-host smoke test | Medium |
| I6 | Sidecar JS and PTY shell-init scripts are unlinted (no shellcheck, no Biome scope) | Low-Med |
| I7 | Linux release artifacts unsigned | Medium |
| I8 | Sidecar bundle size logged but not validated post-pruning | Low |
| I9 | No SBOM generation in releases | Low |
| I10 | Repo hygiene: stray root files (`--full-page`, `app-sidebars-preview.png`), committed `dist/`, placeholder `AGENTS.md` | Low |

---

## 7. Consolidated risk register (top 12 across all layers)

1. **P1** Missing `pi_native_tool` command blocks the entire SOTA convergence; everything else in the pi plan queues behind it.
2. **F2/P8** Triple agent-stack duplication: every provider, model, tool, or approval change must be made three times; divergence is already visible (tool naming mismatch).
3. **P2** Approval state loss on sidecar crash is a silent-security-bypass class bug.
4. **P3/R2** Orphaned sidecar descendants leak resources across sessions.
5. **F3** chatStore re-render fan-out makes long AI responses progressively jankier.
6. **F4/F10** Unvirtualized transcripts cap usable session length.
7. **F1** App.tsx coordinator is the main drag on feature velocity and the main re-render amplifier.
8. **I1/I2** Disabled linter and non-blocking audit are cheap, high-value fixes left on the table.
9. **R1** No sidecar auto-restart turns transient crashes into user-visible dead sessions.
10. **F9** Zero-test core modules (editor, git-history, theme) make refactors there blind.
11. **P7** The approval-boundary CI check verifies strings, not behavior.
12. **R3** Shell/PTY commands sit outside the otherwise-consistent capability audit.

---

## 8. What is genuinely state of the art already

Worth stating so the plan does not fix what is not broken:

- The Rust-mediated tool boundary with policy + audit is ahead of most AI-IDE products, which run tools in the JS/agent process.
- The SSRF proxy is more complete than typical Electron/Tauri apps (DNS pinning, redirect re-validation).
- OSC 133/7-driven terminal agent detection with zero idle cost is an elegant design.
- ConPTY Job Objects for descendant cleanup on Windows show rare platform diligence.
- The build pipeline's checksum-verified Node runtime and pruned sidecar bundle are solid supply-chain practice; the plan's job is to make the sidecar unnecessary, not to criticize how it is built.
