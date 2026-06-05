---
name: modules
description: "Skill for the Modules area of terax-ai. 90 symbols across 16 files."
---

# Modules

90 symbols | 16 files | Cohesion: 75%

## When to Use

- Working with code in `src-tauri/`
- Understanding how run, fs_canonicalize, shell_bg_spawn work
- Modifying modules-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/src/modules/workspace.rs` | authorize, authorize_spawn_cwd, bootstrap_registry, tempdir, authorize_spawn_cwd_accepts_authorized_path (+27) |
| `src-tauri/src/modules/secrets.rs` | key, store_path, read_store, write_store, with_store (+12) |
| `src-tauri/src/modules/agent.rs` | is_ours, is_empty_group, merge_hooks, adds_all_event_hooks_to_empty_config, is_idempotent (+8) |
| `src-tauri/src/modules/net.rs` | is_blocked_host_name, ip_kind, resolve_and_classify, validate_url, classify_and_collect_safe_ips (+7) |
| `src-tauri/tests/git_operations.rs` | resolve_repo_returns_none_outside_repo, panel_snapshot_outside_repo_is_empty, unauthorized_path_is_rejected |
| `src-tauri/src/lib.rs` | parse_launch_dir, run |
| `src-tauri/src/modules/shell/mod.rs` | shell_bg_spawn, shell_session_open |
| `src-tauri/src/modules/fs/file.rs` | fs_canonicalize |
| `src/modules/ai/lib/native.ts` | canonicalize |
| `src/modules/ai/components/AgentSwitcher.tsx` | custom |

## Entry Points

Start here when exploring this area:

- **`run`** (Function) — `src-tauri/src/lib.rs:113`
- **`fs_canonicalize`** (Function) — `src-tauri/src/modules/fs/file.rs:131`
- **`shell_bg_spawn`** (Function) — `src-tauri/src/modules/shell/mod.rs:233`
- **`authorize`** (Function) — `src-tauri/src/modules/workspace.rs:24`
- **`authorize_spawn_cwd`** (Function) — `src-tauri/src/modules/workspace.rs:73`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `run` | Function | `src-tauri/src/lib.rs` | 113 |
| `fs_canonicalize` | Function | `src-tauri/src/modules/fs/file.rs` | 131 |
| `shell_bg_spawn` | Function | `src-tauri/src/modules/shell/mod.rs` | 233 |
| `authorize` | Function | `src-tauri/src/modules/workspace.rs` | 24 |
| `authorize_spawn_cwd` | Function | `src-tauri/src/modules/workspace.rs` | 73 |
| `bootstrap_registry` | Function | `src-tauri/src/modules/workspace.rs` | 116 |
| `canonicalize` | Function | `src/modules/ai/lib/native.ts` | 143 |
| `lm_ping` | Function | `src-tauri/src/modules/net.rs` | 191 |
| `ai_http_request` | Function | `src-tauri/src/modules/net.rs` | 312 |
| `ai_http_stream` | Function | `src-tauri/src/modules/net.rs` | 359 |
| `custom` | Function | `src/modules/ai/components/AgentSwitcher.tsx` | 45 |
| `key` | Function | `src-tauri/src/modules/secrets.rs` | 41 |
| `secrets_get` | Function | `src-tauri/src/modules/secrets.rs` | 115 |
| `secrets_set` | Function | `src-tauri/src/modules/secrets.rs` | 140 |
| `secrets_delete` | Function | `src-tauri/src/modules/secrets.rs` | 168 |
| `secrets_get_all` | Function | `src-tauri/src/modules/secrets.rs` | 279 |
| `workspace_current_dir` | Function | `src-tauri/src/modules/workspace.rs` | 136 |
| `init_launch_cwd` | Function | `src-tauri/src/modules/workspace.rs` | 148 |
| `launch_cwd_snapshot` | Function | `src-tauri/src/modules/workspace.rs` | 162 |
| `hide_console` | Function | `src-tauri/src/modules/proc.rs` | 3 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → CurrentWorkspaceEnv` | cross_community | 7 |
| `Shell_session_open → Is_safe_distro_name` | cross_community | 6 |
| `Shell_session_open → Looks_utf16le` | cross_community | 6 |
| `Git_remote_url → Hide_console` | cross_community | 6 |
| `Spawn → Launch_cwd_snapshot` | cross_community | 5 |
| `Shell_session_open → Hide_console` | cross_community | 5 |
| `Fs_canonicalize → Is_safe_distro_name` | cross_community | 5 |
| `Commit_file_diff → Hide_console` | cross_community | 5 |
| `Git_diff_content → CurrentWorkspaceEnv` | cross_community | 5 |
| `Commit_files → Hide_console` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Fs | 8 calls |
| Git | 8 calls |
| Shell | 5 calls |
| Tests | 3 calls |
| Autocomplete | 1 calls |
| Workspace | 1 calls |

## How to Explore

1. `gitnexus_context({name: "run"})` — see callers and callees
2. `gitnexus_query({query: "modules"})` — find related execution flows
3. Read key files listed above for implementation details
