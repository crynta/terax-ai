# Pi sidebar release-readiness notes

Tracking note for PR #964 (`pi-sidebar`) and the webview-native Pi size-fix tail. This file records the current repository state as of 2026-07-07 after resolving `origin/main` into the branch; older sidecar-era or pre-merge-conflict notes are historical only.

## Current PR state

- PR: <https://github.com/crynta/terax-ai/pull/964>
- Head branch: `mehmetcanbudak:pi-sidebar`
- Merge-resolution commit included: `b73b79aa1501d36c888d609affd4b9be644b8c58` (`chore(merge): resolve origin main into pi sidebar`)
- Base included by the merge: `origin/main` at `78a0b3dd79554ad4af89e61d97004f3475cd9953`
- Current pushed head: verify with `gh pr view 964 --repo crynta/terax-ai --json headRefOid`
- Merge status from `gh pr view`: `mergeStateStatus=BLOCKED`, `mergeable=MERGEABLE`
- Local merge audit: `git merge-tree --write-tree HEAD origin/main` exits 0.
- Visible PR checks: CodeRabbit may be pending or passing after each push; no green GitHub Actions matrix is attached to the PR check rollup yet.
- GitHub Actions evidence: base repo `CI` runs on `pi-sidebar` / `pull_request` complete immediately with `conclusion=action_required` and no jobs/logs until a maintainer approves/re-runs the workflow. Attempts from this account to approve or rerun those runs return HTTP 403 (`Must have admin rights to Repository`). Maintainer must approve/re-run PR CI before CI/e2e can be considered green.

## Completion audit checklist

