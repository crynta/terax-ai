//! `$PATH` resolution for agent backend binaries.
//!
//! We check each candidate name in order and return the first that resolves
//! via the `which` crate. The result is fed back to the UI so it can show
//! "installed / not installed" without needing to spawn the process.

use super::backend::AgentBackend;

pub fn resolve(backend: &AgentBackend) -> Option<String> {
    for name in backend.binaries {
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}
