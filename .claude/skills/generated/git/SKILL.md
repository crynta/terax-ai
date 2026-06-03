---
name: git
description: "Skill for the Git area of terax-ai. 104 symbols across 8 files."
---

# Git

104 symbols | 8 files | Cohesion: 71%

## When to Use

- Working with code in `src-tauri/`
- Understanding how command, resolve_repo, panel_snapshot work
- Modifying git-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/src/modules/git/operations.rs` | resolve_repo, resolve_repo_in_authorized, panel_snapshot, status, status_inner (+23) |
| `src-tauri/src/modules/git/process.rs` | availability_cell, prune_expired_availability_entries, workspace_cache_key, ensure_git_available, git_stdout_line_opt (+16) |
| `src-tauri/src/modules/git/parser.rs` | parse_porcelain_v2, ordinary, porcelain_v2_parses_branch_and_files, handles_detached_head, empty_input_yields_safe_defaults (+16) |
| `src-tauri/src/modules/git/commands.rs` | blocking, git_resolve_repo, git_panel_snapshot, git_status, git_diff (+13) |
| `src-tauri/src/modules/git/utils.rs` | split_upstream, normalize_git_path, canonical_dir, authorized_repo_root, resolve_within_repo (+4) |
| `src-tauri/src/modules/workspace.rs` | is_authorized, canonicalize_cached, from_option, is_safe_distro_name, validate_wsl_distro_name |
| `src-tauri/src/modules/git/errors.rs` | command |
| `src-tauri/src/modules/git/types.rs` | into_text |

## Entry Points

Start here when exploring this area:

- **`command`** (Function) — `src-tauri/src/modules/git/errors.rs:33`
- **`resolve_repo`** (Function) — `src-tauri/src/modules/git/operations.rs:19`
- **`panel_snapshot`** (Function) — `src-tauri/src/modules/git/operations.rs:81`
- **`status`** (Function) — `src-tauri/src/modules/git/operations.rs:118`
- **`diff`** (Function) — `src-tauri/src/modules/git/operations.rs:158`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `command` | Function | `src-tauri/src/modules/git/errors.rs` | 33 |
| `resolve_repo` | Function | `src-tauri/src/modules/git/operations.rs` | 19 |
| `panel_snapshot` | Function | `src-tauri/src/modules/git/operations.rs` | 81 |
| `status` | Function | `src-tauri/src/modules/git/operations.rs` | 118 |
| `diff` | Function | `src-tauri/src/modules/git/operations.rs` | 158 |
| `stage` | Function | `src-tauri/src/modules/git/operations.rs` | 262 |
| `unstage` | Function | `src-tauri/src/modules/git/operations.rs` | 287 |
| `discard` | Function | `src-tauri/src/modules/git/operations.rs` | 341 |
| `commit` | Function | `src-tauri/src/modules/git/operations.rs` | 395 |
| `push` | Function | `src-tauri/src/modules/git/operations.rs` | 436 |
| `show_commit_diff` | Function | `src-tauri/src/modules/git/operations.rs` | 580 |
| `commit_files` | Function | `src-tauri/src/modules/git/operations.rs` | 646 |
| `commit_file_diff` | Function | `src-tauri/src/modules/git/operations.rs` | 704 |
| `fetch` | Function | `src-tauri/src/modules/git/operations.rs` | 920 |
| `pull_ff_only` | Function | `src-tauri/src/modules/git/operations.rs` | 936 |
| `ensure_git_available` | Function | `src-tauri/src/modules/git/process.rs` | 52 |
| `git_stdout_line_opt` | Function | `src-tauri/src/modules/git/process.rs` | 154 |
| `git_stdout_lines` | Function | `src-tauri/src/modules/git/process.rs` | 180 |
| `run_git` | Function | `src-tauri/src/modules/git/process.rs` | 223 |
| `ensure_success` | Function | `src-tauri/src/modules/git/process.rs` | 333 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Shell_session_open → Is_safe_distro_name` | cross_community | 6 |
| `Fs_watch_add → Is_safe_distro_name` | cross_community | 6 |
| `Git_panel_snapshot → Wsl_drvfs_to_windows` | cross_community | 6 |
| `Git_panel_snapshot → Clamp` | cross_community | 6 |
| `Git_panel_snapshot → Env` | cross_community | 6 |
| `Git_log → Clamp` | cross_community | 6 |
| `Git_show_commit → Clamp` | cross_community | 6 |
| `Git_commit_files → Clamp` | cross_community | 6 |
| `Git_commit_file_diff → Clamp` | cross_community | 6 |
| `Git_remote_url → Clamp` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Modules | 5 calls |
| Tests | 3 calls |
| Fs | 3 calls |
| Pty | 2 calls |

## How to Explore

1. `gitnexus_context({name: "command"})` — see callers and callees
2. `gitnexus_query({query: "git"})` — find related execution flows
3. Read key files listed above for implementation details
