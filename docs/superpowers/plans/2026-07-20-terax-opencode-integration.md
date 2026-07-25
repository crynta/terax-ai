# OpenCode Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate OpenCode as a first-class agent in Terax, add lightweight CPU/RAM monitoring for local AI models, and add a configurable default launch command for new terminal tabs.

**Architecture:** Three independent additions to the existing codebase: (1) add "opencode" to the agent detection byte-filter and write an OpenCode TypeScript plugin (matching the Pi extension pattern), (2) new `sys` Rust module with platform-specific probes for CPU/memory, (3) a `defaultLaunchCommand` preference injected after PTY session init.

**Tech Stack:** Rust (Tauri command + OS-specific syscalls), TypeScript/React (zustand store + status bar component), OpenCode plugin API.

## Global Constraints

- No new crate dependencies if possible (use OS-native calls or existing deps like `windows-sys` and `libc`)
- Follow existing patterns: Pi extension for OpenCode plugin, existing agent detector for agent list, existing store/setter pattern for preferences
- No em-dashes, no emojis, no comments unless explaining *why*
- Frontend imports always use `@/...` path alias

---

### Task 1: Add OpenCode to Agent Detection

**Files:**
- Modify: `src-tauri/src/modules/pty/agent_detect.rs:8`
- Modify: `src-tauri/src/modules/pty/agent_detect.rs` (add tests)

**Interfaces:**
- Consumes: `DEFAULT_AGENTS` slice in `AgentDetector::new()`
- Produces: `"opencode"` recognized as a valid agent name in OSC 133 C/D marker parsing

- [ ] **Step 1: Add "opencode" to the default agent list**

In `agent_detect.rs`, change line 8 from:
```rust
const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "gemini", "pi"];
```
to:
```rust
const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "gemini", "opencode", "pi"];
```

- [ ] **Step 2: Update tests**

In `agent_detect.rs`, add a test case to verify opencode detection:
```rust
#[test]
fn detects_opencode_command() {
    let mut d = AgentDetector::new();
    assert_eq!(
        run(&mut d, &osc("133;C;opencode --model fast")),
        vec![started("opencode")]
    );
}

#[test]
fn opencode_four_field_marker_self_arms() {
    let mut d = AgentDetector::new();
    assert_eq!(
        run(&mut d, &osc("777;notify;Terax;opencode;working")),
        vec![started("opencode")]
    );
}

#[test]
fn opencode_marker_drives_status() {
    let mut d = AgentDetector::new();
    run(&mut d, &osc("133;C;opencode"));
    assert_eq!(
        run(&mut d, &osc("777;notify;Terax;opencode;attention")),
        vec![Transition::Attention]
    );
    assert_eq!(
        run(&mut d, &osc("777;notify;Terax;opencode;working")),
        vec![Transition::Working]
    );
    assert_eq!(
        run(&mut d, &osc("777;notify;Terax;opencode;finished")),
        vec![Transition::Finished]
    );
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd src-tauri && cargo test --locked agent_detect`
Expected: all tests pass, including the new opencode tests

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/pty/agent_detect.rs
git commit -m "feat: add opencode to agent detection"
```

---

### Task 2: OpenCode Notification Plugin (Hook Installation)

**Files:**
- Modify: `src-tauri/src/modules/agent.rs`
- Test: existing test block at bottom of `agent.rs`

**Interfaces:**
- Produces: `agent_enable_hooks("opencode")` writes plugin to `~/.config/opencode/plugins/terax-notify.ts`
- Produces: `agent_hooks_status("opencode")` returns true when plugin is installed
- Consumes: same patterns as `pi` extension (dir create, atomic write, idempotent check)

- [ ] **Step 1: Add the plugin constant and directory constant**

Below `PI_EXTENSION`, add the OpenCode plugin constant:

```rust
const OPENCODE_PLUGIN_DIR: &str = ".config/opencode/plugins";
const OPENCODE_PLUGIN_FILE: &str = "terax-notify.ts";
const OPENCODE_PLUGIN_MARKER: &str = "terax-opencode-notifications-v1";
const OPENCODE_STATUS_NEEDLES: [&str; 5] = [
    OPENCODE_PLUGIN_MARKER,
    "session.created",
    "session.idle",
    "session.deleted",
    "notify;Terax;opencode",
];

