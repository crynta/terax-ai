pub mod commands;
pub mod manager;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteEntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct RemoteDirEntry {
    pub name: String,
    pub kind: RemoteEntryKind,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RemoteReadResult {
    Text { content: String, size: u64 },
    Binary { size: u64 },
    TooLarge { size: u64, limit: u64 },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteStatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct RemoteFileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: RemoteStatKind,
}

#[derive(Serialize)]
pub struct SshHostInfo {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub connected: bool,
}
