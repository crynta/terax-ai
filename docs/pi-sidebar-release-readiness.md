# Pi sidebar release-readiness notes

Tracking note for PR #964 (`pi-sidebar`) and the webview-native Pi size-fix tail. This file records what has been verified by automation/local commands and what still needs an interactive macOS/live-provider pass before release.

## Current PR state

- PR: <https://github.com/crynta/terax-ai/pull/964>
- Head branch: `mehmetcanbudak:pi-sidebar`
- Latest pushed head when this note was added: `35cb16a1`
- GitHub merge state: `DIRTY` / merge-conflicted against `origin/main`
- Visible checks: CodeRabbit only. GitHub Actions CI/e2e were not visible for the fork PR, so Linux e2e remains pending CI or maintainer-triggered workflow.

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
4. Before release, perform updater key rotation and verify both fresh and pre-rotation update paths per `docs/updater-key-rotation.md`.
