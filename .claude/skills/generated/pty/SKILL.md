---
name: pty
description: "Skill for the Pty area of terax-ai. 90 symbols across 14 files."
---

# Pty

90 symbols | 14 files | Cohesion: 83%

## When to Use

- Working with code in `src-tauri/`
- Understanding how new, finish, new work
- Modifying pty-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/src/modules/pty/shell_init.rs` | bashrc_script, fish_init_script, prepare_wsl_integration_dir, normalize_script, prepare_wsl_bash_rcfile (+24) |
| `src-tauri/src/modules/pty/agent_detect.rs` | new, finish, run, osc, arms_on_agent_command (+14) |
| `src-tauri/src/modules/pty/da_filter.rs` | new, run, da1_bare, da1_with_zero_param, da2_secondary (+12) |
| `src-tauri/src/modules/pty/session.rs` | new, disarm, spawn, drop_kills_child_process, drop_session_succeeds_after_child_already_exited (+1) |
| `src-tauri/src/modules/workspace.rs` | wsl_drvfs_to_windows, wsl_path_to_unc, wsl_path_to_host, wsl_path_to_unc_blocks_traversal_distro, wsl_path_to_unc_accepts_valid_distro |
| `src-tauri/src/modules/pty/job.rs` | create_for, create_for_invalid_pid_errors, drop_kills_assigned_process_tree |
| `src-tauri/src/modules/pty/mod.rs` | pty_close, pty_close_all, pty_resize |
| `src/modules/terminal/lib/useTerminalSession.ts` | markSessionReady, cwd |
| `src/modules/statusbar/CwdBreadcrumb.tsx` | load |
| `src-tauri/src/modules/shell/background.rs` | kill |

## Entry Points

Start here when exploring this area:

- **`new`** (Function) — `src-tauri/src/modules/pty/agent_detect.rs:65`
- **`finish`** (Function) — `src-tauri/src/modules/pty/agent_detect.rs:134`
- **`new`** (Function) — `src-tauri/src/modules/pty/da_filter.rs:24`
- **`wsl_path_to_unc`** (Function) — `src-tauri/src/modules/workspace.rs:297`
- **`wsl_path_to_host`** (Function) — `src-tauri/src/modules/workspace.rs:321`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `new` | Function | `src-tauri/src/modules/pty/agent_detect.rs` | 65 |
| `finish` | Function | `src-tauri/src/modules/pty/agent_detect.rs` | 134 |
| `new` | Function | `src-tauri/src/modules/pty/da_filter.rs` | 24 |
| `wsl_path_to_unc` | Function | `src-tauri/src/modules/workspace.rs` | 297 |
| `wsl_path_to_host` | Function | `src-tauri/src/modules/workspace.rs` | 321 |
| `into_signal` | Function | `src-tauri/src/modules/pty/agent_detect.rs` | 43 |
| `process` | Function | `src-tauri/src/modules/pty/agent_detect.rs` | 82 |
| `process` | Function | `src-tauri/src/modules/pty/da_filter.rs` | 31 |
| `spawn` | Function | `src-tauri/src/modules/pty/session.rs` | 98 |
| `create_for` | Function | `src-tauri/src/modules/pty/job.rs` | 25 |
| `pty_close` | Function | `src-tauri/src/modules/pty/mod.rs` | 133 |
| `pty_close_all` | Function | `src-tauri/src/modules/pty/mod.rs` | 220 |
| `drop_session` | Function | `src-tauri/src/modules/pty/session.rs` | 69 |
| `kill` | Function | `src-tauri/src/modules/shell/background.rs` | 63 |
| `shell_bg_kill` | Function | `src-tauri/src/modules/shell/mod.rs` | 265 |
| `build_command` | Function | `src-tauri/src/modules/pty/shell_init.rs` | 49 |
| `detect` | Function | `src-tauri/src/modules/pty/shell_init.rs` | 128 |
| `build` | Function | `src-tauri/src/modules/pty/shell_init.rs` | 160 |
| `env` | Function | `src/modules/statusbar/WorkspaceEnvSelector.tsx` | 23 |
| `pty_resize` | Function | `src-tauri/src/modules/pty/mod.rs` | 99 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Spawn → Env` | cross_community | 6 |
| `Spawn → MarkSessionReady` | cross_community | 6 |
| `Fs_watch_add → Is_safe_distro_name` | cross_community | 6 |
| `Git_panel_snapshot → Wsl_drvfs_to_windows` | cross_community | 6 |
| `Git_panel_snapshot → Env` | cross_community | 6 |
| `Git_remote_url → Env` | cross_community | 6 |
| `Spawn → Launch_cwd_snapshot` | cross_community | 5 |
| `Spawn → Is_safe_distro_name` | cross_community | 5 |
| `Fs_write_file → Is_safe_distro_name` | cross_community | 5 |
| `Fs_canonicalize → Is_safe_distro_name` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Modules | 5 calls |
| Git | 2 calls |
| Shell | 1 calls |
| Workspace | 1 calls |

## How to Explore

1. `gitnexus_context({name: "new"})` — see callers and callees
2. `gitnexus_query({query: "pty"})` — find related execution flows
3. Read key files listed above for implementation details
