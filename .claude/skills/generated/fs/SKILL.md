---
name: fs
description: "Skill for the Fs area of terax-ai. 34 symbols across 8 files."
---

# Fs

34 symbols | 8 files | Cohesion: 62%

## When to Use

- Working with code in `src-tauri/`
- Understanding how fs_read_file, fs_stat, fs_create_file work
- Modifying fs-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/src/modules/fs/mutate.rs` | fs_create_file, fs_create_dir, fs_rename, fs_delete, s (+5) |
| `src-tauri/src/modules/fs/watch.rs` | remove_paths, fs_watch_remove, collect, is_skipped, ensure_started (+4) |
| `src-tauri/src/modules/fs/file.rs` | fs_read_file, fs_stat, read_file_classifies_utf8_as_text, write_atomic, fs_write_file (+2) |
| `src-tauri/src/modules/workspace.rs` | resolve_path, workspace_authorize, is_wsl |
| `src-tauri/src/modules/fs/mod.rs` | to_canon, strip_verbatim |
| `src-tauri/src/modules/fs/grep.rs` | display_path |
| `src-tauri/src/modules/fs/search.rs` | display_path |
| `src-tauri/src/modules/git/utils.rs` | display_path |

## Entry Points

Start here when exploring this area:

- **`fs_read_file`** (Function) — `src-tauri/src/modules/fs/file.rs:46`
- **`fs_stat`** (Function) — `src-tauri/src/modules/fs/file.rs:139`
- **`fs_create_file`** (Function) — `src-tauri/src/modules/fs/mutate.rs:4`
- **`fs_create_dir`** (Function) — `src-tauri/src/modules/fs/mutate.rs:20`
- **`fs_rename`** (Function) — `src-tauri/src/modules/fs/mutate.rs:34`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `fs_read_file` | Function | `src-tauri/src/modules/fs/file.rs` | 46 |
| `fs_stat` | Function | `src-tauri/src/modules/fs/file.rs` | 139 |
| `fs_create_file` | Function | `src-tauri/src/modules/fs/mutate.rs` | 4 |
| `fs_create_dir` | Function | `src-tauri/src/modules/fs/mutate.rs` | 20 |
| `fs_rename` | Function | `src-tauri/src/modules/fs/mutate.rs` | 34 |
| `fs_delete` | Function | `src-tauri/src/modules/fs/mutate.rs` | 57 |
| `fs_watch_remove` | Function | `src-tauri/src/modules/fs/watch.rs` | 250 |
| `resolve_path` | Function | `src-tauri/src/modules/workspace.rs` | 237 |
| `to_canon` | Function | `src-tauri/src/modules/fs/mod.rs` | 11 |
| `display_path` | Function | `src-tauri/src/modules/git/utils.rs` | 19 |
| `workspace_authorize` | Function | `src-tauri/src/modules/workspace.rs` | 124 |
| `is_wsl` | Function | `src-tauri/src/modules/workspace.rs` | 224 |
| `fs_watch_add` | Function | `src-tauri/src/modules/fs/watch.rs` | 229 |
| `fs_write_file` | Function | `src-tauri/src/modules/fs/file.rs` | 101 |
| `read_file_classifies_utf8_as_text` | Function | `src-tauri/src/modules/fs/file.rs` | 168 |
| `s` | Function | `src-tauri/src/modules/fs/mutate.rs` | 81 |
| `create_file_makes_empty_and_refuses_to_clobber` | Function | `src-tauri/src/modules/fs/mutate.rs` | 86 |
| `create_dir_builds_nested_chain_and_refuses_existing` | Function | `src-tauri/src/modules/fs/mutate.rs` | 101 |
| `rename_moves_and_never_overwrites` | Function | `src-tauri/src/modules/fs/mutate.rs` | 111 |
| `delete_removes_file_then_dir_recursively` | Function | `src-tauri/src/modules/fs/mutate.rs` | 135 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Fs_watch_add → Is_safe_distro_name` | cross_community | 6 |
| `Git_panel_snapshot → Wsl_drvfs_to_windows` | cross_community | 6 |
| `Spawn → Is_safe_distro_name` | cross_community | 5 |
| `Fs_write_file → Is_safe_distro_name` | cross_community | 5 |
| `Fs_canonicalize → Is_safe_distro_name` | cross_community | 5 |
| `Fs_watch_add → Wsl_drvfs_to_windows` | cross_community | 5 |
| `Fs_watch_remove → Is_safe_distro_name` | cross_community | 5 |
| `Fs_stat → Is_safe_distro_name` | cross_community | 5 |
| `Git_resolve_repo → Is_wsl` | cross_community | 5 |
| `Git_diff_content → Is_wsl` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Git | 11 calls |
| Shell | 2 calls |
| Modules | 2 calls |
| Pty | 1 calls |

## How to Explore

1. `gitnexus_context({name: "fs_read_file"})` — see callers and callees
2. `gitnexus_query({query: "fs"})` — find related execution flows
3. Read key files listed above for implementation details