| Status | Objective requirement | Evidence inspected | Remaining gap |
| --- | --- | --- | --- |
| Done | Commit and push `pi-sidebar`; open PR. | PR #964 exists at <https://github.com/crynta/terax-ai/pull/964>; current branch head is pushed to `mehmetcanbudak:pi-sidebar`. | None for PR creation/push. |
| Done | Resolve merge conflicts against current `origin/main`. | `git fetch origin main`; `git merge-tree --write-tree HEAD origin/main` exited 0 after the merge-resolution commit. `gh pr view` reports `mergeable=MERGEABLE`. | None locally; GitHub still reports `mergeStateStatus=BLOCKED` because required checks/reviews are not satisfied. |
| Blocked | Confirm CI/e2e green. | `gh pr checks 964 --repo crynta/terax-ai` reports no green GitHub Actions matrix. `gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar` shows PR runs with `conclusion=action_required` and no jobs/logs. `gh run rerun ...` and `POST /actions/runs/.../approve` return HTTP 403 from this account. `CI must independently run on the PR`; Linux e2e, including the Pi approval spec, has not executed in GitHub Actions. | Maintainer must approve/re-run PR CI so the workflow matrix and Linux e2e job run to completion. |
| Blocked | Document and complete manual macOS Pi smoke pass: key save/load, chat, built-in agents, custom Zai endpoint auth, streaming, stop/resume, app restart restore, and window-close behavior. | `docs/pi-sidebar-manual-smoke-report.md` is a maintainer-fillable template covering each named flow, expected evidence, and secret-redaction guidance. | Maintainer must run it in a packaged app with real credentials/endpoints. |
| Done, not locally executable | Add security-critical mock-provider e2e coverage for Pi tool approval approve and deny through Rust `pi_agent_tool_execute`. | `e2e/specs/pi-approval.e2e.mjs` covers approve creates the fixture and deny leaves it absent; `wdio.conf.mjs` includes `./e2e/specs/**/*.e2e.mjs`; `.github/workflows/ci.yml` runs `xvfb-run -a pnpm e2e`; `src/modules/pi/bridge/pi-mock.ts` emits deterministic tool calls; `pnpm run check:pi-boundary` statically guards the spec, sentinel prompts, WebdriverIO glob, and Linux e2e CI command. | Full e2e execution requires Linux/Windows `tauri-driver`; macOS WKWebView has no driver, and GitHub CI is still `action_required`. |
| Partial | Complete Phase C/D convergence. | `src/modules/ai/lib/composerRuntime.ts` and tests cover the Pi-backed quick ask; `src/app/App.tsx` and `src/app/AppWorkspaceSurface.tsx` route the Pi composer path to Pi surfaces; `docs/phase-c-convergence-plan.md` records the residual import audit; `pnpm run check:pi-surface-isolation` guards that `AiChat`, `AiChatMessage`, `PlanDiffReview`, and `TodoStrip` stay isolated to the legacy mini-window fallback or tests. | Legacy fallback chat surfaces remain until Pi composer can become default after CI/e2e and manual smoke are green. Runtime collapse/rename remains deferred. |
| Done | Handle touched cleanup and hardening items. | Evidence spans provider/model persistence tests in `src/modules/pi/lib/webview-session.test.ts`, MCP connection/error surfaces in `src/modules/pi/lib/useMcpSurface.ts` and `src-tauri/tests/mcp_manager_runtime.rs`, URLSearchParams proxy body handling in `src/modules/ai/lib/proxyFetch.ts`, retry UX in `src/modules/pi/components/PiComposer.test.tsx`, MCP `raw_data` capping in `src-tauri/src/modules/pi/native_tools/mcp_tools.rs`, historical sidecar-era docs marked superseded, `pnpm run check:no-pi-sidecar`, and Voice/3D gating in `src/modules/ai/lib/featureGates.ts` plus Rust capability manifests. | No known local code gap; release validation still depends on CI/manual blockers. |
| Blocked | Complete updater key rotation and verify fresh plus pre-rotation update paths. | `docs/updater-key-rotation.md` documents the embedded key `52D6B9847A3B8F15`, current workflow secret names `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, transition-release guidance, release-note variants, and old live feed key id `3BABFD8AB60E3469`. `pnpm check:updater-key-rotation` guards the local pubkey, endpoint, workflow-secret wiring, required key ids, release-note variants, feed-inspector command, and signed-feed verification notes. `pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469` still confirms the current public feed is old-key signed; the same command with `--expect-key 52D6B9847A3B8F15` still fails until a new-key signed release or test feed exists. | Maintainer must verify/configure signing secret values, produce a new-key signed release or test feed, decide transition release feasibility, put the selected migration note into the actual release notes, and verify signed update feeds. |
| Done | Keep default app about 11 MB. | Latest post-merge size spot-check: `pnpm tauri build --bundles app --no-sign --ci` succeeded; `du -sh src-tauri/target/release/bundle/macos/Terax.app src-tauri/target/release/bundle/macos/Terax.app.tar.gz` reported `10M` and `7.0M`. `pnpm check:bundle-size` reported `1430.5 KB` gzipped JS against the `2050.8 KB` budget. | Re-run on the final signed release artifact. |
| Done | Keep Node Pi sidecar deleted. | `pnpm run check:no-pi-sidecar` passed as part of `pnpm check:pi-boundary`, scanning tracked paths, sidecar config, and sidecar-era docs for deleted `sidecars/pi-host`, bundled Node runtime paths, Pi-host build scripts, Tauri resource entries, and required historical/superseded/not-current banners. Only the existing native `speech-recognizer` sidecar remains allowed. Node Pi sidecar deleted. | Historical architecture docs still mention the old sidecar as past context, with banners guarded by automation. |
| Done | Ensure static frontend Tauri invokes have Rust handlers or intentional graceful degradation. | `pnpm run check:tauri-invokes` passed with 191 unique commands across 273 literal invokes and 32 documented feature-gated commands; `pnpm run check:pi-boundary` chains this static invoke audit after the Pi approval boundary check. | Re-run after any new frontend invoke or Rust command changes. |
| Done locally | Pass pnpm and Rust verification gates. | Latest post-merge local checks include `pnpm install --frozen-lockfile --offline`, `pnpm audit --prod --audit-level high` (only low/moderate advisories), `pnpm format:check`, `pnpm lint` (185 warnings only), `pnpm exec tsc --noEmit`, `pnpm build:sidecars`, `pnpm test` (198 files, 1170 tests), `pnpm test:coverage` (198 files, 1170 tests), `pnpm check:pi-boundary`, `pnpm build`, `pnpm check:bundle-size`, and `pnpm tauri build --bundles app --no-sign --ci`. Latest Rust validation passed `cargo fmt -- --check`, `cargo check --locked`, `cargo check --all-targets --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked` (374 lib tests plus integration/doc tests), `cargo check --locked --features workflow`, `cargo check --locked --features openclicky`, and all-targets check/clippy for both `workflow` and `openclicky`. `cargo nextest` is not installed in this local environment; `cargo test --locked` is the documented local fallback. | CI must independently run on the PR. |

## Latest local automated verification

Post-merge checks for the current code path, including the current-head Rust clippy hardening:

```bash
pnpm install --frozen-lockfile --offline # refreshed node_modules to the post-merge lockfile; no downloads
pnpm audit --prod --audit-level high # exits 0; only low/moderate advisories reported
pnpm format:check # 753 files, no fixes applied
pnpm lint # exits 0 with 185 existing warnings
pnpm exec tsc --noEmit # exits 0
pnpm build:sidecars # speech-recognizer Swift package builds and copies to resources
pnpm test # 198 files, 1170 tests
pnpm test:coverage # 198 files, 1170 tests; coverage report generated
pnpm check:pi-boundary # approval, no-sidecar, surface isolation, invoke, release-doc, and CI-gate audits pass
pnpm build # exits 0 with existing Rolldown/Hugeicons INVALID_ANNOTATION warnings
pnpm check:bundle-size # 1430.5 KB gzipped JS, budget 2050.8 KB
pnpm tauri build --bundles app --no-sign --ci # exits 0
# du -sh src-tauri/target/release/bundle/macos/Terax.app src-tauri/target/release/bundle/macos/Terax.app.tar.gz
# 10M Terax.app, 7.0M Terax.app.tar.gz
```

Merge/PR/CI probes:

```bash
git fetch origin main
git rev-parse HEAD origin/main # current local PR head / fetched origin/main
git merge-tree --write-tree HEAD origin/main # exits 0
gh pr view 964 --repo crynta/terax-ai --json headRefOid,mergeStateStatus,mergeable,statusCheckRollup
gh pr checks 964 --repo crynta/terax-ai --watch=false # no green Actions matrix yet
gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 5 # pull_request runs are action_required until maintainer approval
```

Latest Rust and updater checks:

```bash
pnpm check:ci-release-gates
pnpm check:updater-key-rotation
pnpm run inspect:updater-feed -- --expect-key 3BABFD8AB60E3469
# pnpm run inspect:updater-feed -- --expect-key 52D6B9847A3B8F15 still fails until a new-key signed feed exists
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo check --locked
cd src-tauri && cargo check --all-targets --locked
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
cd src-tauri && cargo test --locked # 374 lib tests plus integration/doc tests
cd src-tauri && cargo check --locked --features workflow
cd src-tauri && cargo check --locked --features openclicky
cd src-tauri && cargo check --locked --all-targets --features workflow
cd src-tauri && cargo clippy --locked --all-targets --features workflow -- -D warnings
cd src-tauri && cargo check --locked --all-targets --features openclicky
cd src-tauri && cargo clippy --locked --all-targets --features openclicky -- -D warnings
```

## Voice and 3D gating decision

Current decision for release: keep OpenClicky-derived AI tools and read-aloud TTS off by default. They are not part of the default size-fix path and their Rust commands are only registered with the `openclicky` feature. The frontend treats them as explicit experimental gates instead of ambient tools:

- `localStorage["terax.experimental.openclickyAiTools"] = "true"` exposes overlay, screenshot, and Tripo 3D AI tools plus the `/3d` command.
- `localStorage["terax.experimental.ttsReadAloud"] = "true"` exposes read-aloud buttons on legacy AI and Pi transcripts.
- Default builds do not advertise those tools to the model and do not show read-aloud actions that would invoke unregistered commands.
- When `openclicky` is enabled, `tts_speak`, `transcribe_audio`, and `generate_3d_model` record app capability-audit entries (`app.tts`, `app.transcription`, `app.3d_model`).

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
| Pending | Size spot-check | Re-run release bundle size on the signed final artifact; expected macOS app remains about 10-11 MB. |

## Release blockers / deferred until maintainer action

1. Approve/re-run GitHub Actions for PR #964 and confirm the CI matrix plus Linux e2e are green. This account cannot do it: rerun and approval attempts return HTTP 403 (`Must have admin rights to Repository`).
2. Complete the manual macOS smoke checklist above with real credentials/endpoints.
3. Before release, finish updater key rotation per `docs/updater-key-rotation.md`: maintainer must wire/verify the new signing secrets, decide whether the recommended transition release is possible with the old key, and verify fresh plus pre-rotation update paths against a signed feed.
4. Promote Pi composer to default and collapse/rename residual runtime layers only after CI/e2e and manual smoke are green.
