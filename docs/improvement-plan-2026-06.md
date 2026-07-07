# Terax Improvement Plan (June 2026)

> Superseded on 2026-06-11 by `docs/sota-plan-2026-06-11.md`. The webview-native Pi agent shipped at sidecar parity the same day this plan was written, and the Node Pi sidecar has since been deleted. This plan's sidecar hardening and bundle-size guidance is historical only. Use `docs/pi-runtime.md` and `docs/pi-sidebar-release-readiness.md` for current Pi runtime truth.

Derived from `docs/architecture-review-2026-06.md`. Each major decision below lists the alternatives that were considered and why the chosen option wins. Phases are ordered by leverage; within a phase, items are independent unless noted.

Verification bar for every item (per TERAX.md): `pnpm exec tsc --noEmit`, `pnpm test`, `cargo clippy`, `cargo test --locked`, and a test locking the invariant for any core-subsystem change.

---

## 0. Strategic decisions (alternatives considered)

### D1. Agent runtime: converge on the pi webview path, retire the other two stacks

Options considered:

- **A. Status quo**: keep ai/ legacy, pi sidecar, and pi webview in parallel. Rejected: triple maintenance of providers, models, tools, approvals; divergence already causing bugs (tool-name mismatch); 50-70 MB bundle cost for the sidecar+Node runtime against a 7-8 MB product target.
- **B. Converge on the legacy ai/ stack** (AI SDK v6 agent) and delete pi. Rejected: loses the pi SDK's session model (fork, rollback, JSONL persistence, extensions/skills via `DefaultResourceLoader`), which is the strategic direction per ROADMAP and the SOTA docs; ai/ has 12% test coverage vs pi's 36%.
- **C. Keep the sidecar as the one true runtime** and delete the webview path. Rejected: permanent 50-70 MB Node runtime per platform, orphan-process class of bugs, JS sidecar without type safety, protocol-version brittleness, and a second approval gate that complicates the security story.
- **D. Converge on the pi webview path using `createAgentSession`, Rust-mediated tools via a new `pi_native_tool` command, then delete the sidecar and fold ai/ chat UX onto pi sessions.** Chosen: this is the documented SOTA target, eliminates the heaviest artifact in the bundle, leaves exactly one approval gate (Rust), and reuses the pi SDK instead of maintaining a hand-rolled agent loop.

### D2. Sidecar hardening: minimal, not maximal

Options: (a) fully harden the sidecar (process groups, auto-restart with backoff, approval persistence, capability negotiation, backpressure) or (b) fix only the security-relevant bug (approval-state loss) plus process-group kill, and spend the rest of the effort on making the sidecar deletable.

Chosen: **(b)**. Auto-restart, protocol capability negotiation, and backpressure engineering are wasted work if D1 lands within two quarters. The two fixes kept are cheap and close real holes in the interim.

### D3. App.tsx refactor: incremental coordinator extraction, not a rewrite

Options:

- **A. Full rewrite** around a state machine (XState) or a routing layer. Rejected: high risk, big-bang, and the PTY-keepalive tab model ("never unmount, hide via CSS") is load-bearing and easy to break.
- **B. Context providers per surface** (code surface, chat surface, pi surface) plus extraction of the 18 `useApp*` hooks into 3-4 domain coordinators. Chosen: mechanical, reviewable in slices, removes prop drilling and ref-map plumbing without changing runtime behavior.
- **C. Leave as is.** Rejected: every new surface adds hooks, refs, and callbacks to App.tsx; the file grew past 900 lines and is the app's widest re-render amplifier.

### D4. Store architecture: keep zustand, ban store-to-store imports, fine-grained selectors

Options: migrate to jotai/atoms (rejected: churn across 8 stores and 670 files for marginal gain), collapse into one global store (rejected: worsens the fan-out problem), or keep zustand with two enforced rules: no store imports another store (compose via plain functions or subscriptions at the edge), and all component reads go through narrow selectors with `useShallow` where needed. Chosen: the last. It fixes F3/F6/F7 without a framework migration.

### D5. List virtualization: use the existing `@tanstack/react-virtual` dependency

