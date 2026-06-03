---
name: shell
description: "Skill for the Shell area of terax-ai. 39 symbols across 9 files."
---

# Shell

39 symbols | 9 files | Cohesion: 81%

## When to Use

- Working with code in `src-tauri/`
- Understanding how new, decorations, visible work
- Modifying shell-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/src/modules/shell/mod.rs` | shell_run_command, run_blocking_inner, run_blocking, drain, run (+8) |
| `src-tauri/src/modules/shell/session.rs` | new, wrap_posix_with_sentinel, wrap_with_sentinel, strip_cwd_sentinel, sentinels_are_unique_per_session (+3) |
| `src-tauri/src/modules/shell/ringbuffer.rs` | new, read_from, read_from_returns_all_when_within_cap, read_from_skips_consumed_prefix, read_from_handles_wraparound (+2) |
| `src-tauri/src/modules/shell/background.rs` | spawn, read_logs, info |
| `src-tauri/tests/shell_background.rs` | spawn_captures_stdout_and_exits_zero, read_logs_advances_offset, info_reflects_command_and_exit |
| `src-tauri/src/modules/pty/shell_init.rs` | windows_shell_path, which_in_path |
| `src-tauri/src/lib.rs` | open_settings_window |
| `src/modules/editor/lib/colorSwatches.ts` | decorations |
| `src/modules/ai/components/LocalAgentNotificationsBridge.tsx` | visible |

## Entry Points

Start here when exploring this area:

- **`new`** (Function) — `src-tauri/src/modules/shell/session.rs:47`
- **`decorations`** (Function) — `src/modules/editor/lib/colorSwatches.ts:118`
- **`visible`** (Function) — `src/modules/ai/components/LocalAgentNotificationsBridge.tsx:29`
- **`shell_run_command`** (Function) — `src-tauri/src/modules/shell/mod.rs:41`
- **`run_blocking_inner`** (Function) — `src-tauri/src/modules/shell/mod.rs:77`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `new` | Function | `src-tauri/src/modules/shell/session.rs` | 47 |
| `decorations` | Function | `src/modules/editor/lib/colorSwatches.ts` | 118 |
| `visible` | Function | `src/modules/ai/components/LocalAgentNotificationsBridge.tsx` | 29 |
| `shell_run_command` | Function | `src-tauri/src/modules/shell/mod.rs` | 41 |
| `run_blocking_inner` | Function | `src-tauri/src/modules/shell/mod.rs` | 77 |
| `new` | Function | `src-tauri/src/modules/shell/ringbuffer.rs` | 19 |
| `read_from` | Function | `src-tauri/src/modules/shell/ringbuffer.rs` | 50 |
| `windows_shell_path` | Function | `src-tauri/src/modules/pty/shell_init.rs` | 727 |
| `spawn` | Function | `src-tauri/src/modules/shell/background.rs` | 91 |
| `build_oneshot_command` | Function | `src-tauri/src/modules/shell/mod.rs` | 283 |
| `read_logs` | Function | `src-tauri/src/modules/shell/background.rs` | 46 |
| `shell_bg_logs` | Function | `src-tauri/src/modules/shell/mod.rs` | 249 |
| `info` | Function | `src-tauri/src/modules/shell/background.rs` | 67 |
| `shell_bg_list` | Function | `src-tauri/src/modules/shell/mod.rs` | 273 |
| `open_settings_window` | Function | `src-tauri/src/lib.rs` | 35 |
| `wrap_posix_with_sentinel` | Function | `src-tauri/src/modules/shell/session.rs` | 122 |
| `wrap_with_sentinel` | Function | `src-tauri/src/modules/shell/session.rs` | 128 |
| `strip_cwd_sentinel` | Function | `src-tauri/src/modules/shell/session.rs` | 144 |
| `sentinels_are_unique_per_session` | Function | `src-tauri/src/modules/shell/session.rs` | 160 |
| `strip_uses_session_sentinel_only` | Function | `src-tauri/src/modules/shell/session.rs` | 170 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Spawn → Is_safe_distro_name` | cross_community | 5 |
| `Shell_run_command → Is_safe_distro_name` | cross_community | 5 |
| `Shell_run_command → Which_in_path` | cross_community | 5 |
| `Spawn → Wsl_drvfs_to_windows` | cross_community | 4 |
| `Spawn → Which_in_path` | intra_community | 4 |
| `Shell_run_command → CurrentWorkspaceEnv` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Modules | 3 calls |
| Fs | 2 calls |
| Pty | 2 calls |
| Git | 2 calls |
| Tests | 1 calls |

## How to Explore

1. `gitnexus_context({name: "new"})` — see callers and callees
2. `gitnexus_query({query: "shell"})` — find related execution flows
3. Read key files listed above for implementation details
