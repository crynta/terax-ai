mod common;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::env_guard::EnvVarGuard;
use terax_lib::modules::pi::{PiPhase, PiSession, PiSessionEvent, PiSessionsList, PiState};

static PI_TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn default_state_is_disconnected() {
    let state = PiState::default();
    let snapshot = state.snapshot().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}

#[test]
fn env_var_guard_restores_values_after_unwind() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    const KEY: &str = "TERAX_PI_HOST_TEST_ENV_GUARD";
    std::env::remove_var(KEY);

    let result = std::panic::catch_unwind(|| {
        let _guard = EnvVarGuard::set(KEY, "temporary");
        assert_eq!(std::env::var(KEY).as_deref(), Ok("temporary"));
        panic!("simulate a panic while a test env var is set");
    });

    assert!(result.is_err());
    assert!(std::env::var(KEY).is_err());
    std::env::remove_var(KEY);
}

#[tokio::test(flavor = "current_thread")]
async fn start_marks_host_ready() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = PiState::default();
    let snapshot = state.start().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Ready);
    assert_eq!(snapshot.detail.as_deref(), Some("Pi host ready"));
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn snapshot_serializes_to_frontend_state_shape() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = PiState::default();
    let snapshot = state.start().unwrap();
    let value = serde_json::to_value(snapshot).unwrap();

    assert_eq!(value["phase"], "ready");
    assert_eq!(value["detail"], "Pi host ready");
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn host_info_reports_stub_capabilities() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = PiState::default();
    let info = state.info().unwrap();

    assert_eq!(info.host_version, "0.1.0");
    assert!(info.pi_sdk_loaded);
    assert!(info.pi_packages.iter().any(|pkg| {
        pkg.name == "@earendil-works/pi-coding-agent"
            && pkg.version.as_deref() == Some("0.78.0")
            && pkg.loaded
            && pkg.error.is_none()
    }));
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn diagnostics_report_non_secret_runtime_state() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = PiState::default();
    let diagnostics = state
        .diagnostics_with_resource_dir_and_event_sink(None, None)
        .unwrap();

    assert_eq!(diagnostics.host_version, "0.1.0");
    assert!(diagnostics.pi_sdk_loaded);
    assert_eq!(diagnostics.config.tool_mode, "rust-mediated");
    assert_eq!(
        diagnostics.config.enabled_tools,
        [
            "read",
            "ls",
            "grep",
            "find",
            "bash",
            "edit",
            "write",
            "create_artifact",
            "edit_artifact",
            "read_artifact",
            "list_artifacts",
        ]
        .map(String::from)
        .to_vec()
    );
    assert_eq!(
        diagnostics.config.approval_required_tools,
        ["bash", "edit", "write"].map(String::from).to_vec()
    );
    assert!(diagnostics.capabilities.tools);
    assert!(diagnostics.capabilities.files);
    assert!(diagnostics.capabilities.shell);
    assert_eq!(diagnostics.limits.max_prompt_chars, 20_000);
    assert!(diagnostics
        .protocol
        .allowed_methods
        .iter()
        .any(|method| method == "sessions.create"));
    assert!(diagnostics
        .protocol
        .allowed_methods
        .iter()
        .any(|method| method == "sessions.tool.respond"));
    assert!(diagnostics.manager.idle_shutdown_ms >= 1);
    assert!(diagnostics.capability_audit.is_empty());
    assert!(diagnostics
        .manager
        .method_timeouts
        .iter()
        .any(|timeout| timeout.method == "sessions.create" && timeout.timeout_ms >= 45_000));
    assert!(diagnostics
        .config
        .api_keys
        .iter()
        .any(|key| key.name == "ANTHROPIC_API_KEY"));
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn sessions_can_be_created_sent_and_stopped() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let slow_response = "slow ".repeat(80);
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", &slow_response);
    let _faux_tokens = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());

    let created = state
        .session_create_with_resource_dir(None, Some("Test Pi".to_string()), Some(cwd.clone()))
        .unwrap();
    assert!(created.session.id.starts_with("pi_"));
    let session_id = created.session.id.clone();
    assert_eq!(created.session.title, "Test Pi");
    assert_eq!(created.session.cwd.as_deref(), Some(cwd.as_str()));
    assert_eq!(created.session.status, "idle");
    assert_eq!(created.events[0].event_type, "session.created");

    let sent = state
        .session_send_with_resource_dir(
            None,
            session_id.clone(),
            "hello".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
    assert!(sent.accepted);
    assert_eq!(sent.session.status, "running");
    assert_eq!(sent.session.last_prompt.as_deref(), Some("hello"));
    assert!(sent.events.iter().any(|event| {
        event.event_type == "session.status" && event.payload["status"] == "running"
    }));

    let stopped = state
        .session_stop_with_resource_dir(None, session_id.clone())
        .unwrap();
    assert_eq!(stopped.session.status, "idle");

    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(sessions.sessions.len(), 1);
    assert_eq!(sessions.sessions[0].status, "idle");

    let follow_up = state
        .session_send_with_resource_dir(None, session_id, "again".to_string(), None, None, None)
        .unwrap();
    assert!(follow_up.accepted);
    assert_eq!(follow_up.session.status, "running");
    state.stop().unwrap();
}

