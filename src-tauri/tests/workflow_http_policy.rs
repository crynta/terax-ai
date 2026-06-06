use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use terax_lib::modules::capabilities::{audit::CapabilityAuditOutcome, WorkflowCapabilityState};
use terax_lib::modules::net::{workflow_http_request_inner, WorkflowHttpRequest};

#[tokio::test]
async fn workflow_http_request_requires_policy_approval_and_records_blocked_audit() {
    let state = WorkflowCapabilityState::default();

    let error = workflow_http_request_inner(
        &state,
        WorkflowHttpRequest {
            method: "GET".to_string(),
            url: "https://example.com/".to_string(),
            headers: None,
            body: None,
            allow_private_network: None,
            timeout_ms: Some(1_000),
            max_body_bytes: Some(1024),
            approved: false,
            document_id: "workflow-http".to_string(),
            node_id: "node-http".to_string(),
        },
    )
    .await
    .unwrap_err();

    assert!(
        error.contains("capability tool requires approval: workflow.http_request"),
        "got: {error}"
    );
    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].session_id, "workflow-http");
    assert_eq!(entries[0].tool_call_id, "node-http");
    assert_eq!(entries[0].tool_name, "workflow.http_request");
    assert!(!entries[0].approved);
    assert!(!entries[0].allowed);
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Blocked);
}

#[tokio::test]
async fn workflow_http_request_records_successful_policy_audit() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer).unwrap();
        stream
            .write_all(
                b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
            )
            .unwrap();
    });

    let state = WorkflowCapabilityState::default();
    let response = workflow_http_request_inner(
        &state,
        WorkflowHttpRequest {
            method: "POST".to_string(),
            url: format!("http://{addr}/items"),
            headers: None,
            body: Some("{\"name\":\"Ada\"}".to_string()),
            allow_private_network: Some(true),
            timeout_ms: Some(5_000),
            max_body_bytes: Some(1024),
            approved: true,
            document_id: "workflow-http".to_string(),
            node_id: "node-http".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(response.status, 201);
    assert_eq!(response.status_text, "Created");
    assert_eq!(response.body_text, "{\"ok\":true}");
    assert_eq!(
        response.headers.get("content-type").map(String::as_str),
        Some("application/json")
    );

    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tool_name, "workflow.http_request");
    assert!(entries[0].approved);
    assert!(entries[0].allowed);
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Succeeded);
}

#[tokio::test]
async fn workflow_http_request_failures_are_audited_after_policy_allows_execution() {
    let state = WorkflowCapabilityState::default();

    let error = workflow_http_request_inner(
        &state,
        WorkflowHttpRequest {
            method: "GET".to_string(),
            url: "file:///etc/passwd".to_string(),
            headers: None,
            body: None,
            allow_private_network: None,
            timeout_ms: Some(1_000),
            max_body_bytes: Some(1024),
            approved: true,
            document_id: "workflow-http".to_string(),
            node_id: "node-http".to_string(),
        },
    )
    .await
    .unwrap_err();

    assert!(error.contains("scheme not allowed"), "got: {error}");
    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tool_name, "workflow.http_request");
    assert!(entries[0].allowed);
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Failed);
    assert!(entries[0]
        .message
        .as_deref()
        .is_some_and(|message| !message.is_empty()));
}
