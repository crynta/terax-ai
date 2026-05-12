use std::collections::HashMap;
use std::sync::Arc;

use russh::client;
use russh::keys::ssh_key;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::SshHostInfo;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("connection not found: {0}")]
    NotFound(String),
    #[error("authentication failed: {0}")]
    Auth(String),
    #[error("connection failed: {0}")]
    Connection(String),
    #[error("sftp error: {0}")]
    Sftp(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("already connected: {0}")]
    AlreadyConnected(String),
}

impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        SshError::Connection(e.to_string())
    }
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        log::info!(
            "accepting server key: {}",
            server_public_key.fingerprint(ssh_key::HashAlg::Sha256)
        );
        Ok(true)
    }
}

struct SshConnection {
    _handle: client::Handle<ClientHandler>,
    sftp: SftpSession,
}

#[derive(Deserialize)]
pub struct ConnectParams {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub password: Option<String>,
    pub key_file: Option<String>,
}

pub struct SshState {
    connections: Mutex<HashMap<String, SshConnection>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

async fn connect_ssh(params: &ConnectParams) -> Result<SshConnection, SshError> {
    let config = client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(300)),
        keepalive_interval: Some(std::time::Duration::from_secs(15)),
        ..Default::default()
    };
    let handler = ClientHandler;
    let port = params.port.unwrap_or(22);

    let mut handle =
        client::connect(Arc::new(config), (params.host.as_str(), port), handler).await?;

    let mut auth_ok = false;

    if let Some(key_path) = &params.key_file {
        let key = russh::keys::load_secret_key(key_path, None)
            .map_err(|e| SshError::Auth(format!("failed to load key: {e}")))?;
        let hash_alg: Option<russh::keys::HashAlg> = match handle.best_supported_rsa_hash().await {
            Ok(Some(Some(h))) => Some(h),
            _ => None,
        };
        match handle
            .authenticate_publickey(
                &params.user,
                russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
            )
            .await
        {
            Ok(r) => auth_ok = r.success(),
            Err(e) => log::warn!("publickey auth failed: {e}"),
        }
    }

    if !auth_ok {
        if let Some(password) = &params.password {
            match handle.authenticate_password(&params.user, password).await {
                Ok(r) => {
                    log::info!("password auth result: success={}", r.success(),);
                    auth_ok = r.success();
                }
                Err(e) => log::warn!("password auth error: {e}"),
            }
        }
    }

    if !auth_ok {
        match handle.authenticate_none(&params.user).await {
            Ok(r) => auth_ok = r.success(),
            Err(e) => log::warn!("none auth error: {e}"),
        }
    }

    if !auth_ok {
        return Err(SshError::Auth("all authentication methods failed".into()));
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| SshError::Connection(format!("failed to open channel: {e}")))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| SshError::Sftp(format!("failed to request sftp subsystem: {e}")))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| SshError::Sftp(format!("failed to init sftp: {e}")))?;

    Ok(SshConnection {
        _handle: handle,
        sftp,
    })
}

pub async fn ssh_connect(state: &SshState, params: ConnectParams) -> Result<SshHostInfo, SshError> {
    let name = params.name.clone();
    let host = params.host.clone();
    let port = params.port.unwrap_or(22);
    let user = params.user.clone();

    {
        let conns = state.connections.lock().await;
        if conns.contains_key(&name) {
            return Err(SshError::AlreadyConnected(name));
        }
    }

    let conn = connect_ssh(&params).await?;

    {
        let mut conns = state.connections.lock().await;
        conns.insert(name.clone(), conn);
    }

    Ok(SshHostInfo {
        name,
        host,
        port,
        user,
        connected: true,
    })
}