fn write_history(path: &Path, session: PiSession, events: Vec<PiSessionEvent>) {
    let history = PiSessionsList {
        sessions: vec![session],
        events,
    };
    fs::write(path, serde_json::to_string_pretty(&history).unwrap()).unwrap();
}

fn read_history(path: &Path) -> PiSessionsList {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn sessions_resume_from_sdk_session_file_after_host_restart() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "remembered");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let session_dir = temp.path().join("pi-sdk-sessions");
    let session_dir_text = terax_lib::modules::fs::to_canon(&session_dir);
    let events = Arc::new(Mutex::new(Vec::<PiSessionEvent>::new()));
    let sink: Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static> = {
        let events = Arc::clone(&events);
        Arc::new(move |event| {
            events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        })
    };

    let created = state
        .session_create_with_resource_dir_and_event_sink_and_session_dir(
            None,
            Some(sink.clone()),
            Some("Persistent".to_string()),
            Some(cwd.clone()),
            Some(session_dir_text.clone()),
        )
        .unwrap();
    let session_id = created.session.id.clone();
    let sdk_session_file = created.session.sdk_session_file.unwrap();
    assert!(sdk_session_file.starts_with(&session_dir_text));

    state
        .session_send_with_resource_dir_and_event_sink(
            None,
            Some(sink),
            session_id.clone(),
            "remember this".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
    wait_for_event(&events, |event| {
        event.event_type == "session.status"
            && event.session_id == session_id
            && event.payload["status"] == "idle"
    });
    assert!(Path::new(&sdk_session_file).is_file());

    state.stop().unwrap();

    let resumed = state
        .session_resume_with_resource_dir_and_session_dir(
            None,
            session_id.clone(),
            "Persistent".to_string(),
            cwd,
            sdk_session_file.clone(),
            Some(session_dir_text),
        )
        .unwrap();
    assert_eq!(resumed.session.id, session_id);
    assert_eq!(resumed.session.status, "idle");
    assert_eq!(
        resumed.session.sdk_session_file.as_deref(),
        Some(sdk_session_file.as_str())
    );

    let follow_up = state
        .session_send_with_resource_dir(None, session_id, "continue".to_string(), None, None, None)
        .unwrap();
    assert!(follow_up.accepted);
    assert_eq!(follow_up.session.status, "running");
    state.stop().unwrap();
}

fn wait_for_event(
    events: &Arc<Mutex<Vec<PiSessionEvent>>>,
    predicate: impl Fn(&PiSessionEvent) -> bool,
) -> PiSessionEvent {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        if let Some(event) = events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|event| predicate(event))
            .cloned()
        {
            return event;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("timed out waiting for Pi session event");
}

