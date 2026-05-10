//! FTP protocol implementation using lftp CLI

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::process::Command;

pub struct FtpState {
    sessions: Mutex<HashMap<u32, String>>,
    next_id: std::sync::atomic::AtomicU32,
}

impl Default for FtpState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: std::sync::atomic::AtomicU32::new(1),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct FtpConnectResult {
    pub handle: u32,
    pub banner: String,
}

#[derive(Serialize, Deserialize)]
pub struct FtpEntry {
    pub name: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Serialize, Deserialize)]
pub struct FtpListResult {
    pub entries: Vec<FtpEntry>,
}

#[derive(Serialize, Deserialize)]
pub struct FtpTransferResult {
    pub ok: bool,
    pub bytes: u64,
}

fn run_ftp_command(host: &str, user: &str, password: &str, cmd: &str) -> Result<String, String> {
    let output = Command::new("lftp")
        .args([
            "-u",
            &format!("{},{}", user, password),
            &format!("ftp://{}", host),
            "-e",
            cmd,
        ])
        .output()
        .map_err(|e| format!("lftp failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("lftp command failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn ftp_connect(
    state: tauri::State<FtpState>,
    host: String,
    port: Option<u16>,
    user: Option<String>,
    password: Option<String>,
) -> Result<FtpConnectResult, String> {
    let user = user.unwrap_or_else(|| "anonymous".to_string());
    let password = password.unwrap_or_else(|| "anonymous".to_string());
    let host = if let Some(p) = port {
        format!("{}:{}", host, p)
    } else {
        host
    };

    // Test connection by listing root
    let result = run_ftp_command(&host, &user, &password, "ls")?;

    let handle = state.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    state.sessions.lock().unwrap().insert(handle, host);

    Ok(FtpConnectResult {
        handle,
        banner: result.lines().next().unwrap_or("Connected").to_string(),
    })
}

#[tauri::command]
pub fn ftp_list(
    state: tauri::State<FtpState>,
    handle: u32,
    path: Option<String>,
) -> Result<FtpListResult, String> {
    let sessions = state.sessions.lock().unwrap();
    let host = sessions.get(&handle).ok_or("invalid FTP handle")?;

    let user = "anonymous";
    let password = "anonymous";

    let cmd = if let Some(p) = path {
        format!("ls {}", p)
    } else {
        "ls".to_string()
    };

    let result = run_ftp_command(host, user, password, &cmd)?;

    let entries: Vec<FtpEntry> = result
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 9 {
                return None;
            }
            let name = parts[8..].join(" ");
            let kind = if line.starts_with('d') {
                "dir"
            } else {
                "file"
            };
            let size = parts[4].parse::<u64>().unwrap_or(0);
            Some(FtpEntry {
                name,
                size,
                kind: kind.to_string(),
            })
        })
        .collect();

    Ok(FtpListResult { entries })
}

#[tauri::command]
pub fn ftp_get(
    state: tauri::State<FtpState>,
    handle: u32,
    remote_path: String,
    local_path: String,
) -> Result<FtpTransferResult, String> {
    let sessions = state.sessions.lock().unwrap();
    let host = sessions.get(&handle).ok_or("invalid FTP handle")?;

    let user = "anonymous";
    let password = "anonymous";

    let cmd = format!("get -o {} {}", local_path, remote_path);
    run_ftp_command(host, user, password, &cmd)?;

    let metadata = std::fs::metadata(&local_path).map_err(|e| e.to_string())?;

    Ok(FtpTransferResult {
        ok: true,
        bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn ftp_put(
    state: tauri::State<FtpState>,
    handle: u32,
    local_path: String,
    remote_path: String,
) -> Result<FtpTransferResult, String> {
    let sessions = state.sessions.lock().unwrap();
    let host = sessions.get(&handle).ok_or("invalid FTP handle")?;

    let user = "anonymous";
    let password = "anonymous";

    let metadata = std::fs::metadata(&local_path).map_err(|e| e.to_string())?;
    let bytes = metadata.len();

    let cmd = format!("put {} {}", local_path, remote_path);
    run_ftp_command(host, user, password, &cmd)?;

    Ok(FtpTransferResult {
        ok: true,
        bytes,
    })
}

#[tauri::command]
pub fn ftp_disconnect(state: tauri::State<FtpState>, handle: u32) -> Result<bool, String> {
    state.sessions.lock().unwrap().remove(&handle);
    Ok(true)
}