const OPENCODE_PLUGIN: &str = r#"// terax-opencode-notifications-v1
export default {
  event: async ({ event }) => {
    if (event.type === "session.created") {
      process.stdout.write("\u001b]777;notify;Terax;opencode;working\u0007");
    }
    if (event.type === "session.idle") {
      process.stdout.write("\u001b]777;notify;Terax;opencode;attention\u0007");
    }
    if (event.type === "session.deleted") {
      process.stdout.write("\u001b]777;notify;Terax;opencode;finished\u0007");
    }
  },
};
"#;
```

- [ ] **Step 2: Update `agent_enable_hooks` and `agent_hooks_status` for opencode**

Add an `"opencode"` arm to `agent_enable_hooks` (after the `pi` arm):

```rust
if agent == "opencode" {
    return enable_opencode_plugin();
}
```

Add the helper functions (modeled on `enable_pi_extension`):

```rust
fn opencode_plugin_path() -> Result<std::path::PathBuf, String> {
    home_path(OPENCODE_PLUGIN_DIR, OPENCODE_PLUGIN_FILE)
}
```

Where `OPENCODE_PLUGIN_DIR` is a const — actually, we should reuse `AgentSpec.dir` + `AgentSpec.file` to avoid duplicating the path. But the existing `enable_pi_extension` doesn't use AgentSpec either (Pi isn't in the AGENTS list). Keep it parallel.

Better approach: handle `opencode` the same way as `pi` — a dedicated arm in `agent_enable_hooks` and `agent_hooks_status`, separate from the AGENTS list which handles Claude/Codex/Gemini.

In `agent_enable_hooks`:
```rust
if agent == "pi" {
    return enable_pi_extension();
}
if agent == "opencode" {
    return enable_opencode_plugin();
}
```

In `agent_hooks_status`:
```rust
if agent == "pi" {
    return /* existing pi check */;
}
if agent == "opencode" {
    return opencode_plugin_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|content| {
            OPENCODE_STATUS_NEEDLES
                .iter()
                .all(|needle| content.contains(needle))
        });
}
```

Add `enable_opencode_plugin_at`:
```rust
fn enable_opencode_plugin_at(path: &std::path::Path) -> Result<(), String> {
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let existing = match std::fs::read_to_string(path) {
        Ok(s) if s == OPENCODE_PLUGIN => return Ok(()),
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };
    let contents = opencode_plugin_contents(existing.as_deref(), path)?;
    write_atomic(&opencode_plugin_write_path(path)?, contents)
}

fn enable_opencode_plugin() -> Result<(), String> {
    enable_opencode_plugin_at(&opencode_plugin_path()?)
}

fn opencode_plugin_contents(
    existing: Option<&str>,
    path: &std::path::Path,
) -> Result<&'static str, String> {
    if existing.is_some_and(|s| !s.trim().is_empty() && !s.contains(OPENCODE_PLUGIN_MARKER)) {
        return Err(format!(
            "{} is not managed by Terax; refusing to overwrite",
            path.display()
        ));
    }
    Ok(OPENCODE_PLUGIN)
}

fn opencode_plugin_write_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            std::fs::canonicalize(path).map_err(|e| format!("resolve {}: {e}", path.display()))
        }
        Ok(_) => Ok(path.to_path_buf()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(e) => Err(format!("inspect {}: {e}", path.display())),
    }
}
```

- [ ] **Step 3: Add tests**

Add tests at the bottom of `agent.rs`:

```rust
#[test]
fn opencode_plugin_emits_working_attention_and_finished() {
    for needle in OPENCODE_STATUS_NEEDLES {
        assert!(OPENCODE_PLUGIN.contains(needle), "missing {needle}");
    }
    assert!(OPENCODE_PLUGIN.contains("process.stdout.write"));
}

