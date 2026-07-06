#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::local_agents::resolve_local_agent_binary_in_path;

#[test]
fn pi_env_api_key_rejects_unsupported_names() {
    assert!(super::pi_env_api_key("HOME".to_string()).is_err());
}

#[test]
fn local_agent_detection_uses_allowlisted_binaries() {
    let dir = tempfile::tempdir().unwrap();
    let claude = dir.path().join("claude");
    let codex = dir.path().join("codex");
    let pi = dir.path().join("pi");
    std::fs::write(&claude, "").unwrap();
    std::fs::write(&codex, "").unwrap();
    std::fs::write(&pi, "").unwrap();
    #[cfg(unix)]
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
    #[cfg(unix)]
    std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = dir.path().to_str().unwrap();

    assert_eq!(
        resolve_local_agent_binary_in_path("claude", path),
        Some(claude)
    );
    assert_eq!(resolve_local_agent_binary_in_path("pi", path), Some(pi));
    #[cfg(unix)]
    assert!(resolve_local_agent_binary_in_path("codex", path).is_none());
    assert!(resolve_local_agent_binary_in_path("sh", path).is_none());
}
