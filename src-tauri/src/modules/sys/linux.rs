//! Linux system resource probes via `/proc`.

use std::sync::Mutex;

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

/// Previous cumulative CPU times, kept across calls to compute a delta.
static PREV_CPU: Mutex<Option<(u64, u64)>> = Mutex::new(None);

fn read_file(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn cpu_load_percent() -> f32 {
    let stat = read_file("/proc/stat")?;
    let line = stat.lines().find(|l| l.starts_with("cpu "))?;
    let times: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|v| v.parse().ok())
        .collect();
    if times.len() < 4 {
        return 0.0;
    }
    let idle = times[3] + times.get(4).copied().unwrap_or(0); // idle + iowait
    let total: u64 = times.iter().sum();

    let mut prev = PREV_CPU.lock().unwrap();
    let percent = match *prev {
        Some((p_total, p_idle)) => {
            let total_d = total.saturating_sub(p_total);
            let idle_d = idle.saturating_sub(p_idle);
            if total_d == 0 {
                0.0
            } else {
                ((total_d - idle_d) as f32 / total_d as f32) * 100.0
            }
        }
        None => 0.0,
    };
    *prev = Some((total, idle));
    percent
}

fn memory_bytes() -> (u64, u64) {
    let info = read_file("/proc/meminfo").unwrap_or_default();
    let mut total_kb = 0u64;
    let mut available_kb = 0u64;
    for line in info.lines() {
        if let Some(v) = line.strip_prefix("MemTotal:") {
            total_kb = v.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("MemAvailable:") {
            available_kb = v.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        }
    }
    let total = total_kb * 1024;
    let used = total.saturating_sub(available_kb * 1024);
    (total, used)
}

/// Best-effort scan of `/proc/*/comm` for a known local-model process.
fn detect_model_process() -> (Option<String>, Option<u64>) {
    let proc_dir = match std::fs::read_dir("/proc") {
        Ok(d) => d,
        Err(_) => return (None, None),
    };
    for entry in proc_dir.flatten() {
        let pid = entry.file_name();
        let pid = pid.to_string_lossy();
        if !pid.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let comm = match read_file(&format!("{}/comm", entry.path().display())) {
            Some(c) => c,
            None => continue,
        };
        let name = comm.trim();
        if MODEL_PROCESS_NAMES.iter().any(|m| name == *m || name.starts_with(m)) {
            let rss = read_file(&format!("{}/status", entry.path().display()))
                .and_then(|s| {
                    s.lines()
                        .find(|l| l.starts_with("VmRSS:"))
                        .and_then(|l| l.split_whitespace().nth(1))
                        .and_then(|v| v.parse::<u64>().ok())
                });
            return (Some(name.to_string()), rss.map(|kb| kb * 1024));
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
    fn cpu_percent_is_in_range() {
        let a = cpu_load_percent();
        let b = cpu_load_percent();
        for v in [a, b] {
            assert!((0.0..=100.0).contains(&v), "cpu {v} out of range");
        }
    }

    #[test]
    fn memory_numbers_are_sane() {
        let (total, used) = memory_bytes();
        // On a system without /proc (non-Linux test host) these are 0; only
        // assert the invariant when data is present.
        if total > 0 {
            assert!(used <= total);
        }
    }
}
