# Pi sidebar release-readiness notes

Tracking note for PR #964 (`pi-sidebar`) and the webview-native Pi size-fix tail. This file records what has been verified by automation/local commands and what still needs an interactive macOS/live-provider pass before release.

## Current PR state

- PR: <https://github.com/crynta/terax-ai/pull/964>
- Head branch: `mehmetcanbudak:pi-sidebar`
- Latest frontend gate verification covers Pi boundary (including the approval e2e wiring guard, release-doc verifier, CI release-gate guard, and historical sidecar-doc banner guard), updater-key plus updater cutover-doc and feed-inspector guards, format, typecheck, lint, full Vitest, coverage, build, and bundle-size checks; latest Rust check verification head is `a3c938a3e` for default, workflow, and openclicky cargo check; the full Rust test/clippy/release-app build matrix remains verified at `06ce0ddde`, with no `src-tauri` file changes since that matrix.
- GitHub merge state: `DIRTY` / merge-conflicted against `origin/main`; see `docs/pi-sidebar-merge-conflict-audit.md` for the 99-path conflict list.
- Visible checks: `gh pr checks` shows CodeRabbit-only states and still no GitHub Actions runs for this fork PR. This branch adds `workflow_dispatch` to CI, but `gh workflow view CI --repo crynta/terax-ai --yaml` confirms the current base/default workflow still lacks it; manual triggering will not be exposed until maintainers resolve conflicts and accept or merge that workflow change.

## Completion audit checklist

