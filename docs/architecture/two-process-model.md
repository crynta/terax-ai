# Two-process model and IPC command reference

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

## The split

Terax is two processes: the Rust backend (`src-tauri/`) and the webview frontend (`src/`).

- **Rust owns all OS access**: PTY, file system, git, shell spawn, network, secrets, workspace authorization.
- **The webview never touches the FS, processes, or shells directly**. Every host operation goes through an `invoke()` call to a command registered in `src-tauri/src/lib.rs`.

This boundary is the root of the security model. Untrusted input (terminal escape sequences, file content, AI tool results) is parsed and validated in Rust or in carefully scoped frontend code, never executed by the renderer.

## Adding a new IPC command

1. Write the `#[tauri::command]` async function in the appropriate `src-tauri/src/modules/<area>/` module.
2. Register it in `src-tauri/src/lib.rs` inside the `tauri::generate_handler![...]` block (`src-tauri/src/lib.rs:191`).
3. If the command uses a Tauri plugin API (window, clipboard, dialog, etc.), add the plugin permission to `src-tauri/capabilities/default.json`.
4. Add a typed frontend wrapper in the matching `src/modules/<area>/lib/` directory and call it through Tauri's `invoke()` API.
5. If the command touches the file system, network, or shell, it must go through the existing guards (`security.ts` deny-list, workspace authorization registry, SSRF guard, AI tool approval).

Custom commands do not need to be listed one-by-one in `default.json`; the capability covers the window. Plugin permissions do.

## Command catalog

The commands registered in `src-tauri/src/lib.rs` are grouped below by module. Names are the Rust function names as seen by the frontend.

### PTY (`src-tauri/src/modules/pty/`)

Long-lived interactive terminal sessions.

- `pty_open` - create a new PTY session
- `pty_write` - send input bytes (text or control sequences)
- `pty_resize` - resize the PTY
- `pty_close` / `pty_close_all` - destroy one or all sessions
- `pty_has_foreground_process` / `pty_has_foreground_job` - detect whether a command is running
- `pty_shell_name` / `pty_list_shells` - shell detection and enumeration

Output streams from `pty_open` via a Tauri `Channel<PtyEvent>`.

### File system (`src-tauri/src/modules/fs/`)

#### Tree

- `list_subdirs` - list subdirectories
- `fs_read_dir` - read a directory

#### File

- `fs_read_file` - read file contents
- `fs_write_file` - write file contents
- `fs_stat` - file metadata
- `fs_canonicalize` - canonical path

#### Mutate

- `fs_create_file` / `fs_create_dir`
- `fs_rename` / `fs_delete` / `fs_copy`

#### Watch

- `fs_watch_add` / `fs_watch_remove` - filesystem change notifications

#### Search

- `fs_search` - fuzzy file finder
- `fs_list_files` - recursive file listing

#### Grep

- `fs_grep` - content search
- `fs_grep_interactive` - interactive content search
- `fs_glob` - glob matching

### Git (`src-tauri/src/modules/git/`)

All git commands are gated through the workspace authorization registry.

- `git_resolve_repo` / `git_panel_snapshot`
- `git_status`
- `git_diff` / `git_diff_content`
- `git_stage` / `git_unstage` / `git_discard`
- `git_commit`
- `git_fetch` / `git_pull_ff_only` / `git_push`
- `git_log` / `git_show_commit` / `git_commit_files` / `git_commit_file_diff`
- `git_remote_url`
- `git_list_branches` / `git_checkout_branch`

### Shell (`src-tauri/src/modules/shell/`)

Three distinct surfaces:

- `shell_run_command` - one-shot subshell exec for AI tools
- `shell_session_open` / `shell_session_run` / `shell_session_close` - persistent agent shell with state across calls
- `shell_bg_spawn` / `shell_bg_logs` / `shell_bg_kill` / `shell_bg_list` - long-running background processes with bounded ring-buffer log capture

### Workspace (`src-tauri/src/modules/workspace.rs`)

- `workspace_authorize` / `workspace_current_dir` - the spawn/git/AI cwd authorization registry
- `wsl_list_distros` / `wsl_default_distro` / `wsl_home` - WSL bridge

### Network (`src-tauri/src/modules/net.rs`)

- `ai_http_request` / `ai_http_stream` - AI HTTP proxy with SSRF guard
- `lm_ping` - local-model ping

### Secrets (`src-tauri/src/modules/secrets.rs`)

- `secrets_get` / `secrets_set` / `secrets_delete` / `secrets_get_all` - OS keychain access, service `terax-ai`

### Agent hooks (`src-tauri/src/modules/agent.rs`)

- `agent_enable_hooks` / `agent_hooks_status` - install/status terminal coding-agent hooks (Claude Code, Codex, Gemini CLI)

### History (`src-tauri/src/modules/history/`)

- `history_suggest` / `history_commands` / `history_record` / `history_list` - shell history integration

### Settings window

- `get_launch_dir` - CLI launch directory, drained on first read
- `open_settings_window` - open the separate settings webview (optional `tab` deep-link)

## Invariants

- The webview must not spawn processes, read files, or make network calls except through the commands above.
- New commands must be registered in `lib.rs` and guarded at the boundary (workspace auth, deny-list, SSRF, approval flow).
- Plugin permissions must be added to `src-tauri/capabilities/default.json` if the command uses a plugin API.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [PTY shell integration](pty-shell-integration.md) - how sessions and shell integration work
- [Security model](security-model.md) - the boundaries every command must respect
