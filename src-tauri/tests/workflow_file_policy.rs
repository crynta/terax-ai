use terax_lib::modules::capabilities::{audit::CapabilityAuditOutcome, WorkflowCapabilityState};
use terax_lib::modules::fs::file::{
    workflow_file_read_inner, workflow_file_write_inner, ReadResult, WorkflowFileReadRequest,
    WorkflowFileWriteRequest,
};
use terax_lib::modules::fs::mutate::{workflow_file_delete_inner, WorkflowFileDeleteRequest};
use terax_lib::modules::workspace::WorkspaceEnv;

fn temp_path(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn workflow_file_read_requires_policy_approval_and_records_blocked_audit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.txt");
    std::fs::write(&path, "secret").unwrap();
    let state = WorkflowCapabilityState::default();

    let error = workflow_file_read_inner(
        &state,
        WorkflowFileReadRequest {
            path: temp_path(&path),
            workspace: WorkspaceEnv::Local,
            approved: false,
            document_id: "workflow-1".to_string(),
            node_id: "node-file".to_string(),
        },
    )
    .unwrap_err();

    assert!(
        error.contains("capability tool requires approval: workflow.file_read"),
        "got: {error}"
    );
    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].session_id, "workflow-1");
    assert_eq!(entries[0].tool_call_id, "node-file");
    assert_eq!(entries[0].tool_name, "workflow.file_read");
    assert!(!entries[0].approved);
    assert!(!entries[0].allowed);
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Blocked);
}

#[test]
fn workflow_file_read_write_and_delete_record_successful_policy_audits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.txt");
    std::fs::write(&path, "old").unwrap();
    let state = WorkflowCapabilityState::default();

    let read = workflow_file_read_inner(
        &state,
        WorkflowFileReadRequest {
            path: temp_path(&path),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-2".to_string(),
            node_id: "node-file".to_string(),
        },
    )
    .unwrap();
    assert!(matches!(read, ReadResult::Text { ref content, .. } if content == "old"));

    workflow_file_write_inner(
        &state,
        WorkflowFileWriteRequest {
            path: temp_path(&path),
            content: "new".to_string(),
            workspace: WorkspaceEnv::Local,
            source: Some("workflow-file-operation".to_string()),
            approved: true,
            document_id: "workflow-2".to_string(),
            node_id: "node-file".to_string(),
        },
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");

    workflow_file_delete_inner(
        &state,
        WorkflowFileDeleteRequest {
            path: temp_path(&path),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-2".to_string(),
            node_id: "node-file".to_string(),
        },
    )
    .unwrap();
    assert!(!path.exists());

    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].tool_name, "workflow.file_read");
    assert_eq!(entries[1].tool_name, "workflow.file_write");
    assert_eq!(entries[2].tool_name, "workflow.file_delete");
    assert!(entries.iter().all(|entry| entry.approved));
    assert!(entries.iter().all(|entry| entry.allowed));
    assert!(entries
        .iter()
        .all(|entry| entry.outcome == CapabilityAuditOutcome::Succeeded));
}

#[test]
fn workflow_file_operations_refuse_sensitive_paths_even_after_approval() {
    let dir = tempfile::tempdir().unwrap();
    let env_path = dir.path().join(".env");
    let token_path = dir.path().join("tokens.json");
    let secrets_dir = dir.path().join("secrets");
    std::fs::write(&env_path, "TOKEN=secret").unwrap();
    std::fs::create_dir(&secrets_dir).unwrap();
    std::fs::write(secrets_dir.join("note.txt"), "hidden").unwrap();
    let state = WorkflowCapabilityState::default();

    let read_error = workflow_file_read_inner(
        &state,
        WorkflowFileReadRequest {
            path: temp_path(&env_path),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-sensitive".to_string(),
            node_id: "read-env".to_string(),
        },
    )
    .unwrap_err();
    assert!(read_error.contains("sensitive path"), "{read_error}");

    let write_error = workflow_file_write_inner(
        &state,
        WorkflowFileWriteRequest {
            path: temp_path(&token_path),
            content: "secret".to_string(),
            workspace: WorkspaceEnv::Local,
            source: None,
            approved: true,
            document_id: "workflow-sensitive".to_string(),
            node_id: "write-token".to_string(),
        },
    )
    .unwrap_err();
    assert!(write_error.contains("sensitive path"), "{write_error}");
    assert!(!token_path.exists());

    let delete_error = workflow_file_delete_inner(
        &state,
        WorkflowFileDeleteRequest {
            path: temp_path(&secrets_dir),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-sensitive".to_string(),
            node_id: "delete-secrets".to_string(),
        },
    )
    .unwrap_err();
    assert!(delete_error.contains("sensitive path"), "{delete_error}");
    assert!(secrets_dir.exists());

    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 3);
    assert!(entries.iter().all(|entry| entry.allowed));
    assert!(entries
        .iter()
        .all(|entry| entry.outcome == CapabilityAuditOutcome::Failed));
}

#[test]
fn workflow_file_failures_are_audited_after_policy_allows_execution() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing.txt");
    let state = WorkflowCapabilityState::default();

    let error = workflow_file_delete_inner(
        &state,
        WorkflowFileDeleteRequest {
            path: temp_path(&missing),
            workspace: WorkspaceEnv::Local,
            approved: true,
            document_id: "workflow-3".to_string(),
            node_id: "node-file".to_string(),
        },
    )
    .unwrap_err();

    assert!(!error.is_empty());
    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tool_name, "workflow.file_delete");
    assert!(entries[0].allowed);
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Failed);
    assert!(entries[0]
        .message
        .as_deref()
        .is_some_and(|message| !message.is_empty()));
}
