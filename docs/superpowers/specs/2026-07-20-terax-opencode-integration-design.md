# Terax OpenCode Integration Design

Date: 2026-07-20
Status: Design

## Overview

Integrate OpenCode as a first-class agent in Terax, add a lightweight system resource monitor for local AI models, and introduce a configurable default launch command (harness) for new terminal tabs. Keeps everything small and low-key, following Terax's existing patterns.

## 1. OpenCode Agent Detection & Notifications

### Rust side

**agent_detect.rs** — add `"opencode"` to `DEFAULT_AGENTS`. This enables basic start/exit detection via OSC 133 C/D markers (the command-ran marker): when a user runs `opencode` in a terminal, the agent detector arms; when the command finishes, it disarms.

**agent.rs** — add an `AgentSpec` for opencode. Uses the same pattern as Pi: a custom plugin file written to OpenCode's plugin directory, not a hooks.json config.

- Agent name: `"opencode"`
- Config dir: `~/.config/opencode/plugins/`
- File: `terax-notify.ts`
- Events: `session.created` -> `working`, `session.idle` -> `attention`, `session.deleted` -> `finished`
- Delivery: `Osc` (writes OSC 777 marker to the terminal)
- matcher: false

The plugin script subscribes to OpenCode's event system (`session.created`, `session.idle`, `session.deleted`) and writes `\x1b]777;notify;Terax;opencode;<event>\x07` to stderr when the event fires. This mirrors the Pi extension pattern exactly — an idiomatic approach for agents that use a plugin/extensions system rather than JSON hook files.

The `agent_enable_hooks("opencode")` command writes the plugin to disk. `agent_hooks_status("opencode")` checks for the marker string in the plugin file. The logic follows the existing `enable_pi_extension` path (create dirs, atomic write, idempotent check).

### Frontend

No changes needed. The existing `routeAgentNotification` system handles 4-field OSC 777 markers (`notify;Terax;opencode;attention`) generically — the agent name is just a string that flows through toasts and OS notifications. The NotificationBell and agent store already work with any agent name.

### Files changed

- `src-tauri/src/modules/pty/agent_detect.rs` — add "opencode" to DEFAULT_AGENTS
- `src-tauri/src/modules/agent.rs` — add AgentSpec for opencode + plugin constant + tests

## 2. CPU/RAM System Monitor

### Rust side

New module `src-tauri/src/modules/sys/`. Implements a `sys_resources` Tauri command that returns current CPU and memory usage, plus detected local model processes.

**Implementation:** Uses OS-specific lightweight calls (no `sysinfo` crate dependency):

- **macOS**: `libc::host_statistics` for memory pages, `/proc` equivalent via `sysctl` for CPU load averages and per-process info
- **Linux**: reads `/proc/stat` (CPU), `/proc/meminfo` (memory), scans `/proc/<pid>/` for model processes
- **Windows**: uses existing `windows-sys` dependency with `GetSystemTimes` and `GlobalMemoryStatusEx`, scans processes via `CreateToolhelp32Snapshot`

**Process detection:** Scans for known local model binaries: `ollama`, `lmstudio`, `mlx_server`, `llama-server`, `llama.cpp`-family processes. When found, returns their per-process CPU% and RSS memory.

**Return type:**
```rust
struct SysResources {
    cpu_usage: f64,           // 0.0 - 100.0, overall system CPU
    memory: MemoryInfo {
        used: u64,            // bytes
        total: u64,           // bytes
    },
    model_process: Option<ModelProcessInfo> {
        name: String,
        cpu: f64,
        memory_mb: u64,
    },
}
```

### Frontend side

New module `src/modules/sys/`:

- **`lib/useSysResources.ts`** — calls `invoke("sys_resources")` every 3s via `setInterval`. Pauses polling when the window is hidden (uses `document.visibilityState`). Stores the latest result in a ref + triggers re-renders only on meaningful changes (usage crosses a 5% threshold or model process appears/disappears).

- **`components/SysStatusPill.tsx`** — compact status bar pill:
  - Baseline state (no model process): shows CPU usage as a subtle dimmed pill, e.g., `32%`. Color-coded: green <50%, yellow 50-80%, red >80%.
  - Active state (model process running): same CPU plus model RAM, e.g., `32% · Ollama 2.1 GB`. Highlighted with a more visible color. Click opens a tiny popover with breakdown (system CPU, system RAM used/total, model process details).
  - Uses the same Sonner/theming approach as other status bar elements.

- Wired into the existing status bar in `src/modules/statusbar/StatusBar.tsx` alongside CwdBreadcrumb and AI indicator.

### Files changed

- `src-tauri/src/modules/sys/mod.rs` — new, ~80 lines (command + platform dispatch)
- `src-tauri/src/modules/sys/macos.rs` — new, platform CPU/memory probes
- `src-tauri/src/modules/sys/linux.rs` — new, platform CPU/memory probes
- `src-tauri/src/modules/sys/windows.rs` — new, platform CPU/memory probes
- `src-tauri/src/lib.rs` — register sys module + command
- `src/modules/sys/lib/useSysResources.ts` — new hook
- `src/modules/sys/components/SysStatusPill.tsx` — new component
- `src/modules/sys/index.ts` — barrel export
- `src/modules/statusbar/StatusBar.tsx` — add SysStatusPill

## 3. Default Launch Command

### Concept

A single user-configurable string in Preferences: when set to a non-empty value, new terminal tabs automatically send that command after shell init completes. This lets users start a terminal already running OpenCode, Claude Code, Codex, or any other CLI tool.

### Settings

**`defaultLaunchCommand: string`** added to `Preferences` in `store.ts`. Default: `""` (no auto-launch, current behavior).

Settings UI in **GeneralSection.tsx**: a single row with:
- A preset dropdown: "None", "OpenCode", "OpenCode --continue", "Claude Code", "Codex"
- A text input below that lets the user type anything custom (the dropdown just fills the input)

Presets are purely for convenience — the stored value is always a raw command string.

### Behavior

When a new PTY session starts and shell init completes (after the OSC integration scripts have run), if `defaultLaunchCommand` is non-empty, the command string is written into the PTY session (same mechanism as sending user input). The user sees the command being typed and executed as if they typed it themselves.

No changes to the new-tab button UI. No quick-pick menu. Just: settings → terminal auto-runs command.

If the user wants a plain terminal, they set it to "None" or empty.

### Files changed

- `src/modules/settings/store.ts` — `defaultLaunchCommand` in Preferences + setter + KEY constant
- `src/settings/sections/GeneralSection.tsx` — add settings row for launch command
- `src/modules/terminal/lib/useTerminalSession.ts` or equivalent PTY init — inject command after shell init

## Files summary

| Area | Files | Type |
|------|-------|------|
| OpenCode detection | `agent_detect.rs`, `agent.rs` | Rust (~45 lines) |
| System resources | `sys/mod.rs`, `sys/macos.rs`, `sys/linux.rs`, `sys/windows.rs`, `lib.rs` | Rust (~200 lines) |
| System resources UI | `useSysResources.ts`, `SysStatusPill.tsx`, `index.ts`, `StatusBar.tsx` | Frontend (~120 lines) |
| Launch command | `store.ts`, `GeneralSection.tsx`, terminal init code | Frontend (~40 lines) |

~15 files, ~400 lines total.
