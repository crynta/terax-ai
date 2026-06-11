use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::store;
use super::types::*;

/// Pi runtime state. The agent runs in the webview, so there is no external
/// process to supervise; this only tracks the session history path used by the
/// store-backed commands.
pub struct PiState {
    history_path: Arc<Mutex<Option<PathBuf>>>,
}

impl Default for PiState {
    fn default() -> Self {
        Self {
            history_path: Arc::new(Mutex::new(None)),
        }
    }
}

impl PiState {
    pub fn set_history_path(&self, history_path: Option<PathBuf>) -> Result<(), String> {
        *self.history_path.lock().map_err(|e| e.to_string())? = history_path;
        Ok(())
    }

    pub(super) fn mark_unfinished_sessions_stopped(&self) {
        let path = match self.history_path.lock() {
            Ok(path) => path.clone(),
            Err(_) => None,
        };
        if let Some(path) = path {
            if let Err(e) = store::mark_unfinished_sessions_stopped_at_path(&path) {
                log::debug!("mark unfinished sessions stopped failed: {e}");
            }
        }
    }

    /// The webview agent has no separate runtime to report on; it is always ready.
    pub fn snapshot(&self) -> Result<PiRuntimeSnapshot, String> {
        Ok(PiRuntimeSnapshot::default())
    }
}
