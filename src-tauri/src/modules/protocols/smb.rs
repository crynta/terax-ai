//! SMB protocol implementation using smbclient CLI
//!
//! Uses the `smbclient` command-line tool for cross-platform compatibility.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct SmbEntry {
    pub name: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
pub struct SmbListResult {
    pub entries: Vec<SmbEntry>,
    pub shares: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize)]
pub struct SmbTransferResult {
    pub ok: bool,
    pub bytes: u64,
}

fn format_auth(user: Option<&str>, password: Option<&str>, domain: Option<&str>) -> String {
    match (user, password, domain) {
        (Some(u), Some(p), Some(_d)) => format!("{}%{}", u, p),
        (Some(u), Some(p), None) => format!("{}%{}", u, p),
        (None, Some(p), Some(_d)) => format!("%{}", p),
        (None, Some(p), None) => format!("%{}", p),
        _ => "".to_string(),
    }
}

#[tauri::command]
pub async fn smb_list(
    host: String,
    share: Option<String>,
    user: Option<String>,
    password: Option<String>,
    domain: Option<String>,
) -> Result<SmbListResult, String> {
    let user_opt = user.as_deref();
    let password_opt = password.as_deref();
    let domain_opt = domain.as_deref();
    let auth = format_auth(user_opt, password_opt, domain_opt);
    let domain_arg = domain_opt.unwrap_or("WORKGROUP");

    if let Some(s) = share {
        let output = std::process::Command::new("smbclient")
            .args([
                &format!("//{}/{}", host, s),
                "-U",
                &auth,
                "-W",
                domain_arg,
                "-c",
                "ls",
            ])
            .output()
            .map_err(|e| format!("smbclient failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("smbclient list failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let entries: Vec<SmbEntry> = stdout
            .lines()
            .filter_map(|line| {
                if line.starts_with("  ") && line.contains(" ") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let name = parts.last()?.to_string();
                        let kind = if line.contains("<DIR>") {
                            "dir"
                        } else {
                            "file"
                        };
                        let size = parts.get(4)?.parse::<u64>().unwrap_or(0);
                        return Some(SmbEntry { name, kind: kind.to_string(), size });
                    }
                }
                None
            })
            .collect();

        Ok(SmbListResult {
            entries,
            shares: None,
        })
    } else {
        let output = std::process::Command::new("smbclient")
            .args([
                &format!("//{}/", host),
                "-U",
                &auth,
                "-W",
                domain_arg,
                "-L",
            ])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let shares: Vec<String> = stdout
                    .lines()
                    .filter_map(|line| {
                        if line.contains("\t") || line.contains("   ") {
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            parts.first().map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .filter(|s| !s.is_empty() && !s.contains("---"))
                    .collect();

                Ok(SmbListResult {
                    entries: vec![],
                    shares: Some(shares),
                })
            }
            _ => {
                // Fallback to enum4linux-ng
                let output = std::process::Command::new("enum4linux")
                    .args(["-S", &host])
                    .output();

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let shares: Vec<String> = stdout
                            .lines()
                            .filter(|l| l.contains("//") && l.ends_with('/'))
                            .filter_map(|l| {
                                l.split_whitespace()
                                    .find(|s| s.starts_with("//"))
                                    .map(|s| s.trim_start_matches("//").trim_end_matches('/').to_string())
                            })
                            .collect();

                        Ok(SmbListResult {
                            entries: vec![],
                            shares: Some(shares),
                        })
                    }
                    Err(e) => Err(format!(
                        "Failed to enumerate shares. Install smbclient or enum4linux-ng: {}",
                        e
                    )),
                }
            }
        }
    }
}

#[tauri::command]
pub async fn smb_get(
    host: String,
    share: String,
    remote_path: String,
    local_path: String,
    user: Option<String>,
    password: Option<String>,
    domain: Option<String>,
) -> Result<SmbTransferResult, String> {
    let user_opt = user.as_deref();
    let password_opt = password.as_deref();
    let domain_opt = domain.as_deref();
    let auth = format_auth(user_opt, password_opt, domain_opt);
    let domain_arg = domain_opt.unwrap_or("WORKGROUP");

    let output = std::process::Command::new("smbclient")
        .args([
            &format!("//{}/{}", host, share),
            "-U",
            &auth,
            "-W",
            domain_arg,
            "-c",
            &format!("get \"{}\" \"{}\"", remote_path, local_path),
        ])
        .output()
        .map_err(|e| format!("smbclient get failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("smb get failed: {}", stderr));
    }

    let metadata = std::fs::metadata(&local_path).map_err(|e| e.to_string())?;
    Ok(SmbTransferResult {
        ok: true,
        bytes: metadata.len(),
    })
}

#[tauri::command]
pub async fn smb_put(
    host: String,
    share: String,
    remote_path: String,
    local_path: String,
    user: Option<String>,
    password: Option<String>,
    domain: Option<String>,
) -> Result<SmbTransferResult, String> {
    let user_opt = user.as_deref();
    let password_opt = password.as_deref();
    let domain_opt = domain.as_deref();
    let auth = format_auth(user_opt, password_opt, domain_opt);
    let domain_arg = domain_opt.unwrap_or("WORKGROUP");

    let output = std::process::Command::new("smbclient")
        .args([
            &format!("//{}/{}", host, share),
            "-U",
            &auth,
            "-W",
            domain_arg,
            "-c",
            &format!("put \"{}\" \"{}\"", local_path, remote_path),
        ])
        .output()
        .map_err(|e| format!("smbclient put failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("smb put failed: {}", stderr));
    }

    let metadata = std::fs::metadata(&local_path).map_err(|e| e.to_string())?;
    Ok(SmbTransferResult {
        ok: true,
        bytes: metadata.len(),
    })
}