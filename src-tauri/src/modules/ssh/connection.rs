use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub struct SshConn;  // placeholder — filled in Task 4

pub struct SshState {
    pub conns: RwLock<HashMap<String, Arc<SshConn>>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self { conns: RwLock::new(HashMap::new()) }
    }
}