| Status | Objective requirement | Evidence inspected | Remaining gap |
| --- | --- | --- | --- |
| Done | Commit and push `pi-sidebar`; open PR. | PR #964 exists at <https://github.com/crynta/terax-ai/pull/964>; pushes to `mehmetcanbudak:pi-sidebar` continue to succeed and PR body updates are accepted. | None for PR creation/push. |
| Blocked | Confirm CI/e2e green. | `gh pr checks 964 --repo crynta/terax-ai` reports only CodeRabbit states, not GitHub Actions; `gh pr view` reports `mergeStateStatus=DIRTY`; earlier `gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 20` returned no Actions runs. Branch CI config now includes `workflow_dispatch`, and `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'` parses it. `pnpm check:ci-release-gates` statically guards the PR trigger, manual dispatch, frontend, Rust, coverage, updater, bundle-size, and Linux e2e gates. Follow-up dispatch probe: `gh workflow run CI --repo mehmetcanbudak/terax-ai --ref pi-sidebar` returned "could not find any workflows named CI"; `gh workflow run CI --repo crynta/terax-ai --ref pi-sidebar` returned HTTP 403 "Must have admin rights to Repository". | GitHub Actions and Linux e2e are not available for this dirty fork PR; maintainer must resolve conflicts and let base PR CI run or accept the workflow dispatch change before manual triggering is possible. |
| Blocked | Document and complete manual macOS Pi smoke pass: key save/load, chat, built-in agents, custom Zai endpoint auth, streaming, stop/resume, app restart restore, and window-close behavior. | Checklist below records every named manual item and evidence to capture; `docs/pi-sidebar-manual-smoke-report.md` is a maintainer-fillable report template. | Maintainer must run it in a packaged app with real credentials. |
| Done, not locally executable | Add security-critical mock-provider e2e coverage for Pi tool approval approve and deny through Rust `pi_agent_tool_execute`. | `e2e/specs/pi-approval.e2e.mjs` covers approve creates the fixture and deny leaves it absent; `wdio.conf.mjs` includes `./e2e/specs/**/*.e2e.mjs`; `.github/workflows/ci.yml` runs `xvfb-run -a pnpm e2e`; `src/modules/pi/bridge/pi-mock.ts` emits the deterministic tool calls; `docs/pi-native-tool-bridge.md` links the flow; `node --check e2e/specs/pi-approval.e2e.mjs` passed and local glob expansion includes the spec; `pnpm check:pi-boundary` now statically guards the spec, mock sentinel prompts, WebdriverIO glob, and Linux e2e CI command. | Full e2e execution requires Linux or Windows `tauri-driver`; macOS WKWebView has no driver. |
| Partial | Complete Phase C/D convergence. | `src/modules/ai/lib/composerRuntime.ts` and tests cover Pi-backed quick ask; `src/app/App.tsx` and `src/app/AppWorkspaceSurface.tsx` route the Pi composer path to Pi surfaces; `docs/phase-c-convergence-plan.md` records the residual import audit; `pnpm run check:pi-surface-isolation` now guards that `AiChat`, `AiChatMessage`, `PlanDiffReview`, and `TodoStrip` stay isolated to the legacy mini-window fallback or tests. | Legacy `AiChat`, `AiChatMessage`, `PlanDiffReview`, and `TodoStrip` remain for the fallback chat-runtime mini window until Pi composer can become default after CI and smoke pass. Runtime collapse/rename remains deferred. |
| Done | Handle touched cleanup and hardening items. | Evidence spans provider/model persistence tests in `src/modules/pi/lib/webview-session.test.ts`, MCP connection/error surfaces in `src/modules/pi/lib/useMcpSurface.ts` and `src-tauri/tests/mcp_manager_runtime.rs`, URLSearchParams proxy body handling in `src/modules/ai/lib/proxyFetch.ts`, retry UX in `src/modules/pi/components/PiComposer.test.tsx`, MCP `raw_data` capping in `src-tauri/src/modules/pi/native_tools/mcp_tools.rs`, historical sidecar-era docs marked superseded including the T3 comparison report, `pnpm run check:no-pi-sidecar` now guarding sidecar-era docs for historical/superseded/not-current banners, and Voice/3D gating in `src/modules/ai/lib/featureGates.ts` plus Rust capability manifests. | No known local code gap; release validation still depends on CI/manual blockers. |
| Blocked | Complete updater key rotation and verify fresh plus pre-rotation update paths. | `docs/updater-key-rotation.md` documents the new public key status, current `tauri-apps/tauri-action@v0` secret-name wiring for `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, secret-access 403, transition-release recommendation, maintainer-ready release-note language for both migration outcomes, and live `v0.8.2` feed signatures still carrying old key id `3BABFD8AB60E3469`; `pnpm check:updater-key-rotation` now guards the local pubkey, endpoint, workflow-secret wiring, required key ids, release-note variants, feed-inspector command, and signed-feed verification notes. `pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469` confirms the current public feed is old-key signed, while the same command with `--expect-key 52D6B9847A3B8F15` fails until a new-key signed release or test feed exists. | Maintainer must verify/configure signing secret values, produce a new-key signed release or test feed, decide transition release feasibility, put the selected migration note into the actual release notes, and verify signed update feeds. |
| Done | Keep default app about 11 MB. | `pnpm tauri build --bundles app --no-sign --ci` and `du -sh src-tauri/target/release/bundle/macos/Terax.app` reported `11M`; JS gzipped bundle is `1949.8 KB` against `2050.8 KB`. | Re-run after conflict resolution and final merge. |
| Done | Keep Node Pi sidecar deleted. | `pnpm run check:no-pi-sidecar` passed, scanning tracked paths, sidecar config, and sidecar-era docs for deleted `sidecars/pi-host`, bundled Node runtime paths, Pi-host build scripts, Tauri resource entries, and required historical/superseded/not-current banners. Only the existing `speech-recognizer` sidecar remains allowed. | Historical architecture docs still mention the old sidecar as past context, with banners guarded by automation. |
| Done | Ensure static frontend Tauri invokes have Rust handlers or intentional graceful degradation. | `pnpm run check:tauri-invokes` passed with 172 unique commands across 248 literal invokes and 32 documented feature-gated commands; `pnpm run check:pi-boundary` now chains this static invoke audit after the Pi approval boundary check. | Re-run after conflict resolution. |
| Done locally | Pass pnpm and Rust verification gates. | Full command list below includes format, typecheck, lint, tests, coverage, build, bundle-size, Rust default, workflow, and openclicky checks. Latest frontend gate recheck after adding the updater feed inspector: `pnpm check:pi-boundary`, `pnpm check:ci-release-gates`, `pnpm check:updater-key-rotation`, `pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469`, `pnpm format:check`, `pnpm exec tsc --noEmit`, `pnpm lint` (passes with existing warnings), `pnpm test` (182 files, 1040 tests), `pnpm test:coverage` (182 files, 1040 tests, coverage report generated), `pnpm build`, and `pnpm check:bundle-size` (1949.8 KB / 2050.8 KB) passed. Latest Rust check recheck at `a3c938a3e`: `cargo check --all-targets --locked`, `cargo check --locked --features workflow`, and `cargo check --locked --features openclicky` passed. `git diff --name-only 06ce0ddde..HEAD -- src-tauri` returned empty, so the full Rust test/clippy/release-app build matrix at `06ce0ddde` still applies. | CI must independently run on the PR. |

## Local automated verification already run

Baseline full pass before the tail commits. Later audit confirmed no `src-tauri` files changed after this matrix (`git diff --name-only 06ce0ddde..HEAD -- src-tauri` returned empty), so these Rust/default/workflow/openclicky checks remain applicable to the current tail. A current-head Rust check re-run also passed after the latest frontend/docs tail.

```bash
pnpm format:check
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm check:pi-boundary
pnpm build
pnpm check:bundle-size
cd src-tauri && cargo check --locked --features workflow
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
cd src-tauri && cargo clippy --locked --all-targets --features workflow -- -D warnings
cd src-tauri && cargo clippy --locked --all-targets --features openclicky -- -D warnings
cd src-tauri && cargo test --locked
cd src-tauri && cargo test --locked --features workflow
cd src-tauri && cargo test --locked --features openclicky --test voice_tts
cd src-tauri && cargo build --release --locked
du -sh src-tauri/target/release/bundle/macos/*.app # 11M
```

Targeted checks after later tail commits:

```bash
node --check e2e/specs/pi-approval.e2e.mjs
python3 - <<'PY'
from pathlib import Path
specs = sorted(str(path) for path in Path('e2e/specs').glob('**/*.e2e.mjs'))
assert 'e2e/specs/pi-approval.e2e.mjs' in specs
PY
pnpm exec vitest run src/modules/pi/lib/webview-session.test.ts
pnpm exec vitest run src/modules/pi/bridge/pi-http.test.ts
pnpm exec vitest run src/modules/pi/lib/diagnostics.test.ts src/modules/pi/components/PiDiagnosticsCard.test.tsx src/modules/pi/components/PiRuntimeCard.test.tsx src/modules/pi/lib/chatArtifacts.test.ts src/modules/pi/lib/prompt-context.test.ts src/modules/pi/lib/tool-approval-policy.test.ts
pnpm exec vitest run src/modules/pi/lib/webview-session.test.ts src/modules/pi/lib/pi-lifecycle.integration.test.ts src/modules/pi/PiPanel.test.tsx
pnpm exec tsc --noEmit
pnpm format:check
pnpm lint
cd src-tauri && cargo check --locked
cd src-tauri && cargo test --locked provider_metadata_round_trips_through_history
cd src-tauri && cargo test --locked mcp_native_tool
```

Targeted checks after the Pi-backed quick-ask composer flag landed:

```bash
pnpm exec vitest run src/modules/ai/lib/composerRuntime.test.ts
pnpm exec tsc --noEmit
pnpm test # 172 files, 1006 tests
```

Targeted and full checks after the Voice and 3D feature-gating decision landed:

```bash
pnpm run format:check
pnpm run lint # exits successfully; existing warnings remain outside this change
pnpm run check:pi-boundary
pnpm exec tsc --noEmit
pnpm exec vitest run src/modules/ai/lib/featureGates.test.ts src/modules/ai/lib/slashCommands.test.ts src/modules/ai/lib/composerRuntime.test.ts src/modules/pi/components/PiTranscript.test.tsx src/modules/ai/components/AiChat.test.tsx
pnpm test # 174 files, 1010 tests
pnpm run build
pnpm run check:bundle-size # total 1949.5 KB gzipped, budget 2050.8 KB
pnpm tauri build --bundles app --no-sign --ci
# du -sh src-tauri/target/release/bundle/macos/Terax.app src-tauri/target/release/bundle/macos/Terax.app.tar.gz
# 11M Terax.app, 7.0M Terax.app.tar.gz
cd src-tauri && cargo fmt --check # exits successfully; rustfmt warns about ignored nightly-only config keys
cd src-tauri && cargo test --locked
cd src-tauri && cargo test --locked --test capability_registry
cd src-tauri && cargo check --locked --features workflow
cd src-tauri && cargo check --locked --features openclicky
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
cd src-tauri && cargo clippy --locked --all-targets --features workflow -- -D warnings
cd src-tauri && cargo clippy --locked --all-targets --features openclicky -- -D warnings
cd src-tauri && cargo test --locked --features openclicky --test voice_tts
```

Stage 3 mini-window routing and CI audit checks after the Pi conversation surface guard landed:

```bash
pnpm install --frozen-lockfile --offline
pnpm audit --prod --audit-level high # exits 0; remaining advisories are low/moderate
pnpm why hono --prod # resolves to hono@4.12.25 via pnpm-workspace override
pnpm exec vitest run src/app/AppWorkspaceSurface.test.ts src/app/AppSidebars.pi-chat.test.tsx src/app/AppSidebars.preview.runtime.test.tsx src/modules/ai/lib/composerRuntime.test.ts
pnpm run format:check
pnpm exec tsc --noEmit
pnpm run lint # exits successfully; existing warnings remain outside this change
pnpm test # 175 files, 1012 tests
pnpm test:coverage # 175 files, 1012 tests; coverage report generated successfully
pnpm run check:pi-boundary
pnpm run build
pnpm run check:bundle-size # total 1949.8 KB gzipped, budget 2050.8 KB
# du -sh src-tauri/target/release/bundle/macos/Terax.app
# 11M Terax.app
cd src-tauri && cargo check --all-targets --locked
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo test --locked # 326 lib tests plus integration/doc tests
cd src-tauri && cargo clippy --locked --all-targets --features workflow -- -D warnings
cd src-tauri && cargo test --locked --features workflow # 326 lib tests plus workflow integration tests
cd src-tauri && cargo clippy --locked --all-targets --features openclicky -- -D warnings
cd src-tauri && cargo test --locked --features openclicky --test voice_tts # 2 tests
```

Conflict and CI audit after pushing the Pi sidebar tail:

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD # 171 106
git merge-tree --write-tree HEAD origin/main # latest historical-doc-guard refresh still exits 1 with 99 conflicted paths; see docs/pi-sidebar-merge-conflict-audit.md
gh pr checks 964 --repo crynta/terax-ai # after latest docs-only push: no checks reported on pi-sidebar
gh workflow view CI --repo crynta/terax-ai --yaml # no workflow_dispatch trigger; PR/push to main only
gh workflow list --repo mehmetcanbudak/terax-ai --limit 50 # no workflows returned
gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 20 # no runs returned
gh api repos/crynta/terax-ai/pulls/964 --jq '{mergeable, mergeable_state}' # false, dirty
gh workflow run CI --repo mehmetcanbudak/terax-ai --ref pi-sidebar # could not find any workflows named CI
gh workflow run CI --repo crynta/terax-ai --ref pi-sidebar # HTTP 403: Must have admin rights to Repository
gh pr checks 964 --repo crynta/terax-ai # CodeRabbit pending after latest push; no GitHub Actions checks visible
```