pub async fn ssh_disconnect(state: &SshState, name: &str) -> Result<(), SshError> {
    let mut conns = state.connections.lock().await;
    conns
        .remove(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;
    Ok(())
}

pub async fn ssh_read_dir(
    state: &SshState,
    name: &str,
    path: &str,
) -> Result<Vec<super::RemoteDirEntry>, SshError> {
    let read_dir = {
        let conns = state.connections.lock().await;
        let conn = conns
            .get(name)
            .ok_or_else(|| SshError::NotFound(name.to_string()))?;
        conn.sftp.read_dir(path).await
    };
    let dir_entries = read_dir.map_err(|e| SshError::Sftp(e.to_string()))?;

    let mut entries: Vec<super::RemoteDirEntry> = dir_entries
        .into_iter()
        .filter(|e| {
            let n = e.file_name();
            !n.starts_with('.') && n != "." && n != ".."
        })
        .map(|e| {
            let meta = e.metadata();
            let kind = if meta.is_dir() {
                super::RemoteEntryKind::Dir
            } else if meta.is_symlink() {
                super::RemoteEntryKind::Symlink
            } else {
                super::RemoteEntryKind::File
            };

            let size = meta.len();
            let mtime = match meta.modified() {
                Ok(t) => t
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
                Err(_) => 0,
            };

            super::RemoteDirEntry {
                name: e.file_name(),
                kind,
                size,
                mtime,
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        let rank = |k: &super::RemoteEntryKind| match k {
            super::RemoteEntryKind::Dir => 0,
            super::RemoteEntryKind::Symlink => 1,
            super::RemoteEntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

pub async fn ssh_resolve_home(
    state: &SshState,
    name: &str,
    user: &str,
) -> Result<String, SshError> {
    let candidates = [
        format!("/home/{user}"),
        "/root".to_string(),
        "/".to_string(),
    ];
    for dir in &candidates {
        let result = {
            let conns = state.connections.lock().await;
            let conn = conns
                .get(name)
                .ok_or_else(|| SshError::NotFound(name.to_string()))?;
            conn.sftp.read_dir(dir).await
        };
        if let Ok(entries) = result {
            let count = entries.count();
            log::info!("resolve_home: {dir} ok, {count} entries");
            return Ok(dir.clone());
        }
    }
    Ok("/".to_string())
}

pub async fn ssh_read_file(
    state: &SshState,
    name: &str,
    path: &str,
) -> Result<super::RemoteReadResult, SshError> {
    let meta = {
        let conns = state.connections.lock().await;
        let conn = conns
            .get(name)
            .ok_or_else(|| SshError::NotFound(name.to_string()))?;
        conn.sftp.metadata(path).await
    };
    let meta = meta.map_err(|e| SshError::Sftp(e.to_string()))?;
    let size = meta.len() as u64;

    if size > MAX_READ_BYTES {
        return Ok(super::RemoteReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let buf = {
        let conns = state.connections.lock().await;
        let conn = conns
            .get(name)
            .ok_or_else(|| SshError::NotFound(name.to_string()))?;
        conn.sftp.read(path).await
    };
    let buf = buf.map_err(|e| SshError::Sftp(e.to_string()))?;

    let sniff_len = buf.len().min(8 * 1024);
    if !buf.is_empty() && buf[..sniff_len].contains(&0) {
        return Ok(super::RemoteReadResult::Binary { size });
    }

    match String::from_utf8(buf) {
        Ok(content) => Ok(super::RemoteReadResult::Text { content, size }),
        Err(_) => Ok(super::RemoteReadResult::Binary { size }),
    }
}

pub async fn ssh_write_file(
    state: &SshState,
    name: &str,
    path: &str,
    content: &str,
) -> Result<(), SshError> {
    let conns = state.connections.lock().await;
    let conn = conns
        .get(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;

    let mut file = conn
        .sftp
        .open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| SshError::Sftp(e.to_string()))?;

    file.write_all(content.as_bytes())
        .await
        .map_err(|e| SshError::Io(e.to_string()))?;

    file.shutdown()
        .await
        .map_err(|e| SshError::Io(e.to_string()))?;

    Ok(())
}

pub async fn ssh_stat(
    state: &SshState,
    name: &str,
    path: &str,
) -> Result<super::RemoteFileStat, SshError> {
    let meta = {
        let conns = state.connections.lock().await;
        let conn = conns
            .get(name)
            .ok_or_else(|| SshError::NotFound(name.to_string()))?;
        conn.sftp.metadata(path).await
    };
    let meta = meta.map_err(|e| SshError::Sftp(e.to_string()))?;

    let kind = if meta.is_dir() {
        super::RemoteStatKind::Dir
    } else if meta.is_symlink() {
        super::RemoteStatKind::Symlink
    } else {
        super::RemoteStatKind::File
    };

    Ok(super::RemoteFileStat {
        size: meta.len() as u64,
        mtime: match meta.modified() {
            Ok(t) => t
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            Err(_) => 0,
        },
        kind,
    })
}

pub async fn ssh_create_file(state: &SshState, name: &str, path: &str) -> Result<(), SshError> {
    let conns = state.connections.lock().await;
    let conn = conns
        .get(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;

    let mut file = conn
        .sftp
        .open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| SshError::Sftp(e.to_string()))?;

    file.shutdown()
        .await
        .map_err(|e| SshError::Io(e.to_string()))?;

    Ok(())
}

pub async fn ssh_create_dir(state: &SshState, name: &str, path: &str) -> Result<(), SshError> {
    let conns = state.connections.lock().await;
    let conn = conns
        .get(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;
    conn.sftp
        .create_dir(path)
        .await
        .map_err(|e| SshError::Sftp(e.to_string()))
}

pub async fn ssh_rename(
    state: &SshState,
    name: &str,
    from: &str,
    to: &str,
) -> Result<(), SshError> {
    let conns = state.connections.lock().await;
    let conn = conns
        .get(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;
    conn.sftp
        .rename(from, to)
        .await
        .map_err(|e| SshError::Sftp(e.to_string()))
}

pub async fn ssh_delete(state: &SshState, name: &str, path: &str) -> Result<(), SshError> {
    let conns = state.connections.lock().await;
    let conn = conns
        .get(name)
        .ok_or_else(|| SshError::NotFound(name.to_string()))?;

    let meta = conn
        .sftp
        .metadata(path)
        .await
        .map_err(|e| SshError::Sftp(e.to_string()))?;

    if meta.is_dir() {
        conn.sftp
            .remove_dir(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))
    } else {
        conn.sftp
            .remove_file(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))
    }
}

pub async fn ssh_list_connections(state: &SshState) -> Result<Vec<SshHostInfo>, SshError> {
    let conns = state.connections.lock().await;
    Ok(conns
        .keys()
        .map(|name| SshHostInfo {
            name: name.clone(),
            host: String::new(),
            port: 0,
            user: String::new(),
            connected: true,
        })
        .collect())
}
