use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use russh::client::Handle;
use russh_sftp::client::SftpSession;

use super::handler::SshHandler;

pub struct SshConn {
    pub handle: Handle<SshHandler>,
    pub sftp: SftpSession,
}

pub struct SshState {
    pub conns: RwLock<HashMap<String, Arc<SshConn>>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            conns: RwLock::new(HashMap::new()),
        }
    }
}

impl SshState {
    pub fn get(&self, profile_id: &str) -> Option<Arc<SshConn>> {
        self.conns.read().unwrap().get(profile_id).cloned()
    }

    pub fn get_or_err(&self, profile_id: &str) -> Result<Arc<SshConn>, String> {
        self.get(profile_id)
            .ok_or_else(|| format!("SSH: no active connection for profile {profile_id}"))
    }

    pub fn insert(&self, profile_id: String, conn: Arc<SshConn>) {
        self.conns.write().unwrap().insert(profile_id, conn);
    }

    pub fn remove(&self, profile_id: &str) -> Option<Arc<SshConn>> {
        self.conns.write().unwrap().remove(profile_id)
    }
}