Static Pi boundary audits added after the PR check visibility refresh:

```bash
pnpm run check:no-pi-sidecar # scans tracked files, sidecar config, and sidecar-era docs for deleted Pi host/runtime paths and required historical banners
pnpm run check:pi-surface-isolation # scans 546 source files for legacy AI surface isolation
pnpm run check:tauri-invokes # 172 commands, 248 literal invocations, 32 feature-gated commands documented
pnpm run check:pi-release-docs # guards release-readiness blockers plus the manual macOS Pi smoke template
pnpm run check:ci-release-gates # guards 21 required workflow gates for frontend, Rust, updater, coverage, and Linux e2e
pnpm run check:pi-boundary # chains Pi approval boundary, no-Pi-sidecar, surface-isolation, static invoke, release-doc, and CI release-gate audits
pnpm exec vitest run scripts/check-pi-surface-isolation.test.mjs scripts/check-no-pi-sidecar.test.mjs scripts/check-pi-approval-boundary.test.mjs scripts/check-tauri-invokes.test.mjs scripts/check-pi-release-docs.test.mjs scripts/check-ci-release-gates.test.mjs # 22 tests pass after adding Pi approval e2e, release-doc, historical sidecar-doc, and CI release-gate coverage to the boundary verifier
```

Latest frontend gate recheck after the approval e2e, updater-verifier, release-doc verifier, updater cutover-doc guard, historical sidecar-doc guard, CI release-gate guard, and updater feed-inspector updates:

