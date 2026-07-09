#[cfg(windows)]
pub mod job;

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::process::Command;

use crate::modules::pty::PtyState;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pty_id: u32,
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    command: String,
}

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
#[inline]
pub fn hide_console(_cmd: &mut Command) {}

#[tauri::command]
pub fn proc_list_terminal_processes(
    state: tauri::State<PtyState>,
    ids: Vec<u32>,
) -> Result<Vec<ProcessInfo>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let roots = state.shell_pids(&ids);
    if roots.is_empty() {
        return Ok(Vec::new());
    }
    let processes = platform_processes()?;
    Ok(descendants_for_roots(processes, &roots))
}

fn descendants_for_roots(processes: Vec<ProcessInfo>, roots: &[(u32, u32)]) -> Vec<ProcessInfo> {
    let mut children: HashMap<u32, Vec<ProcessInfo>> = HashMap::new();
    for process in processes {
        if let Some(parent) = process.parent_pid {
            children.entry(parent).or_default().push(process);
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (pty_id, shell_pid) in roots {
        collect_descendants(*pty_id, *shell_pid, &children, &mut seen, &mut out);
    }
    out.sort_by_key(|p| (p.pty_id, p.parent_pid.unwrap_or(0), p.pid));
    out
}

fn collect_descendants(
    pty_id: u32,
    parent_pid: u32,
    children: &HashMap<u32, Vec<ProcessInfo>>,
    seen: &mut HashSet<u32>,
    out: &mut Vec<ProcessInfo>,
) {
    let Some(direct) = children.get(&parent_pid) else {
        return;
    };
    for child in direct {
        if !seen.insert(child.pid) {
            continue;
        }
        let mut process = child.clone();
        process.pty_id = pty_id;
        let pid = process.pid;
        out.push(process);
        collect_descendants(pty_id, pid, children, seen, out);
    }
}

#[cfg(unix)]
fn platform_processes() -> Result<Vec<ProcessInfo>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,comm=,args="])
        .output()
        .map_err(|e| format!("failed to run ps: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter_map(parse_ps_line).collect())
}

#[cfg(unix)]
fn parse_ps_line(line: &str) -> Option<ProcessInfo> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let parent_pid = parts.next().and_then(|v| v.parse::<u32>().ok());
    let name = parts.next()?.to_string();
    let command = parts.collect::<Vec<_>>().join(" ");
    Some(ProcessInfo {
        pty_id: 0,
        pid,
        parent_pid,
        command: if command.is_empty() {
            name.clone()
        } else {
            command
        },
        name,
    })
}

#[cfg(windows)]
fn platform_processes() -> Result<Vec<ProcessInfo>, String> {
    let script = r#"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"#;
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", script]);
    hide_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to list processes: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct WinProcess {
        process_id: u32,
        parent_process_id: Option<u32>,
        name: Option<String>,
        command_line: Option<String>,
    }

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("invalid process json: {e}"))?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Null => Vec::new(),
        one => vec![one],
    };

    rows.into_iter()
        .map(|row| {
            let p: WinProcess =
                serde_json::from_value(row).map_err(|e| format!("invalid process row: {e}"))?;
            let name = p.name.unwrap_or_else(|| "process".to_string());
            Ok(ProcessInfo {
                pty_id: 0,
                pid: p.process_id,
                parent_pid: p.parent_process_id,
                command: p.command_line.unwrap_or_else(|| name.clone()),
                name,
            })
        })
        .collect()
}
