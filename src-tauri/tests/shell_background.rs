#![cfg(unix)]

use std::time::{Duration, Instant};

use terax_lib::modules::capabilities::{audit::CapabilityAuditOutcome, WorkflowCapabilityState};
use terax_lib::modules::shell::{
    background, workflow_shell_bg_spawn_inner, ShellState, WorkflowShellSpawnRequest,
};
use terax_lib::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

fn wait_until<F: Fn() -> bool>(timeout: Duration, check: F) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    check()
}

#[test]
fn workflow_shell_spawn_requires_policy_approval_and_records_blocked_audit() {
    let dir = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir.path()).unwrap();
    let state = ShellState::default();
    let audit_state = WorkflowCapabilityState::default();

    let error = workflow_shell_bg_spawn_inner(
        &state,
        &registry,
        &audit_state,
        WorkflowShellSpawnRequest {
            command: "printf blocked".to_string(),
            cwd: Some(dir.path().to_string_lossy().into_owned()),
            workspace: WorkspaceEnv::Local,
            approved: false,
            document_id: "workflow-1".to_string(),
            node_id: "node-shell".to_string(),
        },
    )
    .unwrap_err();

    assert!(error.contains("requires approval"), "{error}");
    let audit = audit_state.capability_audit_entries();
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].session_id, "workflow-1");
    assert_eq!(audit[0].tool_call_id, "node-shell");
    assert_eq!(audit[0].tool_name, "workflow.shell_command");
    assert_eq!(audit[0].outcome, CapabilityAuditOutcome::Blocked);
}

#[test]
fn workflow_shell_spawn_records_successful_policy_audit() {
    let dir = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(dir.path()).unwrap();
    let state = ShellState::default();
    let audit_state = WorkflowCapabilityState::default();

    let handle = workflow_shell_bg_spawn_inner(
        &state,
        &registry,
        &audit_state,
        WorkflowShellSpawnRequest {
            command: "printf approved".to_string(),
            cwd: Some(dir.path().to_string_lossy().into_owned()),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-2".to_string(),
            node_id: "node-shell".to_string(),
        },
    )
    .unwrap();

    assert!(wait_until(Duration::from_secs(5), || {
        state.background_logs(handle, 0).unwrap().exited
    }));
    let logs = state.background_logs(handle, 0).unwrap();
    assert!(logs.bytes.contains("approved"));
    let audit = audit_state.capability_audit_entries();
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].session_id, "workflow-2");
    assert_eq!(audit[0].tool_call_id, "node-shell");
    assert_eq!(audit[0].tool_name, "workflow.shell_command");
    assert_eq!(audit[0].outcome, CapabilityAuditOutcome::Succeeded);
}

#[test]
fn spawn_empty_command_errors() {
    assert!(background::spawn("   ".into(), None, WorkspaceEnv::Local).is_err());
}

#[test]
fn spawn_invalid_cwd_errors() {
    let err = background::spawn(
        "true".into(),
        Some("/no/such/dir".into()),
        WorkspaceEnv::Local,
    );
    assert!(err.is_err());
}

#[test]
fn spawn_captures_stdout_and_exits_zero() {
    let proc =
        background::spawn("printf 'hello\\n'".into(), None, WorkspaceEnv::Local).expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).expect("read logs").exited
    }));

    let logs = proc.read_logs(0).expect("read logs");
    assert!(logs.bytes.contains("hello"));
    assert!(logs.exited);
    assert_eq!(logs.exit_code, Some(0));
}

#[test]
fn spawn_captures_nonzero_exit() {
    let proc = background::spawn("exit 42".into(), None, WorkspaceEnv::Local).expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).expect("read logs").exited
    }));
    assert_eq!(proc.read_logs(0).expect("read logs").exit_code, Some(42));
}

#[test]
fn kill_terminates_a_running_process() {
    let proc = background::spawn("sleep 30".into(), None, WorkspaceEnv::Local).expect("spawn");

    proc.kill();

    assert!(
        wait_until(Duration::from_secs(5), || {
            proc.read_logs(0).expect("read logs").exited
        }),
        "killed process must reach exited state",
    );
}

#[test]
fn read_logs_advances_offset() {
    let proc = background::spawn(
        "printf 'one\\n'; printf 'two\\n'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).expect("read logs").exited
    }));

    let first = proc.read_logs(0).expect("read logs");
    assert!(first.next_offset > 0);

    let next = proc.read_logs(first.next_offset).expect("read logs");
    assert!(
        next.bytes.is_empty(),
        "consumed offset must return no bytes"
    );
    assert_eq!(next.next_offset, first.next_offset);
}

#[test]
fn info_reflects_command_and_exit() {
    let proc = background::spawn("true".into(), None, WorkspaceEnv::Local).expect("spawn");
    let info_running = proc.info(7);
    assert_eq!(info_running.handle, 7);
    assert_eq!(info_running.command, "true");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).expect("read logs").exited
    }));
    let info_done = proc.info(7);
    assert!(info_done.exited);
    assert_eq!(info_done.exit_code, Some(0));
}