```bash
pnpm check:pi-boundary # approval boundary, no-Pi-sidecar, sidecar-doc banners, surface isolation, invoke, release-doc, and CI release-gate audits pass
pnpm check:ci-release-gates # 21 required gates present
pnpm check:pi-release-docs # release-readiness blockers and manual smoke template coverage pass
pnpm check:updater-key-rotation # embedded key 52D6B9847A3B8F15, tauri-action@v0, 1 endpoint, cutover docs guarded
pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469 # current public v0.8.2 feed is old-key signed
pnpm run inspect:updater-feed -- --expect-key 52D6B9847A3B8F15 # exits 1 until a new-key signed feed exists
pnpm format:check # 723 files, no fixes applied
pnpm exec tsc --noEmit # exits 0
pnpm lint # exits 0 with existing warnings outside this tail
pnpm test # 182 files, 1040 tests
pnpm test:coverage # 182 files, 1040 tests; coverage report generated
pnpm build # exits 0 with existing Rollup/Vite warnings
pnpm check:bundle-size # total 1949.8 KB gzipped, budget 2050.8 KB

cd src-tauri && cargo check --all-targets --locked
cd src-tauri && cargo check --locked --features workflow
cd src-tauri && cargo check --locked --features openclicky

pnpm exec vitest run scripts/check-updater-key-rotation.test.mjs # 4 tests
pnpm exec vitest run scripts/inspect-updater-feed.test.mjs # 4 tests
pnpm exec vitest run scripts/check-pi-release-docs.test.mjs # 3 tests
pnpm exec vitest run scripts/check-ci-release-gates.test.mjs # 3 tests
node --check scripts/check-updater-key-rotation.mjs && node --check scripts/check-updater-key-rotation.test.mjs
node --check scripts/inspect-updater-feed.mjs && node --check scripts/inspect-updater-feed.test.mjs
node --check scripts/check-pi-release-docs.mjs && node --check scripts/check-pi-release-docs.test.mjs
node --check scripts/check-ci-release-gates.mjs && node --check scripts/check-ci-release-gates.test.mjs
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")' # workflow parses after adding dispatch and release gates
```