#[test]
fn opencode_plugin_install_is_atomic_idempotent() {
    let dir = std::env::temp_dir().join(format!("terax-opencode-plugin-{}", std::process::id()));
    let path = dir.join(OPENCODE_PLUGIN_FILE);
    let _ = std::fs::remove_dir_all(&dir);

    enable_opencode_plugin_at(&path).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), OPENCODE_PLUGIN);
    enable_opencode_plugin_at(&path).unwrap();

    std::fs::write(&path, "export const mine = true;").unwrap();
    assert!(enable_opencode_plugin_at(&path).is_err());
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "export const mine = true;"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn opencode_plugin_only_replaces_terax_owned_file() {
    let path = std::path::Path::new("/x/terax-notify.ts");
    assert!(opencode_plugin_contents(Some("export const mine = true;"), &path).is_err());
    assert!(opencode_plugin_contents(Some(OPENCODE_PLUGIN), &path).is_ok());
    assert!(opencode_plugin_contents(Some("  \n"), &path).is_ok());
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --locked agent`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/agent.rs
git commit -m "feat: add opencode notification plugin via agent hooks"
```

---

### Task 3: System Resources Rust Module

**Files:**
- Create: `src-tauri/src/modules/sys/mod.rs`
- Create: `src-tauri/src/modules/sys/macos.rs`
- Create: `src-tauri/src/modules/sys/linux.rs`
- Create: `src-tauri/src/modules/sys/windows.rs`
- Modify: `src-tauri/src/modules/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `sys_resources` Tauri command returning `SysResources { cpu_usage: f64, memory: MemoryInfo, model_process: Option<ModelProcessInfo> }`
- Produces: `SysResources` struct exported from `modules::sys`

- [ ] **Step 1: Create `src-tauri/src/modules/sys/mod.rs`**

Define the shared types and the Tauri command. Platform-specific impls go in platform modules.

```rust
mod macos;
mod linux;
mod windows;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct MemoryInfo {
    pub used: u64,
    pub total: u64,
}

#[derive(Serialize, Clone)]
pub struct ModelProcessInfo {
    pub name: String,
    pub cpu: f64,
    pub memory_mb: u64,
}

#[derive(Serialize, Clone)]
pub struct SysResources {
    pub cpu_usage: f64,
    pub memory: MemoryInfo,
    pub model_process: Option<ModelProcessInfo>,
}

const MODEL_PROCESS_NAMES: &[&str] = &[
    "ollama",
    "lmstudio",
    "mlx_server",
    "llama-server",
    "llama.cpp",
];

#[cfg(target_os = "macos")]
fn platform_resources() -> SysResources {
    macos::probe()
}

#[cfg(target_os = "linux")]
fn platform_resources() -> SysResources {
    linux::probe()
}

#[cfg(target_os = "windows")]
fn platform_resources() -> SysResources {
    windows::probe()
}

#[tauri::command]
pub fn sys_resources() -> SysResources {
    platform_resources()
}
```

- [ ] **Step 2: Create platform implementations**

**`sys/macos.rs`** — uses `libc::host_statistics` for memory and `libc::host_cpu_load_info` for CPU, plus `libproc` or `NSTaskInfo`-equivalent for process scanning:

```rust
use std::process::Command;
use std::time::{Duration, Instant};
use std::sync::Mutex;

use super::*;

// Cache previous CPU ticks to compute delta.
static PREV_CPU: Mutex<Option<CpuSample>> = Mutex::new(None);
static PREV_TIME: Mutex<Option<Instant>> = Mutex::new(None);

struct CpuSample {
    user: u64,
    system: u64,
    idle: u64,
    nice: u64,
}

fn read_cpu_sample() -> Option<CpuSample> {
    // Use libc::host_processor_info for CPU ticks
    let mut count = 0u32;
    let mut info: *mut i32 = std::ptr::null_mut();
    let mut num_info = 0u32;

    let result = unsafe {
        libc::host_processor_info(
            libc::mach_host_self(),
            libc::PROCESSOR_CPU_LOAD_INFO,
            &mut count,
            &mut info,
            &mut num_info,
        )
    };

    if result != libc::KERN_SUCCESS || info.is_null() {
        return None;
    }

    let cpu_info = unsafe {
        std::slice::from_raw_parts(
            info as *const libc::processor_cpu_load_info,
            count as usize,
        )
    };

    let mut user = 0u64;
    let mut system = 0u64;
    let mut idle = 0u64;
    let mut nice = 0u64;

    for cpu in cpu_info {
        user += cpu.cpu_ticks[libc::CPU_STATE_USER] as u64;
        system += cpu.cpu_ticks[libc::CPU_STATE_SYSTEM] as u64;
        idle += cpu.cpu_ticks[libc::CPU_STATE_IDLE] as u64;
        nice += cpu.cpu_ticks[libc::CPU_STATE_NICE] as u64;
    }

    unsafe { libc::vm_deallocate(libc::mach_task_self(), info as libc::vm_address_t, (num_info * 4) as u64) };

    Some(CpuSample { user, system, idle, nice })
}

fn compute_cpu_usage(current: &CpuSample) -> f64 {
    let mut prev = PREV_CPU.lock().unwrap();
    let mut prev_time = PREV_TIME.lock().unwrap();

    let Some(prev_sample) = prev.as_ref() else {
        *prev = Some(CpuSample { user: current.user, system: current.system, idle: current.idle, nice: current.nice });
        *prev_time = Some(Instant::now());
        return 0.0;
    };

    let delta_user = current.user.saturating_sub(prev_sample.user);
    let delta_system = current.system.saturating_sub(prev_sample.system);
    let delta_idle = current.idle.saturating_sub(prev_sample.idle);
    let delta_nice = current.nice.saturating_sub(prev_sample.nice);

    let total = delta_user + delta_system + delta_idle + delta_nice;

    *prev = Some(CpuSample { user: current.user, system: current.system, idle: current.idle, nice: current.nice });
    *prev_time = Some(Instant::now());

    if total == 0 { return 0.0; }
    ((delta_user + delta_system + delta_nice) as f64 / total as f64) * 100.0
}

fn read_memory() -> MemoryInfo {
    unsafe {
        let mut vm_stats = std::mem::zeroed::<libc::vm_statistics64>();
        let mut count = libc::HOST_VM_INFO64_COUNT as u32;
        let result = libc::host_statistics64(
            libc::mach_host_self(),
            libc::HOST_VM_INFO64,
            &mut vm_stats as *mut _ as *mut i32,
            &mut count,
        );

        if result != libc::KERN_SUCCESS {
            return MemoryInfo { used: 0, total: 0 };
        }

        let page_size = libc::vm_page_size;
        let total_pages = vm_stats.active_count + vm_stats.inactive_count
            + vm_stats.wire_count + vm_stats.speculative_count
            + vm_stats.free_count + vm_stats.purgeable_count;
        let total = total_pages as u64 * page_size as u64;
        let used = (vm_stats.active_count + vm_stats.wire_count) as u64 * page_size as u64;
        MemoryInfo { used, total }
    }
}

fn find_model_process() -> Option<ModelProcessInfo> {
    // Use `ps` to find model processes efficiently
    let output = Command::new("ps")
        .args(["axo", "pid,pcpu,rss,comm"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 { continue; }
        let comm = parts[3];
        let basename = comm.rsplit('/').next().unwrap_or(comm);
        if MODEL_PROCESS_NAMES.iter().any(|n| basename.contains(n)) {
            let cpu: f64 = parts[1].parse().unwrap_or(0.0);
            let rss_pages: u64 = parts[2].parse().unwrap_or(0);
            let memory_mb = (rss_pages * 4096) / (1024 * 1024); // ps rss is in pages
            return Some(ModelProcessInfo {
                name: basename.to_string(),
                cpu,
                memory_mb,
            });
        }
    }
    None
}

pub fn probe() -> SysResources {
    let cpu_usage = read_cpu_sample().map(|s| compute_cpu_usage(&s)).unwrap_or(0.0);
    let memory = read_memory();
    let model_process = find_model_process();
    SysResources { cpu_usage, memory, model_process }
}
```

**`sys/linux.rs`** — reads `/proc/stat`, `/proc/meminfo`, scans `/proc/<pid>/status`:

```rust
use std::fs;
use super::*;

pub fn probe() -> SysResources {
    let cpu_usage = read_cpu();
    let memory = read_memory();
    let model_process = find_model_process();
    SysResources { cpu_usage, memory, model_process }
}

fn read_cpu() -> f64 {
    let stat = fs::read_to_string("/proc/stat").ok()?;
    let line = stat.lines().next()?;
    let parts: Vec<u64> = line.split_whitespace().skip(1).filter_map(|s| s.parse().ok()).collect();
    if parts.len() < 4 { return 0.0; }
    let user = parts[0];
    let nice = parts[1];
    let system = parts[2];
    let idle = parts[3];
    let total = user + nice + system + idle;
    let active = user + nice + system;
    if total == 0 { 0.0 } else { active as f64 / total as f64 * 100.0 }
}

fn read_memory() -> MemoryInfo {
    let info = fs::read_to_string("/proc/meminfo").ok()?;
    let total = info.lines()
        .find(|l| l.starts_with("MemTotal:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u64>().ok())
        .map(|kb| kb * 1024)?;
    let available = info.lines()
        .find(|l| l.starts_with("MemAvailable:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u64>().ok())
        .map(|kb| kb * 1024)?;
    MemoryInfo { used: total - available, total }
}
```

**`sys/windows.rs`** — uses `windows-sys` already in Cargo.toml:

```rust
use super::*;

pub fn probe() -> SysResources {
    let cpu_usage = read_cpu();
    let memory = read_memory();
    let model_process = find_model_process();
    SysResources { cpu_usage, memory, model_process }
}
```

(Full Windows impl uses `GetSystemTimes`, `GlobalMemoryStatusEx`, and `CreateToolhelp32Snapshot` via the existing `windows-sys` crate.)

- [ ] **Step 3: Register module in `mod.rs` and `lib.rs`**

In `src-tauri/src/modules/mod.rs`, add:
```rust
pub mod sys;
```

In `src-tauri/src/lib.rs`, add `sys` to the use imports:
```rust
use modules::{agent, fs, git, history, lsp, net, pty, secrets, shell, sys, workspace};
```

And register the command in the `run()` function (look for `.invoke_handler(tauri::generate_handler![...])`):
```rust
modules::sys::sys_resources,
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/sys/ src-tauri/src/modules/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add sys_resources command for CPU/RAM monitoring"
```

---

### Task 4: System Resources Frontend UI

**Files:**
- Create: `src/modules/sys/lib/useSysResources.ts`
- Create: `src/modules/sys/components/SysStatusPill.tsx`
- Create: `src/modules/sys/index.ts`
- Modify: `src/modules/statusbar/StatusBar.tsx`

**Interfaces:**
- Consumes: `invoke("sys_resources")` returning `SysResources`
- Produces: `<SysStatusPill />` component rendered in `StatusBar`

- [ ] **Step 1: Create the polling hook**

`src/modules/sys/lib/useSysResources.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export type SysResources = {
  cpu_usage: number;
  memory: { used: number; total: number };
  model_process: { name: string; cpu: number; memory_mb: number } | null;
};

const POLL_MS = 3000;
const CHANGE_THRESHOLD = 0.05; // 5% change threshold

export function useSysResources(): SysResources | null {
  const [res, setRes] = useState<SysResources | null>(null);
  const lastRef = useRef<SysResources | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    const poll = async () => {
      try {
        const next = await invoke<SysResources>("sys_resources");
        if (cancelled) return;
        const prev = lastRef.current;
        if (
          !prev ||
          hasChanged(prev.cpu_usage, next.cpu_usage) ||
          !!prev.model_process !== !!next.model_process ||
          (prev.model_process && next.model_process &&
            prev.model_process.memory_mb !== next.model_process.memory_mb)
        ) {
          lastRef.current = next;
          setRes(next);
        }
      } catch {
        // silently ignore — polling shouldn't spam console
      }
    };

    void poll();
    timer = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return res;
}

function hasChanged(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b, 1) > CHANGE_THRESHOLD;
}
```

- [ ] **Step 2: Create the status pill component**

`src/modules/sys/components/SysStatusPill.tsx`:
```typescript
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSysResources } from "../lib/useSysResources";

export function SysStatusPill() {
  const res = useSysResources();

  if (!res) return null;

  const cpuColor =
    res.cpu_usage > 80 ? "text-red-500" :
    res.cpu_usage > 50 ? "text-amber-500" :
    "text-muted-foreground";

  const memFraction = res.memory.total > 0
    ? Math.round((res.memory.used / res.memory.total) * 100)
    : 0;

  const memColor =
    memFraction > 80 ? "text-red-500" :
    memFraction > 50 ? "text-amber-500" :
    "text-muted-foreground";

  const hasModel = !!res.model_process;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex shrink-0 cursor-default items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] transition-colors",
            hasModel
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              : "bg-muted/30 text-muted-foreground",
          )}
        >
          <span className={cpuColor}>{Math.round(res.cpu_usage)}%</span>
          <span className="text-muted-foreground/40">|</span>
          <span className={memColor}>{memFraction}%</span>
          {hasModel ? (
            <>
              <span className="text-muted-foreground/40">|</span>
              <span className="font-medium">{res.model_process.name}</span>
              <span className="text-muted-foreground">
                {res.model_process.memory_mb} MB
              </span>
            </>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px] leading-relaxed">
        <div className="flex flex-col gap-1">
          <span>CPU: {res.cpu_usage.toFixed(1)}%</span>
          <span>
            RAM: {(res.memory.used / 1024 / 1024 / 1024).toFixed(1)} GB /{" "}
            {(res.memory.total / 1024 / 1024 / 1024).toFixed(1)} GB
          </span>
          {hasModel ? (
            <span className="text-blue-500">
              {res.model_process.name}: {res.model_process.cpu.toFixed(1)}% CPU,{" "}
              {res.model_process.memory_mb} MB
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 3: Create barrel export**

`src/modules/sys/index.ts`:
```typescript
export { SysStatusPill } from "./components/SysStatusPill";
```

- [ ] **Step 4: Wire into StatusBar**

In `StatusBar.tsx`, add the import:
```typescript
import { SysStatusPill } from "@/modules/sys";
```

Add `<SysStatusPill />` inside the left section of the status bar, after `<DiagnosticsBadge />`:
```typescript
<DiagnosticsBadge filePath={filePath ?? null} />
<SysStatusPill />
```

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm check-types`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/sys/ src/modules/statusbar/StatusBar.tsx
git commit -m "feat: add system resource status pill for CPU/RAM monitoring"
```

---

### Task 5: Default Launch Command Setting

**Files:**
- Modify: `src/modules/settings/store.ts`
- Modify: `src/settings/sections/GeneralSection.tsx`
- Modify: `src/modules/terminal/lib/useTerminalSession.ts`

**Interfaces:**
- Consumes: `defaultLaunchCommand` from `Preferences`
- Produces: command auto-sent to PTY after `s.ready` resolves

- [ ] **Step 1: Add preference to store**

In `store.ts`, add the key constant and default:
```typescript
const KEY_DEFAULT_LAUNCH_COMMAND = "defaultLaunchCommand";
```

In `DEFAULT_PREFERENCES`, add:
```typescript
defaultLaunchCommand: "",
```

In `Preferences` type, add:
```typescript
defaultLaunchCommand: string;
```

In `loadPreferences()`, add:
```typescript
defaultLaunchCommand:
  get<string>(KEY_DEFAULT_LAUNCH_COMMAND) ??
  DEFAULT_PREFERENCES.defaultLaunchCommand,
```

In `onPreferencesChange` map, add:
```typescript
[KEY_DEFAULT_LAUNCH_COMMAND]: "defaultLaunchCommand",
```

Add the setter:
```typescript
export async function setDefaultLaunchCommand(value: string): Promise<void> {
  await writePref(KEY_DEFAULT_LAUNCH_COMMAND, value.trim());
}
```

- [ ] **Step 2: Add settings UI**

In `GeneralSection.tsx`, add the launch command row. Import the setter:
```typescript
import { setDefaultLaunchCommand } from "@/modules/settings/store";
```

Add the `usePreferencesStore` selector:
```typescript
const defaultLaunchCommand = usePreferencesStore((s) => s.defaultLaunchCommand);
```

Add a `SettingRow` after the terminal settings section:
```typescript
<SectionHeader
  title="Launch defaults"
  description="Auto-run a command in new terminals."
/>

<SettingRow
  label="Default launch command"
  description="Leave empty for a plain terminal."
>
  <div className="flex flex-col gap-1.5">
    <div className="flex gap-1.5">
      <select
        className="h-8 rounded-md border border-border/60 bg-card/60 px-2 text-[11.5px] outline-none"
        value=""
        onChange={(e) => {
          if (e.target.value) {
            const input = document.getElementById("launch-command-input") as HTMLInputElement;
            if (input) {
              input.value = e.target.value;
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        }}
      >
        <option value="">Presets...</option>
        <option value="opencode">OpenCode</option>
        <option value="opencode --continue">OpenCode (continue)</option>
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
      </select>
    </div>
    <input
      id="launch-command-input"
      type="text"
      defaultValue={defaultLaunchCommand}
      placeholder="e.g. opencode --model claude-sonnet-4-5"
      className="h-8 w-full rounded-md border border-border/60 bg-card/60 px-2 text-[11.5px] outline-none focus:border-foreground/30"
      onChange={(e) => void setDefaultLaunchCommand(e.target.value)}
    />
  </div>
</SettingRow>
```

- [ ] **Step 3: Wire into terminal session**

In `useTerminalSession.ts`, after the `s.ready` then-block at line ~849, add the launch command injection:

Import the store:
```typescript
import { usePreferencesStore } from "@/modules/settings/preferences";
```

Inside the `s.ready.then(() => {` callback, after `attachSession(...)` and `focusSlot(...)`, add:
```typescript
// Auto-send default launch command if configured.
const launchCmd = usePreferencesStore.getState().defaultLaunchCommand;
if (launchCmd && !s.blocks) {
  writeToSession(leafId, launchCmd + "\n");
}
```

This goes after line 858 (after `focusSlot`), inside the `if (!cancelled && !s.disposed)` block:
```typescript
s.ready.then(() => {
  if (cancelled || s.disposed) return;
  const node = container.current;
  if (!node) return;
  attachSession(leafId, node, {
    onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
    onExit: (c) => cbRef.current.onExit?.(c),
    onCwd: (c) => cbRef.current.onCwd?.(c),
  });
  if (s.visibleNow && s.focusedNow && !s.blocks) focusSlot(leafId);

  const launchCmd = usePreferencesStore.getState().defaultLaunchCommand;
  if (launchCmd && !s.blocks) {
    writeToSession(leafId, launchCmd + "\n");
  }
});
```

- [ ] **Step 4: Run checks**

Run: `pnpm lint && pnpm check-types`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/settings/store.ts src/settings/sections/GeneralSection.tsx src/modules/terminal/lib/useTerminalSession.ts
git commit -m "feat: add default launch command setting for new terminals"
```