Options: react-window (new dependency), content-visibility CSS (insufficient for chat anchoring), or `@tanstack/react-virtual`, which is already in package.json and already proven in the explorer. Chosen: tanstack-virtual everywhere a transcript or message list renders (PiTranscript, AiChat). Zero new dependencies, consistent with the "earn dependencies" product principle.

### D6. E2E testing: WebdriverIO + tauri-driver, smallest useful suite

Options: Playwright against the dev-server webview only (rejected: misses the IPC and PTY layers, which is where regressions live), full Cypress suite (rejected: weight), or tauri-driver-based e2e on Linux CI covering 5-6 golden flows. Chosen: the last; Linux-only is acceptable because the flows exercise shared code, and platform-specific PTY behavior is already covered by Rust tests.

### D7. Sidecar type safety: do not migrate to TypeScript

Given D1 deletes the sidecar, invest nothing in a TS migration. Interim safety comes from the behavioral boundary test (Phase 2) and existing vitest suites.

---

## Phase 1: Quick wins and hardening (1-2 weeks, parallelizable)

Cheap items that close real gaps regardless of later phases.

1.1 **Enable the Biome linter** (`biome.json` `linter.enabled: true`), fix or suppress the initial fallout, and add `biome check ./src` to CI as a required step. Include `sidecars/pi-host` and `scripts/` in the lint scope while they exist.

1.2 **Make `pnpm audit` blocking** for high/critical severities in CI (remove continue-on-error; allow a documented ignore-list file for accepted advisories).

1.3 **Bundle-size gate**: after `vite build`, fail CI if gzipped webview assets exceed a checked-in budget (start at current size + 5%). Also assert the pruned pi-host bundle stays under a threshold in `build-pi-host-bundle.mjs` while the sidecar exists.

1.4 **Sidecar process-group kill** (P3/R2): spawn the sidecar in its own process group/session (Unix `setsid`; Windows Job Object, mirroring `pty/job.rs`) and kill the group on shutdown. Add a Rust test that descendants do not survive host drop.

1.5 **Persist pending tool approvals in the sidecar** (P2): write pending approvals to a sidecar-adjacent state file keyed by session and tool-call id; on resume, re-emit or auto-deny them so a denied tool can never silently retry. Test: crash mid-approval, resume, assert denial event present.

1.6 **Expand the secret deny-list** (R5): add `~/.aws/credentials` (file, not just dir), `~/.docker/config.json`, `~/.config/gcloud/`, `~/.kube/config`. Extend the existing `fs/safety.rs` tests.

1.7 **Repo hygiene**: delete `--full-page` and `app-sidebars-preview.png` from the root (move screenshots to `docs/`), fill or delete the placeholder `AGENTS.md`, decide whether `dist/` should stay committed (recommended: stop committing it; CI builds it).

1.8 **Delete vestigial Rust modules** (R7): `skills.rs`, `sync.rs`, `proc.rs` if grep confirms no callers; gate `mcp/connections/http.rs` behind a feature instead of `#![allow(dead_code)]`.

Exit criteria: CI red on lint, audit, or bundle regressions; crash-safe approvals; no orphaned sidecar descendants.

---

## Phase 2: Pi convergence, part 1: unblock the SOTA migration (2-4 weeks)

Goal: the webview path reaches feature parity with the sidecar using `createAgentSession`, behind the existing `USE_WEBVIEW_AGENT` flag.

2.1 **Implement `pi_native_tool` Tauri command** (P1). Wrap the existing `native_tools.rs` dispatch: validate session and cwd against the workspace registry, evaluate capability policy (Auto/Ask/Deny), record the audit entry, execute. This is the same code path the sidecar bridge uses, exposed as a first-class command. Lock with Rust tests mirroring `host/tests.rs` coverage.

2.2 **Resolve the tool-name mapping** (P8 partial): produce a single source-of-truth table (pi SDK factory name, wire name, Rust dispatch name) checked by a unit test on both sides. Fix the existing `read_file` vs `read` mismatch.

2.3 **Add `@earendil-works/pi-coding-agent` to the root package.json** (currently only transitive through the sidecar workspace).

