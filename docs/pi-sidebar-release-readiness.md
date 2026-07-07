# Pi sidebar release-readiness notes

Tracking note for PR #964 (`pi-sidebar`) and the webview-native Pi size-fix tail. This file records what has been verified by automation/local commands and what still needs an interactive macOS/live-provider pass before release.

## Current PR state

- PR: <https://github.com/crynta/terax-ai/pull/964>
- Head branch: `mehmetcanbudak:pi-sidebar`
- Latest code/config head with local checks: `ed01a44e7` (subsequent readiness-note edits are docs-only)
- GitHub merge state: `DIRTY` / merge-conflicted against `origin/main`
- Visible checks: CodeRabbit only, currently pending on the fork PR. GitHub Actions CI/e2e were not visible for the fork PR, so Linux e2e remains pending CI or maintainer-triggered workflow.

## Local automated verification already run

Baseline full pass before the tail commits:

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
```

Conflict audit after pushing the Pi sidebar tail:

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD # 171 106
git merge-tree --write-tree HEAD origin/main # exits 1 with broad conflicts
```

## Voice and 3D gating decision

Current decision for release: keep OpenClicky-derived AI tools and read-aloud TTS off by default. They are not part of the default size-fix path and their Rust commands are only registered with the `openclicky` feature. The frontend now treats them as explicit experimental gates instead of ambient tools:

- `localStorage["terax.experimental.openclickyAiTools"] = "true"` exposes overlay, screenshot, and Tripo 3D AI tools plus the `/3d` command.
- `localStorage["terax.experimental.ttsReadAloud"] = "true"` exposes read-aloud buttons on legacy AI and Pi transcripts.
- Default builds do not advertise those tools to the model and do not show read-aloud actions that would invoke unregistered commands.
- When `openclicky` is enabled, `tts_speak`, `transcribe_audio`, and `generate_3d_model` now record app capability-audit entries (`app.tts`, `app.transcription`, `app.3d_model`).

This does not disable the existing composer voice input path, which is a user-initiated MediaRecorder plus provider transcription flow and remains controlled by its existing key checks.

## Manual macOS Pi smoke checklist

These require an interactive packaged app and/or real configured provider credentials. They were not completed by the non-interactive agent session and must be run by a maintainer before release.

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
