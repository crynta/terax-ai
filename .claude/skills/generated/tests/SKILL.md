---
name: tests
description: "Skill for the Tests area of terax-ai. 62 symbols across 9 files."
---

# Tests

62 symbols | 9 files | Cohesion: 78%

## When to Use

- Working with code in `src-tauri/`
- Understanding how log, remote_url, repo_str work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src-tauri/tests/git_operations.rs` | skip_if_no_git, resolve_repo_returns_branch_for_real_repo, resolve_repo_returns_branch_for_unborn_head, status_on_empty_repo_has_no_files, status_lists_untracked_file (+18) |
| `src-tauri/tests/fs_search.rs` | grep_finds_matches_and_returns_relative_paths, grep_case_insensitive_finds_mixed_case, grep_glob_filter_restricts_files, grep_max_results_truncates, grep_empty_pattern_errors (+16) |
| `src-tauri/tests/common/mod.rs` | repo_str, run_git, write_file, git_available, root_str (+1) |
| `src-tauri/src/modules/git/operations.rs` | log, parse_shortstat, remote_url |
| `src-tauri/src/modules/fs/grep.rs` | build_globset, fs_grep, fs_glob |
| `src-tauri/src/modules/fs/search.rs` | fs_list_files, fs_search |
| `src-tauri/src/modules/fs/tree.rs` | fs_read_dir, list_subdirs |
| `src-tauri/src/modules/shell/mod.rs` | shell_session_run |
| `src/modules/ai/lib/miniWindowGeometry.ts` | clamp |

## Entry Points

Start here when exploring this area:

- **`log`** (Function) — `src-tauri/src/modules/git/operations.rs:473`
- **`remote_url`** (Function) — `src-tauri/src/modules/git/operations.rs:791`
- **`repo_str`** (Function) — `src-tauri/tests/common/mod.rs:38`
- **`run_git`** (Function) — `src-tauri/tests/common/mod.rs:42`
- **`write_file`** (Function) — `src-tauri/tests/common/mod.rs:46`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `log` | Function | `src-tauri/src/modules/git/operations.rs` | 473 |
| `remote_url` | Function | `src-tauri/src/modules/git/operations.rs` | 791 |
| `repo_str` | Function | `src-tauri/tests/common/mod.rs` | 38 |
| `run_git` | Function | `src-tauri/tests/common/mod.rs` | 42 |
| `write_file` | Function | `src-tauri/tests/common/mod.rs` | 46 |
| `git_available` | Function | `src-tauri/tests/common/mod.rs` | 68 |
| `fs_grep` | Function | `src-tauri/src/modules/fs/grep.rs` | 46 |
| `fs_glob` | Function | `src-tauri/src/modules/fs/grep.rs` | 182 |
| `fs_list_files` | Function | `src-tauri/src/modules/fs/search.rs` | 146 |
| `fs_read_dir` | Function | `src-tauri/src/modules/fs/tree.rs` | 27 |
| `list_subdirs` | Function | `src-tauri/src/modules/fs/tree.rs` | 102 |
| `shell_session_run` | Function | `src-tauri/src/modules/shell/mod.rs` | 196 |
| `root_str` | Function | `src-tauri/tests/common/mod.rs` | 88 |
| `mkdir` | Function | `src-tauri/tests/common/mod.rs` | 100 |
| `clamp` | Function | `src/modules/ai/lib/miniWindowGeometry.ts` | 11 |
| `fs_search` | Function | `src-tauri/src/modules/fs/search.rs` | 45 |
| `parse_shortstat` | Function | `src-tauri/src/modules/git/operations.rs` | 615 |
| `skip_if_no_git` | Function | `src-tauri/tests/git_operations.rs` | 10 |
| `resolve_repo_returns_branch_for_real_repo` | Function | `src-tauri/tests/git_operations.rs` | 34 |
| `resolve_repo_returns_branch_for_unborn_head` | Function | `src-tauri/tests/git_operations.rs` | 52 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Git_panel_snapshot → Clamp` | cross_community | 6 |
| `Git_log → Clamp` | cross_community | 6 |
| `Git_show_commit → Clamp` | cross_community | 6 |
| `Git_commit_files → Clamp` | cross_community | 6 |
| `Git_commit_file_diff → Clamp` | cross_community | 6 |
| `Git_remote_url → Clamp` | cross_community | 6 |
| `Git_remote_url → Env` | cross_community | 6 |
| `Git_remote_url → Hide_console` | cross_community | 6 |
| `AiMiniWindow → Clamp` | cross_community | 5 |
| `Diff_content → Clamp` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Git | 27 calls |
| Fs | 13 calls |
| Pty | 1 calls |
| Modules | 1 calls |

## How to Explore

1. `gitnexus_context({name: "log"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
