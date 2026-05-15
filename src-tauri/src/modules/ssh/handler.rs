use std::sync::{Arc, Mutex};

use russh::client;
use russh::keys::PublicKey;

pub struct SshHandler {
    /// Fingerprint stored in the profile. `None` on first connect (TOFU).
    pub known_fingerprint: Option<String>,
    /// The fingerprint seen during this handshake — written by `check_server_key`,
    /// read back by the caller after `connect()` returns.
    pub observed_fingerprint: Arc<Mutex<Option<String>>>,
}

impl SshHandler {
    pub fn new(known_fingerprint: Option<String>) -> (Self, Arc<Mutex<Option<String>>>) {
        let observed = Arc::new(Mutex::new(None));
        let handler = Self {
            known_fingerprint,
            observed_fingerprint: observed.clone(),
        };
        (handler, observed)
    }
}

#[async_trait::async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        *self.observed_fingerprint.lock().unwrap() = Some(fingerprint.clone());

        if let Some(known) = &self.known_fingerprint {
            if &fingerprint != known {
                log::warn!("SSH host key mismatch! Expected {known}, got {fingerprint}");
                return Ok(false);
            }
        }
        Ok(true)
    }
}
