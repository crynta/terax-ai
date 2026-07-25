//! macOS system resource probes via Mach `host_statistics`.

#![allow(deprecated)] // libc::mach_host_self is flagged; mach2 isn't a dep.

use std::sync::Mutex;

use libc::{
    self, c_void, host_cpu_load_info, host_flavor_t, host_info_t, host_info64_t, host_statistics,
    host_statistics64, mach_host_self, mach_msg_type_number_t, natural_t, sysctlbyname,
    vm_statistics64, CPU_STATE_IDLE, CPU_STATE_MAX, HOST_CPU_LOAD_INFO, HOST_VM_INFO64,
};

use crate::modules::sys::SysResources;

/// Process names we treat as "local AI model" runtimes. Best-effort: if one of
/// these is running we surface its RAM usage in the status pill.
const MODEL_PROCESS_NAMES: &[&str] = &[
    "ollama",
    "llama-server",
    "llama",
    "lmstudio",
    "exo",
    "vllm",
    "oobabooga",
];

/// Previous CPU tick counts, kept across calls to compute a utilization delta.
static PREV_TICKS: Mutex<Option<[u32; CPU_STATE_MAX as usize]>> = Mutex::new(None);

fn sysctl_u64(name: &[u8]) -> u64 {
    let mut value: u64 = 0;
    let mut len = std::mem::size_of::<u64>() as libc::size_t;
    unsafe {
        if sysctlbyname(
            name.as_ptr() as *const libc::c_char,
            &mut value as *mut u64 as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            return value;
        }
    }
    0
}

fn page_size() -> u64 {
    let mut value: u32 = 0;
    let mut len = std::mem::size_of::<u32>() as libc::size_t;
    unsafe {
        if sysctlbyname(
            b"hw.pagesize\0".as_ptr() as *const libc::c_char,
            &mut value as *mut u32 as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            return value as u64;
        }
    }
    4096
}

fn cpu_load_percent() -> f32 {
    let mut info = host_cpu_load_info {
        cpu_ticks: [0; CPU_STATE_MAX as usize],
    };
    let mut count =
        (std::mem::size_of::<host_cpu_load_info>() / std::mem::size_of::<natural_t>())
            as mach_msg_type_number_t;
    let ret = unsafe {
        host_statistics(
            mach_host_self(),
            HOST_CPU_LOAD_INFO as host_flavor_t,
            &mut info as *mut host_cpu_load_info as host_info_t,
            &mut count,
        )
    };
    if ret != 0 {
        return 0.0;
    }

    let cur = info.cpu_ticks;
    let mut prev = PREV_TICKS.lock().unwrap();
    let percent = match *prev {
        Some(p) => {
            let mut total_delta: u64 = 0;
            let mut busy_delta: u64 = 0;
            for i in 0..CPU_STATE_MAX as usize {
                let d = cur[i].saturating_sub(p[i]) as u64;
                total_delta += d;
                if i != CPU_STATE_IDLE as usize {
                    busy_delta += d;
                }
            }
            if total_delta == 0 {
                0.0
            } else {
                (busy_delta as f32 / total_delta as f32) * 100.0
            }
        }
        None => 0.0,
    };
    *prev = Some(cur);
    percent
}

fn memory_bytes() -> (u64, u64) {
    let total = sysctl_u64(b"hw.memsize\0");
    let pages = page_size();

    let mut info: vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count =
        (std::mem::size_of::<vm_statistics64>() / std::mem::size_of::<natural_t>())
            as mach_msg_type_number_t;
    let ret = unsafe {
        host_statistics64(
            mach_host_self(),
            HOST_VM_INFO64 as host_flavor_t,
            &mut info as *mut vm_statistics64 as host_info64_t,
            &mut count,
        )
    };
    if ret != 0 {
        return (total, 0);
    }

    // Match Activity Monitor: "Memory Used" = Active + Wired + Compressed - Purgeable.
    // This excludes inactive/file-cache pages (reclaimable) and truly free pages.
    //   - active_count  includes pages currently mapped by processes
    //   - wire_count    includes pages pinned by the kernel (can't be paged)
    //   - compressor_page_count includes pages compressed in memory
    //   - purgeable_count is a subset of active that processes have marked as discardable
    let active = info.active_count as u64;
    let wired = info.wire_count as u64;
    let compressed = info.compressor_page_count as u64;
    let purgeable = info.purgeable_count as u64;

    let used = active.saturating_add(wired)
        .saturating_add(compressed)
        .saturating_sub(purgeable)
        .saturating_mul(pages);
    (total, used)
}

/// Best-effort scan for a running local-model process. Uses `ps` (cheap, no
/// extra dependency) and returns the first match's name + resident set size.
fn detect_model_process() -> (Option<String>, Option<u64>) {
    use std::process::Command;

    let output = Command::new("ps")
        .args(["-eo", "comm,rss"])
        .output()
        .ok();
    let Some(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines().skip(1) {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
        if MODEL_PROCESS_NAMES.iter().any(|m| base == *m || base.starts_with(m)) {
            let rss_kb: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            return (Some(base.to_string()), Some(rss_kb * 1024));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_sane_memory_numbers() {
        let (total, used) = memory_bytes();
        assert!(total > 0, "total memory should be positive");
        assert!(used <= total, "used must not exceed total");
    }

    #[test]
    fn cpu_percent_is_in_range() {
        // Two calls so the delta path is exercised.
        let a = cpu_load_percent();
        let b = cpu_load_percent();
        for v in [a, b] {
            assert!((0.0..=100.0).contains(&v), "cpu {v} out of range");
        }
    }

    #[test]
    fn model_names_match_expected_prefixes() {
        // Sanity check the detection predicate against known names.
        for name in ["ollama", "llama-server", "lmstudio"] {
            assert!(MODEL_PROCESS_NAMES
                .iter()
                .any(|m| name == *m || name.starts_with(m)));
        }
    }
}
