# PTY shell integration

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

## Session model

Block sessions keep direct terminal input until OSC 133 confirms prompt input.
Bare shells therefore remain usable. Bash before 4.4 lacks PS0 and emits
`OSC 133;B;terax_blocks=0`, retaining its native prompt instead of activating
Terax's shared command bar. Shell command labels stay bounded; block rerun uses
the complete command submitted through Terax, never a truncated OSC label.

A terminal tab maps to one PTY session. Sessions live in `PtyState` (`src-tauri/src/modules/pty/mod.rs:20`):

```rust
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}
```

IDs start at 1 and monotonically increase; they are never reused so the frontend can treat `0` as unset.

`pty_open` (`mod.rs:44`) spawns a session on a blocking thread, inserts it into the map, and returns the id. Output streams through a `Channel<Response>`; exit codes stream through a separate `Channel<i32>`. `pty_write` accepts raw bytes with an `x-pty-id` header and performs pipe writes on a blocking worker so a full input pipe cannot block acknowledgment IPC.

## Reader / flusher / waiter threads

`session::spawn` (`session.rs:102`) starts three threads per session:

1. **Reader** - reads bytes from the PTY master, runs the DA filter and agent detector, and pushes filtered bytes into a pending buffer.
2. **Flusher** - adaptively coalesces output and sends it to the frontend over the data channel.
3. **Waiter** - waits for the child process to exit, drains the flusher, and emits the exit code.

Output delivery is lossless and credit-based. The frontend acknowledges a
chunk only after Ghostty has synchronously parsed it.
Native pending plus in-flight data is capped at 2 MiB, and at most two chunks
may be in flight. When either limit is reached, the reader stops draining the
PTY and lets the operating system apply backpressure. No terminal bytes or
partial escape sequences are discarded during normal delivery or acknowledgment retries.

`pty_ack_output({ id, bytes })` carries a cumulative count of successfully parsed
bytes, not a credit delta. Rust validates the count against sent chunk boundaries.
Duplicate and stale counts do nothing; invalid or future boundaries are rejected.
The frontend retains unconfirmed progress, retries rejected calls with capped
backoff, and bounds unresolved acknowledgment calls to two. A stuck call or
parser is visible after five seconds. If the entire IPC connection remains
unresponsive, delivery stays paused with retained state rather than accumulating
requests. A parser error never returns credit for unconsumed bytes.

Reader completion and queue wakeups share the same mutex, preventing missed
EOF notifications. Neither child exit nor EOF bypasses the byte or message
limits. The exit channel is sent only after the final parser acknowledgment;
registration checks completed draining rather than mere child exit.

On Windows the waiter closes the ConPTY master on its own thread while the
reader continues through EOF, including the final frame emitted during close.
Explicit user close releases queue waiters and drains unwanted pipe bytes until
EOF. This follows the [ClosePseudoConsole contract](https://learn.microsoft.com/en-us/windows/console/closepseudoconsole)
and avoids the previous 50 ms final-output heuristic. Windows runtime testing
remains a release gate.

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
- [Terminal renderer pool](terminal-renderer-pool.md) - model ownership and presentation pooling
