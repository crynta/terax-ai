//! Lightweight system resource probes (CPU + RAM) for the status bar pill.
//!
//! Deliberately avoids pulling in a heavy crate like `sysinfo`: each platform
//! uses its native APIs (Mach `host_statistics` on macOS, `/proc` on Linux,
//! `GlobalMemoryStatusEx` + `GetSystemTimes` on Windows). The numbers are
//! best-effort and only shown in a small, low-key UI element.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "windows")]
pub mod windows;

/// Snapshot of system resources at poll time.
#[derive(Clone, serde::Serialize)]
pub struct SysResources {
    /// System-wide CPU utilization, 0.0–100.0.
    pub cpu_percent: f32,
    /// Total physical memory in bytes.
    pub mem_total_bytes: u64,
    /// Currently used physical memory in bytes.
    pub mem_used_bytes: u64,
    /// Name of a detected local-model process (e.g. `ollama`), if any.
    pub model_process: Option<String>,
    /// Resident memory of the detected model process, in bytes.
    pub model_mem_bytes: Option<u64>,
}

#[cfg(target_os = "macos")]
use macos::sys_resources as sys_resources_inner;
#[cfg(target_os = "linux")]
use linux::sys_resources as sys_resources_inner;
#[cfg(target_os = "windows")]
use windows::sys_resources as sys_resources_inner;

#[tauri::command]
pub fn sys_resources() -> SysResources {
    sys_resources_inner()
}
