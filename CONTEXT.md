# Terax Apollo Bridge

Language for the boundary between Terax, Apollo, and remote workspace requests.

## Language

**Terax**:
The local desktop workspace authority for coding work. Terax owns files, shell, git, editor state, credentials, execution, and local approvals.
_Avoid_: IDE shell, desktop client

**Apollo**:
The always-on personal assistant surface that can propose coding or workspace work. Apollo owns personal assistant state, memory, wiki, messaging, and mobile conversation.
_Avoid_: Terax backend, workspace executor

**Bridge Context**:
Non-secret workspace information shared from Terax to Apollo for the current interaction only. It is temporary unless the user explicitly approves saving it into Apollo memory or wiki.
_Avoid_: Synced workspace state, shared memory

**Approval Request**:
A user decision created by Terax before a proposed action can affect a workspace or sensitive local state. Apollo can display an approval request, but Terax remains the authority that validates and executes the decision.
_Avoid_: Remote command, mobile execution

**Small Workspace Edit**:
A bounded, previewable patch to explicitly listed non-sensitive workspace files that may be approved from iOS. It excludes deletes, secret or credential paths, dependency or lockfile changes, broad generated rewrites, and shell execution.
_Avoid_: Remote write, broad edit

**Trusted Workspace Mapping**:
An explicit relationship between an Apollo project, a specific local Terax workspace, and its Workspace Environment. Repo name, repo URL, and branch help describe the relationship but do not make it trusted by themselves.
_Avoid_: Auto-discovered workspace, implicit trust

**Workspace Environment**:
The local execution context a Terax workspace belongs to, such as the host machine or a WSL distribution. A workspace in one environment is not interchangeable with the same path or repo in another environment.
_Avoid_: Machine, runtime

**Mission Request**:
A queued Apollo-side intent for coding or workspace work that may exist while Terax is closed. It can name the requested outcome and target project, but it is not an execution record and does not own approvals, transcripts, Bridge Context, or workspace changes.
_Avoid_: Remote execution, Apollo session

**Terax Mission Session**:
A local Terax execution record created only after Terax claims a Mission Request. It owns local execution state, approvals, transcripts, and workspace changes.
_Avoid_: Apollo mission, queued request

**Proposed Action Summary**:
A non-authoritative Apollo description of the action it thinks Terax should take. Terax may use it as input when creating a Terax Mission Session, but it is not an approval and does not grant execution authority.
_Avoid_: Plan of record, remote instruction
