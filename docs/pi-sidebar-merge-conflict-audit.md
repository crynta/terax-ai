# Pi sidebar merge conflict audit

Generated on 2026-07-07 and refreshed after resolving `origin/main` into `pi-sidebar`.

## Current result

The PR branch is no longer textually merge-conflicted with `origin/main` in the local repository:

```bash
git fetch origin main
git rev-parse HEAD origin/main
# current local PR head
# 78a0b3dd79554ad4af89e61d97004f3475cd9953

git merge-tree --write-tree HEAD origin/main
# exits 0
```

`git merge-tree --write-tree HEAD origin/main` exits 0. That means the current local branch already contains the fetched `origin/main` head and Git can produce a clean merge tree.

GitHub reports the PR as structurally mergeable but still blocked by review/check policy:

```bash
gh pr view 964 --repo crynta/terax-ai --json headRefOid,mergeStateStatus,mergeable,statusCheckRollup
# headRefOid: current pushed PR head
# mergeStateStatus: BLOCKED
# mergeable: MERGEABLE
# statusCheckRollup: CodeRabbit only; no green Actions matrix yet
```

## Resolution commit

The broad conflict set was resolved in:

```text
b73b79aa1501d36c888d609affd4b9be644b8c58 chore(merge): resolve origin main into pi sidebar
```

The merge preserved the webview-native Pi boundary:

- no Node Pi sidecar or `sidecars/pi-host` reintroduction;
- frontend Pi tool execution still routes through Rust-enforced `pi_agent_tool_execute`;
- static frontend Tauri invokes have registered Rust handlers or documented feature-gated degradation;
- `resources/sidecars` remains absent from Tauri bundling for the deleted Node Pi sidecar path.

## CI/e2e state after conflict resolution

CI is not green yet. It is waiting for maintainer action rather than local conflict resolution. Attempts from this account to rerun or approve the PR workflow return HTTP 403 (`Must have admin rights to Repository`):

```bash
gh pr checks 964 --repo crynta/terax-ai --watch=false
# CodeRabbit pass only

gh run list --repo crynta/terax-ai --workflow CI --branch pi-sidebar --limit 5
# latest pull_request runs complete immediately with conclusion: action_required
# jobs/logs are absent until a maintainer approves or re-runs the workflow

gh run rerun <run-id> --repo crynta/terax-ai
# HTTP 403: Must have admin rights to Repository

POST /repos/crynta/terax-ai/actions/runs/<run-id>/approve
# HTTP 403: Must have admin rights to Repository
```

The Linux e2e job, including `e2e/specs/pi-approval.e2e.mjs`, has not run on GitHub Actions for this head. A maintainer must approve or re-run the PR workflow before the release-readiness checklist can mark CI/e2e green.

## Previously conflicted paths, now resolved

Before `b73b79aa`, the direct merge attempt reported 99 conflicted paths across workflows, package manifests, Rust backend modules, the app shell, editor, explorer, sidebar, status bar, tabs, terminal, theme, settings, styles, and Vite config. Those conflicts are now historical. The current local audit should use the commands above rather than the pre-resolution conflict list.

## Maintainer follow-up path

1. Approve/re-run GitHub Actions for PR #964.
2. Confirm the full CI matrix and Linux e2e job are green.
3. Complete the manual macOS Pi smoke report in `docs/pi-sidebar-manual-smoke-report.md`.
4. Finish updater key rotation verification with maintainer-held signing secrets and a signed feed.
