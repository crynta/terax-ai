# Terax agent runtime roadmap

Date: 2026-06-05

## Purpose

This is the short execution plan derived from the full audit in [`t3code-terax-comparison-report.md`](./t3code-terax-comparison-report.md). Use the full report for research detail. Use this file to decide what to build next.

Reviewed revisions:

- T3 Code: `348a9140e9d352fdcb1779d467b4b68000b61bdf`
- Terax: `5e91b45d5a193881e55538ae1f9b86f414abb978` plus the local uncommitted `pi-sidebar` working tree present during review

Clean-room rule: borrow concepts, contracts, and UX patterns only. Do not copy T3 Code implementation code into Terax without license review.

## Recommendation

Keep Terax as the base. Do not fork T3 Code as the runtime foundation.

Terax should preserve these constraints:

1. Rust owns OS operations.
2. Sidecars are constrained workers.
3. Secrets stay in keychain or Rust-owned memory.
4. Agent file, shell, and mutation tools route through Rust.
5. Workspace authorization is checked before runtime creation and tool execution.
6. Local terminal quality and Tauri footprint stay product priorities.

## Build order

Implement the next slice in this order:

1. Runtime health model.
2. Pi receipts.
3. Pure Pi projection helper with tests.
4. Session UX: search, archive, pin, sort, unread.
5. Composer context chips and pending approval panel.
6. Branch and repository context.
7. Lightweight turn checkpoints.
8. GitHub PR workflow.
9. Observability and support bundle.
10. Remote environment design.

Do not start with a generalized `AgentRuntimeDriver`. Extract it later, after the health model, receipts, and projections reveal repeated shapes.

## P0: Ship the current Pi sidebar

Goal: make the current branch reliable enough to review and ship.

Tasks:

- Keep sidecar stdout strictly JSON-RPC.
- Stabilize `sidecars/pi-host` protocol and session tests.
- Ensure `pnpm test` passes in normal parallel mode.
- Ensure `pnpm build:sidecars` passes.
- Ensure `pnpm smoke:pi-host` passes.
- Verify `sessions.create`, `sessions.send`, `sessions.stop`, `sessions.resume`, `sessions.rename`, and `sessions.delete`.
- Verify approve, deny, stale approval, and stop-while-pending behavior.
- Verify diagnostics never expose secrets.
- Verify partial custom endpoints do not enable unusable model choices.

Success metrics:

- Pi session restore survives app restart with a persisted SDK session file.
- Approval receipt tests are deterministic.
- Runtime diagnostics distinguish missing sidecar, missing package, missing auth, invalid model, stopped host, running session, and protocol error.
- Local CLI agent launches remain visible and safe by default.

## P1: Runtime health model

Goal: make runtime state visible and actionable.

Suggested shape:

```ts
type RuntimeHealth = {
  id: string;
  label: string;
  kind: "pi-sidecar" | "local-cli" | "ai-sdk";
  installed: boolean | null;
  authenticated: boolean | null;
  modelReady: boolean | null;
  ready: boolean;
  error: string | null;
  actions: Array<"install" | "authenticate" | "choose-model" | "restart" | "open-docs">;
};
```

Initial surfaces:

- Pi diagnostics card.
- Pi runtime card.
- Models settings.
- Agents settings.
- Header notification bell.

Success metrics:

- Missing key, missing model, missing binary, failed sidecar, and stopped sidecar produce different user-facing actions.
- No diagnostic payload contains API keys, auth JSON, request headers, or provider secret values.
- Health rows are testable as pure mapping functions.

## P1: Pi receipts

Goal: replace timing assumptions with explicit runtime milestones.

Receipts to add first:

- `prompt.accepted`
- `output.first`
- `approval.opened`
- `approval.resolved`
- `tool.completed`
- `turn.quiesced`
- `session.persisted`
- `sidecar.idle-safe`

Success metrics:

- Tests can wait for receipts instead of sleeping or polling.
- Stop and resume behavior is deterministic under concurrent `session.event` notifications.
- The UI can show precise status transitions without guessing from transcript text.

## P1: Pure Pi projection helper

Goal: derive Pi UI state from stored events in one testable place.

Tasks:

- Add a pure projection function for session rows.
- Add a pure projection function for transcript blocks.
- Add a pure projection function for pending approvals.
- Add branch and regenerate metadata to the projection.
- Keep React components thin.

Success metrics:

- A saved event log can recreate the same session list and transcript after restart.
- Restored stale approvals render as expired or denied, never actionable.
- Projection tests cover interleaved output, reasoning, tool events, approval events, errors, stop, and resume.

## P1: Session UX

Goal: make Pi sessions feel like a workspace, not a raw transcript list.

Tasks:

- Search sessions.
- Sort by updated time and created time.
- Archive and unarchive.
- Pin and unpin.
- Group by workspace or repository.
- Show unread badges.
- Show compact status pills.
- Add context menu actions.
- Add keyboard navigation for recent sessions.

Success metrics:

- Users can find and restore old Pi sessions without scanning a flat list.
- Archive does not delete event history.
- Unread counts clear when the session is focused.

## P1: Composer context and approval panel

Goal: make prompt context explicit and keep approvals close to the user's input flow.

Tasks:

- Add active cwd chip.
- Add active file chip.
- Add private terminal chip.
- Add branch and repository chip.
- Add model context meter.
- Add sticky pending approval panel near the composer.
- Share snippets and slash commands where safe.

Success metrics:

- The user can see exactly which cwd, file, branch, and privacy state will be sent.
- Pending approvals remain visible without scrolling the transcript.
- Context chips never expose secret file contents.

## P2: Lightweight turn checkpoints

Goal: let users inspect and undo agent file changes per turn.

Design edge cases before implementation:

- Dirty worktrees before the turn starts.
- Untracked files.
- Ignored files.
- Binary and large files.
- Non-git workspaces.
- Partial accepts from AI diff tabs.
- Revert conflicts after manual edits.
- WSL path normalization.
- Crash cleanup of checkpoint refs.

Success metrics:

- Turn diff works with pre-existing dirty files.
- Revert fails safely with a clear conflict message when files changed after the turn.
- Non-git workspaces degrade gracefully.
- Checkpoint refs are cleaned up after normal completion and after restart recovery.

## P2: GitHub PR workflow

Goal: close the highest-value source-control gap first.

Tasks:

- Detect `gh` availability.
- Detect `gh` auth state.
- Detect current branch's PR.
- Create PR from current branch.
- Open PR in browser.
- Checkout PR by URL or number.
- Generate PR title and body with Terax AI.

Success metrics:

- Authenticated and unauthenticated `gh` states produce clear UI.
- Existing PR detection works before creating duplicates.
- Generated PR copy is editable before submission.

## P2: Observability and support bundle

Goal: make runtime failures easy to debug.

Tasks:

- Add local NDJSON trace records.
- Trace Pi sidecar lifecycle.
- Trace native tool execution.
- Trace approval state transitions.
- Capture bounded sidecar stderr tail.
- Add redacted support bundle export.

Success metrics:

- A support bundle can explain why a prompt failed without revealing secrets.
- Sidecar crashes include command, pid, exit status, and stderr tail.
- Tool execution traces include workspace id, tool name, approval id, duration, and redacted error detail.

## P3: Remote environment design

Do not implement remote execution until the local event and session core is stable.

Design questions:

- Is Terax desktop always the client, or can Terax expose a remote Rust environment server?
- How are pairing tokens created, scoped, and revoked?
- How are terminal streams multiplexed?
- How do approvals move across devices?
- How does WSL map into remote environments?
- How does remote execution preserve the same Rust-mediated OS boundary?

Success metrics:

- The design has explicit token lifetime and revocation rules.
- Remote terminal streams do not bypass workspace authorization.
- Remote approvals preserve the same policy as local approvals.