Updater feed inspection after adding the feed signature inspector:

```bash
gh release view --repo crynta/terax-ai --json tagName,assets # latest release is v0.8.2 with latest.json
pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469 # passes; every public latest platform is old-key signed
pnpm run inspect:updater-feed -- --expect-key 52D6B9847A3B8F15 # exits 1; no public latest platform is new-key signed yet
```

## Voice and 3D gating decision

Current decision for release: keep OpenClicky-derived AI tools and read-aloud TTS off by default. They are not part of the default size-fix path and their Rust commands are only registered with the `openclicky` feature. The frontend now treats them as explicit experimental gates instead of ambient tools:

- `localStorage["terax.experimental.openclickyAiTools"] = "true"` exposes overlay, screenshot, and Tripo 3D AI tools plus the `/3d` command.
- `localStorage["terax.experimental.ttsReadAloud"] = "true"` exposes read-aloud buttons on legacy AI and Pi transcripts.
- Default builds do not advertise those tools to the model and do not show read-aloud actions that would invoke unregistered commands.
- When `openclicky` is enabled, `tts_speak`, `transcribe_audio`, and `generate_3d_model` now record app capability-audit entries (`app.tts`, `app.transcription`, `app.3d_model`).

This does not disable the existing composer voice input path, which is a user-initiated MediaRecorder plus provider transcription flow and remains controlled by its existing key checks.

## Manual macOS Pi smoke checklist

These require an interactive packaged app and/or real configured provider credentials. They were not completed by the non-interactive agent session and must be run by a maintainer before release. Use `docs/pi-sidebar-manual-smoke-report.md` as the fillable evidence template.

| Status | Item | Evidence to record |
| --- | --- | --- |
| Pending | Key save/load | Save a Terax-managed provider key and a custom endpoint key, restart, verify model picker/key presence without diagnostics exposing the value. |
| Pending | Terax-managed Pi chat | Create a Pi session with a normal provider, send a short prompt, verify streaming transcript and final idle status. |
| Pending | Built-in/local agent cards | Refresh local agent detection; launch supported agents only into visible safe terminal commands. |
| Pending | Custom Zai/OpenAI-compatible endpoint auth | Configure a complete Zai-compatible endpoint, send a prompt, restart, verify the session keeps provider/model/custom endpoint metadata. |
| Pending | Session streaming | Verify progress/reasoning/output events and transcript persistence across a complete response. |
| Pending | Tool approval approve path | Trigger a harmless `write`/`edit`/`bash`, approve once, verify Rust-enforced execution and audit/tool timeline. |
| Pending | Tool approval deny path | Trigger the same class of tool, deny, verify no mutation/command side effect. |
| Pending | Stop/resume | Stop a running prompt, send a follow-up in the same session, verify transcript coherence. |
| Pending | App restart restore | Quit/reopen, verify sessions/events/transcripts/provider metadata restore and stale approvals are not actionable. |
| Pending | Window-close behavior | Close window/app during idle and during running or approval-pending session; verify no stuck running state or reusable stale approval after reopen. |
| Pending | Size spot-check | Re-run release bundle size after final merge/conflict resolution; expected macOS app remains about 11 MB. |

## Release blockers / deferred until maintainer action

1. Resolve broad merge conflicts with `origin/main`; the direct local merge attempt was aborted to avoid unsafe conflict resolution.
2. Trigger/confirm GitHub Actions CI, including Linux e2e. The mock-provider Pi approval spec cannot run on macOS because `tauri-driver` does not support WKWebView.
3. Complete the manual macOS smoke checklist above with real credentials/endpoints.
4. Before release, finish updater key rotation per `docs/updater-key-rotation.md`: maintainer must wire/verify the new signing secrets, decide whether the recommended transition release is possible with the old key, and verify fresh plus pre-rotation update paths against a signed feed.