#[tokio::test(flavor = "current_thread")]
async fn tool_approval_responses_are_forwarded_to_the_sidecar() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_tool = EnvVarGuard::set(
        "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
        r#"{"id":"call-bash","name":"bash","arguments":{"command":"printf approved"}}"#,
    );
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let events = Arc::new(Mutex::new(Vec::<PiSessionEvent>::new()));
    let sink: Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static> = {
        let events = Arc::clone(&events);
        Arc::new(move |event| {
            events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        })
    };

    let created = state
        .session_create_with_resource_dir_and_event_sink(
            None,
            Some(sink.clone()),
            Some("Approval".to_string()),
            Some(cwd),
        )
        .unwrap();
    let session_id = created.session.id;

    state
        .session_send_with_resource_dir_and_event_sink(
            None,
            Some(sink.clone()),
            session_id.clone(),
            "run shell".to_string(),
            None,
            None,
            None,
        )
        .unwrap();

    let requested = wait_for_event(&events, |event| {
        event.event_type == "session.tool.approval.requested"
            && event.payload["toolCallId"] == "call-bash"
    });
    assert_eq!(requested.session_id, session_id);

    let responded = state
        .session_tool_respond_with_resource_dir_and_event_sink(
            None,
            Some(sink),
            session_id.clone(),
            "call-bash".to_string(),
            true,
        )
        .unwrap();

    assert_eq!(responded.session.id, session_id);
    assert!(responded.events.iter().any(|event| {
        event.event_type == "session.tool.approval.responded"
            && event.payload["toolCallId"] == "call-bash"
            && event.payload["approved"] == true
    }));
    wait_for_event(&events, |event| {
        event.event_type == "session.tool.result" && event.payload["toolCallId"] == "call-bash"
    });
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn stop_persists_running_sessions_as_stopped() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let slow_response = "slow ".repeat(80);
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", &slow_response);
    let _faux_tokens = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let history_path = temp.path().join("pi-sessions.json");
    state.set_history_path(Some(history_path.clone())).unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let created = state
        .session_create_with_resource_dir(None, Some("Manual Stop".to_string()), Some(cwd))
        .unwrap();
    let sent = state
        .session_send_with_resource_dir(
            None,
            created.session.id.clone(),
            "hello".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
    write_history(
        &history_path,
        sent.session,
        [created.events, sent.events].concat(),
    );

    state.stop().unwrap();
    let history = read_history(&history_path);

    assert_eq!(history.sessions[0].status, "stopped");
    assert!(history.events.iter().any(|event| {
        event.event_type == "session.status"
            && event.session_id == created.session.id
            && event.payload["status"] == "stopped"
    }));
}

#[tokio::test]
async fn idle_shutdown_persists_idle_sessions_as_stopped() {
    let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
    let temp = tempfile::tempdir().unwrap();
    let history_path = temp.path().join("pi-sessions.json");
    state.set_history_path(Some(history_path.clone())).unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let session_id = {
        let _env_guard = PI_TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let created = state
            .session_create_with_resource_dir(None, Some("Idle Stop".to_string()), Some(cwd))
            .unwrap();
        write_history(&history_path, created.session.clone(), created.events);
        created.session.id
    };

    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

    assert_eq!(state.snapshot().unwrap().phase, PiPhase::Disconnected);
    let history = read_history(&history_path);
    assert_eq!(history.sessions[0].status, "stopped");
    assert!(history.events.iter().any(|event| {
        event.event_type == "session.status"
            && event.session_id == session_id
            && event.payload["status"] == "stopped"
    }));
}

#[tokio::test]
async fn idle_shutdown_stops_unused_started_host() {
    let state = {
        let _env_guard = PI_TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
        state.start().unwrap();
        state
    };

    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

    let snapshot = state.snapshot().unwrap();
    assert_eq!(snapshot.phase, PiPhase::Disconnected);
}

#[tokio::test(flavor = "current_thread")]
async fn idle_shutdown_does_not_stop_running_sessions() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let slow_response = "slow ".repeat(80);
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", &slow_response);
    let _faux_tokens = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let created = state
        .session_create_with_resource_dir(None, Some("Long Pi".to_string()), Some(cwd))
        .unwrap();
    let session_id = created.session.id;
    state
        .session_send_with_resource_dir(None, session_id, "hello".to_string(), None, None, None)
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(250));

    assert_eq!(state.snapshot().unwrap().phase, PiPhase::Ready);
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn stop_resets_to_disconnected() {
    let _env_guard = PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = PiState::default();
    state.start().unwrap();
    let snapshot = state.stop().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}
