//! SSH protocol implementation using ssh2 crate

use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct SshExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Serialize, Deserialize)]
pub struct FileTransferResult {
    pub ok: bool,
    pub bytes_written: u64,
}

fn connect_ssh(
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<Session, String> {
    let addr = format!("{}:{}", host, port);
    let tcp = TcpStream::connect(&addr).map_err(|e| format!("TCP connect failed: {}", e))?;

    let mut session = Session::new().map_err(|e| format!("SSH session create failed: {}", e))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Authenticate
    if let Some(key) = key_path {
        let key_path = Path::new(key);
        session
            .userauth_pubkey_file(user, None, key_path, None)
            .map_err(|e| format!("SSH key auth failed: {}", e))?;
    } else if let Some(pwd) = password {
        session
            .userauth_password(user, pwd)
            .map_err(|e| format!("SSH password auth failed: {}", e))?;
    } else {
        return Err("No authentication method provided".to_string());
    }

    if !session.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    Ok(session)
}

#[tauri::command]
pub async fn ssh_exec(
    host: String,
    port: Option<u16>,
    user: String,
    password: Option<String>,
    key_path: Option<String>,
    command: String,
) -> Result<SshExecResult, String> {
    let port = port.unwrap_or(22);
    let session = connect_ssh(&host, port, &user, password.as_deref(), key_path.as_deref())?;

    let mut channel = session
        .channel_session()
        .map_err(|e| format!("SSH channel failed: {}", e))?;

    channel
        .exec(&command)
        .map_err(|e| format!("SSH exec failed: {}", e))?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout).map_err(|e| e.to_string())?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|e| e.to_string())?;

    channel.wait_close().map_err(|e| e.to_string())?;
    let exit_code = channel.exit_status().unwrap_or(-1);

    Ok(SshExecResult {
        stdout,
        stderr,
        exit_code,
    })
}

#[tauri::command]
pub async fn ssh_upload(
    host: String,
    port: Option<u16>,
    user: String,
    password: Option<String>,
    key_path: Option<String>,
    local_path: String,
    remote_path: String,
) -> Result<FileTransferResult, String> {
    let port = port.unwrap_or(22);
    let session = connect_ssh(&host, port, &user, password.as_deref(), key_path.as_deref())?;

    let local = Path::new(&local_path);
    let content = std::fs::read(local).map_err(|e| format!("Read local file failed: {}", e))?;

    let sftp = session
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;

    let mut remote_file = sftp
        .create(Path::new(&remote_path))
        .map_err(|e| format!("Create remote file failed: {}", e))?;

    let bytes_written = remote_file
        .write(&content)
        .map_err(|e| format!("Write failed: {}", e))? as u64;

    Ok(FileTransferResult {
        ok: true,
        bytes_written,
    })
}

#[tauri::command]
pub async fn ssh_download(
    host: String,
    port: Option<u16>,
    user: String,
    password: Option<String>,
    key_path: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<FileTransferResult, String> {
    let port = port.unwrap_or(22);
    let session = connect_ssh(&host, port, &user, password.as_deref(), key_path.as_deref())?;

    let sftp = session
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;

    let mut remote_file = sftp
        .open(Path::new(&remote_path))
        .map_err(|e| format!("Open remote file failed: {}", e))?;

    let mut content = Vec::new();
    remote_file
        .read_to_end(&mut content)
        .map_err(|e| format!("Read remote file failed: {}", e))?;

    std::fs::write(&local_path, &content).map_err(|e| format!("Write local file failed: {}", e))?;

    Ok(FileTransferResult {
        ok: true,
        bytes_written: content.len() as u64,
    })
}