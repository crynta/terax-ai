//! Sweeps orphan PowerShell / pwsh processes left over by previous Terax
//! instances. ConPTY + portable-pty has a known intermittent race where the
//! child shell gets stuck mid-init at a tiny working set, never reaching the
//! prompt. When Terax dies ungracefully (crash, dev HMR force-kill, Ctrl-C of
//! `cargo run`) before its `pty_close` path runs, the Job Object's
//! `KILL_ON_JOB_CLOSE` does fire — but only for clean Drops. Force-killed
//! parents leave the shells parentless and stuck, and they accumulate across
//! sessions until they degrade subsequent ConPTY spawns.
//!
//! On startup we enumerate processes once and terminate any pwsh/powershell
//! whose parent PID is no longer alive *and* whose working set is below
//! [`STUCK_WS_THRESHOLD`]. A healthy interactive PowerShell sits well above
//! 50 MB once its runtime is loaded — a sub-5-MB process is the stuck-init
//! signature we observed and not useful to anyone.

#![cfg(windows)]

use std::collections::HashSet;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};

// 5 MB. Healthy PowerShell is 50+ MB; pwsh 7 is 60+ MB. A shell that has been
// alive long enough to enumerate here but is still under this threshold is in
// the stuck-init state and won't recover.
const STUCK_WS_THRESHOLD: usize = 5 * 1024 * 1024;

struct Entry {
    pid: u32,
    parent_pid: u32,
    name: String,
}

/// Terminate orphaned ConPTY-spawned shells from prior Terax sessions.
/// Safe to call at any time; idempotent. Logs each termination.
pub fn sweep_orphan_shells() {
    let entries = enumerate_processes();
    let live: HashSet<u32> = entries.iter().map(|e| e.pid).collect();

    let mut killed = 0u32;
    for e in &entries {
        if !is_shell(&e.name) {
            continue;
        }
        // Parent still alive? Not an orphan — leave it alone, it may belong
        // to the current Terax process or another live instance.
        if live.contains(&e.parent_pid) {
            continue;
        }
        let Some(ws) = working_set_bytes(e.pid) else {
            continue;
        };
        if ws >= STUCK_WS_THRESHOLD {
            continue;
        }
        if terminate(e.pid) {
            killed += 1;
            log::info!(
                "swept orphan shell pid={} name={} ws={}KB",
                e.pid,
                e.name,
                ws / 1024
            );
        }
    }
    if killed > 0 {
        log::info!("sweep_orphan_shells: terminated {killed} orphan(s)");
    }
}

fn is_shell(name: &str) -> bool {
    name.eq_ignore_ascii_case("pwsh.exe") || name.eq_ignore_ascii_case("powershell.exe")
}

fn enumerate_processes() -> Vec<Entry> {
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap.is_null() {
            return out;
        }
        let mut pe: PROCESSENTRY32W = std::mem::zeroed();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut pe) != 0 {
            loop {
                let name = wide_to_string(&pe.szExeFile);
                out.push(Entry {
                    pid: pe.th32ProcessID,
                    parent_pid: pe.th32ParentProcessID,
                    name,
                });
                if Process32NextW(snap, &mut pe) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

fn working_set_bytes(pid: u32) -> Option<usize> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if h.is_null() {
            return None;
        }
        let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        let cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let ok = GetProcessMemoryInfo(h, &mut counters, cb);
        CloseHandle(h);
        if ok == 0 {
            None
        } else {
            Some(counters.WorkingSetSize)
        }
    }
}

fn terminate(pid: u32) -> bool {
    unsafe {
        let h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
        if h.is_null() {
            return false;
        }
        let ok = TerminateProcess(h, 1) != 0;
        CloseHandle(h);
        ok
    }
}

fn wide_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    OsString::from_wide(&wide[..len])
        .into_string()
        .unwrap_or_default()
}