2.4 **Build the four SOTA adapters** in `src/modules/pi/`:
   - `keychain-auth-adapter`: pi `AuthStorage` backed by `secrets_*` commands.
   - `terax-tool-bridge`: `nativeToolExecutor` calling `invoke("pi_native_tool")`.
   - `terax-system-prompt`: unify the existing `prompt-context.ts` (TERAX.md memory) and `pi-skills.ts` discovery into one prompt builder.
   - `event-mapper`: port `session-event-mapper.js` logic to TS once, shared with the turn-diff code already in `pi/lib/` (kills that duplication).

2.5 **Replace `webview-session.ts` internals with `createAgentSession`** via an `agent-session-wrapper`, preserving fork, rollback, interactive questions, and archive/restore (P10). First verify which of these the pi SDK supports natively; implement only the gaps in the wrapper. Keep the external interface of the pi controller stable so components do not churn.

2.6 **Behavioral approval-boundary test** (P7): replace string matching in `check-pi-approval-boundary.mjs` with (or augment it by) a vitest integration test that mocks the executor and asserts: approval-required tool without approval does not execute; denial stops execution; auto tools execute and audit. Run against whichever path is active.

Exit criteria: with `USE_WEBVIEW_AGENT=true`, all pi panel features work through `createAgentSession` + `pi_native_tool`, with one approval gate (Rust), passing the behavioral boundary test.

---

## Phase 3: Pi convergence, part 2: retire the duplicates (3-6 weeks, after Phase 2)

3.1 **Delete the sidecar**: `sidecars/pi-host/`, `sidecars/node/`, `build-node-runtime.mjs`, `build-pi-host-bundle.mjs`, `smoke-pi-host-bundle.mjs`, the sidecar resources in `tauri.conf.json`, and the Rust supervisor (`pi/host.rs`, `host/bridge.rs`, `host/protocol.rs`); keep `native_tools.rs`, `store.rs`, `state.rs`. Bundle shrinks ~50-70 MB per platform; the orphan-process and protocol-version risk classes disappear (P3, P4, P5, P9, R1, R2 all close by deletion).

3.2 **Remove the `USE_WEBVIEW_AGENT` flag**: one code path.

3.3 **Unify provider config and model catalog**: one TS module consumed by pi sessions, the composer model picker, model-compare, and settings. Today this exists three times (`ai/config.ts`, `provider-config.js`, `model-catalog.js`).

3.4 **Fold the legacy ai/ chat onto pi sessions**: migrate the docked composer, mini window, and session persistence to the pi session model; map `chatStore.agentMeta` consumers (status bar, notifications bridge) onto pi controller state. Provide a one-time session import from `terax-ai-sessions.json`. Then delete `ai/lib/agent.ts`, `ai/tools/`, the approval flow, and `chatStore`'s agent-loop parts. This is the largest single item in the plan; slice it surface by surface (composer first, then mini window, then sessions list), keeping the old stack functional until the last slice.

3.5 **JSONL integrity on resume** (P6): validate the SDK session file before open (truncate to the last complete line, surface a "history recovered" notice). Belongs to whichever layer owns persistence after 3.1 (Rust `store.rs`).

Exit criteria: one agent stack, one provider registry, one approval gate; bundle size reduced; `pnpm test` and the behavioral boundary test green.

---

## Phase 4: Frontend architecture and performance (3-5 weeks, parallel with Phase 3 except 4.4)

4.1 **Virtualize transcripts** (F4, F10): `@tanstack/react-virtual` for `PiTranscript` and `AiChat` message lists, with stick-to-bottom preserved via the existing `use-stick-to-bottom` integration. Memoize event/message row components.

4.2 **chatStore re-render fix** (F3): convert all consumers to narrow selectors (`useShallow` for tuples); split streaming token deltas out of store state (ref or `useSyncExternalStore` channel) so token updates repaint only the active message row. Measure with React profiler before/after on a 200-message session.

4.3 **Store decoupling** (F6, F7): remove store-to-store imports by extracting the shared logic into plain functions under `lib/`; move the chats LRU map and persistence debounce inside the store's lifecycle (created in the store factory, torn down on reset). Add a lint rule or unit test forbidding `store/` files from importing other `store/` files.

