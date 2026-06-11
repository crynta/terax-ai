use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use serde::Serialize;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize)]
pub struct Lease {
    pub holder: String,
    pub acquired_at: String,
}

pub struct FileLeaseCoordinator {
    leases: Arc<RwLock<HashMap<PathBuf, Lease>>>,
}

impl Default for FileLeaseCoordinator {
    fn default() -> Self {
        Self {
            leases: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl FileLeaseCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn acquire(&self, path: PathBuf, holder: String) -> Result<(), String> {
        let mut leases = self.leases.write().await;
        if let Some(existing) = leases.get(&path) {
            if existing.holder != holder {
                return Err(format!(
                    "file {} is locked by {}",
                    path.display(),
                    existing.holder
                ));
            }
        }
        leases.insert(
            path,
            Lease {
                holder,
                acquired_at: chrono::Utc::now().to_rfc3339(),
            },
        );
        Ok(())
    }

    pub async fn release(&self, path: &PathBuf, holder: &str) -> Result<(), String> {
        let mut leases = self.leases.write().await;
        if let Some(existing) = leases.get(path) {
            if existing.holder != holder {
                return Err(format!(
                    "cannot release {}: held by {}",
                    path.display(),
                    existing.holder
                ));
            }
            leases.remove(path);
        }
        Ok(())
    }

    pub async fn is_locked(&self, path: &PathBuf) -> Option<Lease> {
        self.leases.read().await.get(path).cloned()
    }

    pub async fn release_all_by_holder(&self, holder: &str) {
        let mut leases = self.leases.write().await;
        leases.retain(|_, v| v.holder != holder);
    }
}

#[tauri::command]
pub async fn file_lease_acquire(
    state: tauri::State<'_, FileLeaseCoordinator>,
    path: String,
    holder: String,
) -> Result<(), String> {
    state.acquire(PathBuf::from(path), holder).await
}

#[tauri::command]
pub async fn file_lease_release(
    state: tauri::State<'_, FileLeaseCoordinator>,
    path: String,
    holder: String,
) -> Result<(), String> {
    state.release(&PathBuf::from(path), &holder).await
}

#[tauri::command]
pub async fn file_lease_status(
    state: tauri::State<'_, FileLeaseCoordinator>,
    path: String,
) -> Result<Option<Lease>, String> {
    Ok(state.is_locked(&PathBuf::from(path)).await)
}
