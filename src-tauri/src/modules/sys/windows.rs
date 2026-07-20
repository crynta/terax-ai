//! Windows system resource probes via `GlobalMemoryStatusEx` + `GetSystemTimes`.

use std::sync::Mutex;

use windows_sys::Win32::System::ProcessStatus::GlobalMemoryStatusEx;
use windows_sys::Win32::System::Threading::GetSystemTimes;
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::ProcessStatus::MEMORYSTATUSEX;

use crate::modules::sys::SysResources;

/// Process names we treat as "local AI model" runtimes.
const MODEL_PROCESS_NAMES: &[&str] = &[
    "ollama",
    "llama-server",
    "llama",
    "lmstudio",
    "exo",
    "vllm",
    "oobabooga",
];

/// Previous (idle, kernel+user) system times, kept across calls for a delta.
static PREV_TIMES: Mutex<Option<(u64, u64)>> = Mutex::new(None);

fn filetime_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
}

fn cpu_load_percent() -> f32 {
    let mut idle = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut kernel = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut user = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
    if ok == 0 {
        return 0.0;
    }
    let idle_t = filetime_to_u64(idle);
    let kernel_t = filetime_to_u64(kernel);
    let user_t = filetime_to_u64(user);
    let total = kernel_t.saturating_add(user_t);
    let busy = total.saturating_sub(idle_t);

    let mut prev = PREV_TIMES.lock().unwrap();
    let percent = match *prev {
        Some((p_total, p_idle)) => {
            let total_d = total.saturating_sub(p_total);
            let idle_d = idle_t.saturating_sub(p_idle);
            if total_d == 0 {
                0.0
            } else {
                ((total_d - idle_d) as f32 / total_d as f32) * 100.0
            }
        }
        None => 0.0,
    };
    *prev = Some((total, idle_t));
    percent
}

fn memory_bytes() -> (u64, u64) {
    let mut info = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        dwMemoryLoad: 0,
        ullTotalPhys: 0,
        ullAvailPhys: 0,
        ullTotalPageFile: 0,
        ullAvailPageFile: 0,
        ullTotalVirtual: 0,
        ullAvailVirtual: 0,
        ullAvailExtendedVirtual: 0,
    };
    let ok = unsafe { GlobalMemoryStatusEx(&mut info) };
    if ok == 0 {
        return (0, 0);
    }
    let total = info.ullTotalPhys;
    let used = total.saturating_sub(info.ullAvailPhys);
    (total, used)
}

/// Best-effort scan via `tasklist` for a known local-model process.
fn detect_model_process() -> (Option<String>, Option<u64>) {
    use std::process::Command;

    let output = Command::new("tasklist")
        .args(["/fo", "csv", "/nh"])
        .output()
        .ok();
    let Some(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let cols: Vec<&str> = line.split(',').collect();
        if cols.is_empty() {
            continue;
        }
        let name = cols[0].trim().trim_matches('"');
        let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
        if MODEL_PROCESS_NAMES.iter().any(|m| base == *m || base.starts_with(m)) {
            // Column 4 (index 4) is "Mem Usage" like "123,456 K".
            let mem = cols.get(4).map(|c| c.trim().trim_matches('"'));
            let kb: u64 = mem
                .and_then(|m| m.strip_suffix(" K"))
                .map(|n| n.replace(',', ""))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            return (Some(base.to_string()), Some(kb * 1024));
        }
    }
    (None, None)
}

pub fn sys_resources() -> SysResources {
    let cpu_percent = cpu_load_percent();
    let (mem_total_bytes, mem_used_bytes) = memory_bytes();
    let (model_process, model_mem_bytes) = detect_model_process();
    SysResources {
        cpu_percent,
        mem_total_bytes,
        mem_used_bytes,
        model_process,
        model_mem_bytes,
    }
}