4.4 **App.tsx slimming** (F1), target under 400 LOC in three slices:
   - Extract surface contexts: `CodeSurfaceProvider` (terminalRefs, editorRefs, searchAddons), `AgentSurfaceProvider` (composer wiring, notifications), `LayoutProvider` (sidebars, tabs visibility). Surfaces consume context instead of receiving 18 props.
   - Collapse the 18 `useApp*` hooks into 4 coordinators (workspace, tabs and surfaces, agents, palette and shortcuts), each owning its slice end to end.
   - Keep the documented invariants intact: unconditional `AiComposerProvider` mount and never-unmount tab surfaces. Lock both with a regression test (mount-stability test asserting PTY ids survive tab switches and provider hydration).
   - Note: depends on 3.4 for the agent surface slice; the other two slices can start immediately.

4.5 **PiPanel state** (F8): replace the custom `PiControllerProvider` polling/state with a zustand store with selectors, consistent with D4; split PiPanel into session-list, transcript, and composer children.

4.6 **WorkflowCanvas split** (F5): extract node and edge renderers into memoized components; isolate drag state so dragging repaints only affected nodes.

4.7 **Component size guard**: add a CI check (simple script) flagging new `.tsx` files over 600 LOC, warning-only at first.

Exit criteria: 60fps scroll on a 500-event transcript; token streaming repaints scoped to one row; App.tsx under 400 LOC with invariants regression-tested.

---

## Phase 5: Quality gates and platform polish (2-3 weeks, ongoing)

5.1 **Frontend coverage in CI** (I3): vitest coverage upload, thresholds starting at current baseline, ratcheting up; explicit floors for `editor/`, `git-history/`, `theme/` once 5.2 lands.

5.2 **Tests for zero-coverage core modules** (F9): editor (extension wiring, vim-mode toggle, theme application), git-history (graph layout from a fixture log), theme (applyTheme CSS-variable output, validateTheme rejects malformed input), statusbar path utils.

5.3 **E2E suite per D6**: WebdriverIO + tauri-driver on Linux CI: open tab, run command, OSC 7 cwd updates breadcrumb; open file, edit, save; git stage and commit in a fixture repo; pi session sends a prompt with a mocked provider and an approval round-trip.

5.4 **Capability audit for shell/PTY** (R3): route `shell_run_command` and PTY spawn through `AppCapabilityState` audit (policy Auto, but recorded), making the audit log a complete record of OS-touching operations.

5.5 **Workspace authorization UX** (R6): require an explicit confirm dialog when `workspace_authorize` is called for a root outside home/launch dirs, and record it in the audit log.

5.6 **Supply chain** (I7, I9): generate a CycloneDX SBOM in the release workflow; sign Linux artifacts (GPG detached signatures published alongside .deb/.rpm/AppImage).

5.7 **shellcheck** the PTY init scripts and PowerShell script analysis in CI (I6).

---

## Sequencing summary

```
Phase 1 (hardening, gates)        [weeks 1-2]   independent items, start now
Phase 2 (pi webview parity)       [weeks 1-4]   2.1 first; rest parallel after
Phase 3 (delete sidecar, fold ai) [weeks 4-10]  strictly after Phase 2
Phase 4 (frontend perf/arch)      [weeks 3-8]   4.4 agent slice waits for 3.4
Phase 5 (quality gates, polish)   [weeks 6-9]   anytime; 5.4-5.5 anytime
```

## Success metrics

- One agent stack; `sidecars/` directory gone; installer size reduced by the Node runtime (~50-70 MB per platform).
- Exactly one approval gate, covered by a behavioral test, with a complete audit log including shell/PTY.
- CI blocks on lint, audit (high+), bundle budget, frontend coverage floor, and the e2e golden flows.
- App.tsx under 400 LOC; no component over 600 LOC without a recorded exception.
- 500-event transcript scrolls at 60fps; token streaming does not re-render the panel.
- Zero-test core modules eliminated (editor, git-history, theme each have suites).

## Explicit non-goals

- No framework migrations (zustand stays, no XState, no router).
- No TypeScript migration of the sidecar (it is being deleted).
- No new heavy dependencies; virtualization uses the existing `@tanstack/react-virtual`.
- No telemetry, in line with PRODUCT.md.
