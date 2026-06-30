# PTY shell integration

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

## Session model

A terminal tab maps to one PTY session. Sessions live in `PtyState` (`src-tauri/src/modules/pty/mod.rs:20`):

```rust
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}
```

IDs start at 1 and monotonically increase; they are never reused so the frontend can treat `0` as unset.

`pty_open` (`mod.rs:44`) spawns a session on a blocking thread, inserts it into the map, and returns the id. Output streams through a `Channel<Response>`; exit codes stream through a separate `Channel<i32>`. `pty_write` (`mod.rs:100`) accepts raw bytes with an `x-pty-id` header to avoid JSON serialization on every keystroke.

## Reader / flusher / waiter threads

`session::spawn` (`session.rs:102`) starts three threads per session:

1. **Reader** - reads bytes from the PTY master, runs the DA filter and agent detector, and pushes filtered bytes into a pending buffer.
2. **Flusher** - coalesces output and sends it to the frontend over the data channel.
3. **Waiter** - waits for the child process to exit, flushes the tail, and emits the exit code.

The pending buffer is capped at 4 MiB; on overflow it is discarded and replaced with an SGR-reset notice so xterm state is not corrupted by a sliced CSI sequence.

## Shell bootstrapping

`shell_init::build_command` (`shell_init.rs:53`) builds the `CommandBuilder` used to spawn the shell. The path and arguments depend on the platform and the selected workspace environment (Local or a WSL distro).

### Unix

Integration scripts live in `src-tauri/src/modules/pty/scripts/`:

- `zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh` for zsh
- `bashrc.bash` for bash
- `init.fish` for fish, installed to `~/.config/fish/conf.d/terax.fish`

Zsh is launched with `ZDOTDIR` pointing at a temp directory that sources our scripts and then the user's real configs. Bash uses `--rcfile` with a wrapper that sources the user's `~/.bashrc` after Terax's. Fish uses `conf.d` so no user file is replaced.

All integrated shells emit **OSC 7** (cwd) and **OSC 133 A/B/C/D** (prompt boundaries and exit code) so Terax can track cwd and detect command boundaries without parsing the user's prompt.

### Windows

On Windows the shell priority is:

1. `pwsh.exe` (PowerShell 7+)
2. `powershell.exe` (Windows PowerShell 5.1)
3. `cmd.exe` (no integration)

PowerShell loads `profile.ps1` via:

```text
pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <profile.ps1>
```

The profile wraps the user's existing `prompt` function to emit OSC 7 + OSC 133 A/B/D after `$PROFILE` runs. The cwd is normalized to backslashes before being passed to ConPTY because `CreateProcessW` misbehaves with forward slashes.

### Fish 4.0+

Fish 4.0 writes its own OSC 133 prompt markers. To avoid doubling, Terax sets `fish_features=no-mark-prompt` and re-asserts its own prompt via `-C` after `config.fish` runs.

## Concurrency and process lifetime on Windows

### `CONPTY_LIFECYCLE_LOCK`

`openpty + spawn_command` and the corresponding close are serialized by a static mutex in `session.rs:71`. Concurrent ConPTY lifecycle calls corrupt the new console so its shell never pumps output.

### Job Object

Each ConPTY child is assigned to a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`job.rs:34`). When the Job HANDLE drops - clean shutdown, panic, or even a SIGKILL'd Terax process - the kernel kills every descendant of the shell. Without this, `TerminateProcess` only kills the immediate child and `npm run dev` started inside pwsh would be orphaned.

On macOS and Linux, `Drop for Session` calls `killer.kill()`. Dev `Ctrl-C` of `cargo run` can still leave orphans because destructors may not run; that is acceptable for development only.

## Input and escape-sequence handling

### DA filter

PowerShell / PSReadLine sends a cursor-position query (`ESC[6n`) at startup and blocks until it gets an answer. The `DaFilter` (`da_filter.rs`) intercepts that query and replies on the PTY input so the shell does not hang.

### Agent detection

The reader thread runs an `AgentDetector` (`agent_detect.rs`) over the byte stream. It is armed by `OSC 133;C;<cmd>` or by a self-armed `OSC 777` marker and emits `terax:agent-signal` transitions (`started`, `working`, `attention`, `finished`, `exited`). Detection is driven only by OSC sequences, never by raw output, so a repainting TUI never flaps.

### Enter key

Terminal input sends `\r` (CR), not `\n` (LF). PowerShell on Windows requires CR.

## Invariants

- Do not remove `CONPTY_LIFECYCLE_LOCK` without verifying first-tab stability under fast tab spam.
- Do not disable the Job Object without a replacement orphan guard on Windows.
- Keep platform-specific shell logic in the matching `#[cfg(unix)]` or `#[cfg(windows)]` arm of `shell_init.rs`.
- cwd passed to ConPTY must use backslashes; OSC 7 cwd arriving at the frontend is forward-slash canonical.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [Two-process model](two-process-model.md) - IPC boundary and command catalog
- [Terminal renderer pool](terminal-renderer-pool.md) - slot pooling and the DormantRing
