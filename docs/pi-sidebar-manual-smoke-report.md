# Pi sidebar manual macOS smoke report

Use this report before release for PR #964 after merge conflicts are resolved and a packaged macOS app is available. This is intentionally manual because it needs real provider credentials, a custom OpenAI-compatible Zai endpoint, app restarts, and window lifecycle checks that the current macOS agent cannot execute through `tauri-driver`.

## Run metadata

| Field | Value |
| --- | --- |
| Tester |  |
| Date |  |
| PR / branch | `#964` / `pi-sidebar` |
| Commit tested |  |
| macOS version |  |
| CPU architecture |  |
| App artifact path |  |
| Terax version shown in app |  |
| Fresh profile or existing profile |  |
| Notes, logs, or screen recording link |  |

## Preconditions

- Use a packaged macOS build, not only `pnpm tauri dev`.
- Use a non-sensitive test workspace that can tolerate harmless file writes.
- Have one Terax-managed provider key available.
- Have one custom OpenAI-compatible Zai endpoint available with base URL, model id, and key.
- Do not paste real secret values into this report. Record only provider names, model ids, and masked key status.
- Keep `docs/pi-sidebar-release-readiness.md` open and update its manual smoke row after this report is complete.

## Smoke checklist

### 1. Key save and reload

| Check | Result |
| --- | --- |
| Save a Terax-managed provider key in settings. | Pending |
| Save a custom endpoint key for the Zai-compatible endpoint. | Pending |
| Quit and reopen Terax. | Pending |
| Model picker or diagnostics show keys are present without revealing values. | Pending |

Evidence:

- Provider tested:
- Custom endpoint id:
- Screenshot or note:

### 2. Terax-managed Pi chat

| Check | Result |
| --- | --- |
| Open the Pi code panel or Pi floating window. | Pending |
| Select a normal Terax-managed provider and model. | Pending |
| Send a short prompt. | Pending |
| Transcript streams tokens or progress and ends idle. | Pending |
| Session title/history row is created. | Pending |

Evidence:

- Provider/model:
- Session id or visible title:
- Screenshot or note:

### 3. Built-in and local agent cards

| Check | Result |
| --- | --- |
| Refresh local agent detection. | Pending |
| Built-in/local agent cards render without stale sidecar copy. | Pending |
| Launch only safe supported agent commands into a visible terminal. | Pending |
| Terminal launch stays interactive and does not auto-approve dangerous permissions. | Pending |

Evidence:

- Agent cards seen:
- Agent launched, if any:
- Screenshot or note:

### 4. Custom Zai/OpenAI-compatible endpoint auth

| Check | Result |
| --- | --- |
| Configure custom Zai-compatible base URL, key, and model id. | Pending |
| Send a prompt through that endpoint. | Pending |
| Response streams and completes. | Pending |
| Quit and reopen Terax. | Pending |
| Restored session keeps provider, model, custom endpoint id, and base URL metadata. | Pending |

Evidence:

- Endpoint label/id:
- Model id:
- Session id or visible title:
- Screenshot or note:

### 5. Session streaming and persistence

| Check | Result |
| --- | --- |
| Observe progress, reasoning, tool, or output events during a complete response. | Pending |
| Switch sessions and return. | Pending |
| Transcript remains coherent with no duplicated or missing final assistant turn. | Pending |
| Quit and reopen Terax. | Pending |
| Transcript and session metadata restore. | Pending |

Evidence:

- Session id or title:
- Screenshot or note:

### 6. Tool approval approve path

Use a harmless file write in the test workspace, such as creating `pi-smoke-approved.txt`.

| Check | Result |
| --- | --- |
| Trigger a Pi tool call that needs approval. | Pending |
| Approval card shows the native tool name and target clearly. | Pending |
| Approve once. | Pending |
| Rust-enforced execution succeeds. | Pending |
| Audit/tool timeline records the grant and result. | Pending |
| Expected file or command side effect exists. | Pending |

Evidence:

- Tool name:
- Target path or command:
- Result observed:
- Screenshot or note:

### 7. Tool approval deny path

Use the same class of harmless operation but a different target, such as `pi-smoke-denied.txt`.

| Check | Result |
| --- | --- |
| Trigger a Pi tool call that needs approval. | Pending |
| Deny the request. | Pending |
| No file, command, or MCP side effect occurs. | Pending |
| Transcript explains the denial or leaves the tool unexecuted. | Pending |
| Stale denied approval cannot be reused. | Pending |

Evidence:

- Tool name:
- Target path or command:
- Result observed:
- Screenshot or note:

### 8. Stop and resume

| Check | Result |
| --- | --- |
| Start a long enough prompt to observe running state. | Pending |
| Stop the prompt. | Pending |
| Running status clears without leaving the session stuck. | Pending |
| Send a follow-up in the same session. | Pending |
| Follow-up streams and completes with coherent context. | Pending |

Evidence:

- Prompt class:
- Follow-up result:
- Screenshot or note:

### 9. App restart restore

| Check | Result |
| --- | --- |
| Quit Terax while idle. | Pending |
| Reopen and verify sessions, transcripts, provider metadata, and model metadata restore. | Pending |
| Start or stage an approval, then quit and reopen. | Pending |
| Stale approvals are not actionable after restart. | Pending |
| No session remains permanently stuck in running state. | Pending |

Evidence:

- Sessions restored:
- Stale approval behavior:
- Screenshot or note:

### 10. Window close behavior

| Check | Result |
| --- | --- |
| Close the Pi floating window while idle. | Pending |
| Reopen and verify session state is preserved. | Pending |
| Close the window during running or approval-pending state. | Pending |
| Reopen and verify no stale approval can execute unexpectedly. | Pending |
| Main app close and reopen behaves the same way. | Pending |

Evidence:

- Window state tested:
- Result observed:
- Screenshot or note:

### 11. Size spot check after final merge

| Check | Result |
| --- | --- |
| Build final release app after conflict resolution. | Pending |
| `du -sh src-tauri/target/release/bundle/macos/Terax.app` remains about 11 MB. | Pending |
| No `sidecars/pi-host` or Node Pi runtime resource is present. | Pending |

Evidence:

```bash
pnpm tauri build --bundles app --no-sign --ci
du -sh src-tauri/target/release/bundle/macos/Terax.app
find src-tauri/target/release/bundle/macos/Terax.app -path '*sidecars/pi-host*' -print
```

## Final decision

| Item | Result |
| --- | --- |
| All manual smoke checks passed | Pending |
| Any failures are filed with links | Pending |
| Release-readiness doc updated | Pending |
| Maintainer sign-off |  |

Summary:

- Pass or fail:
- Blocking issues:
- Non-blocking follow-ups:
