# SSH Support Design

**Date:** 2026-05-15  
**Status:** Approved  
**Scope:** Native SSH as a first-class `WorkspaceEnv` variant — terminal PTY + remote FS (SFTP)

---

## Architecture Overview

SSH extends the existing `WorkspaceEnv` pattern across all layers. One `russh` session per profile is shared across terminal panes and FS operations opened to the same host.

```
Frontend                    Rust Backend
─────────────────────────   ──────────────────────────────────────
WorkspaceEnv                WorkspaceEnv enum
  { kind: "ssh",    ──────▶   Ssh { profile_id }
    profileId }                    │
                                   ▼
WorkspaceEnvSelector         ssh::ConnectionManager
  (SSH profiles in              (HashMap<profileId, Arc<SshConn>>)
   status bar dropdown)              │
                                     ├─ PTY channel  → pty_open
SSH Settings tab             ssh::SshConn     │
  (CRUD profiles)              russh session  ├─ SFTP subsystem → fs::*
                               + russh-sftp   └─ shell channel → shell::*
```

---

## Data Model & Profile Storage

Profiles stored in `tauri-plugin-store` under key `ssh_profiles`. Passphrases stored separately in the OS keyring via the existing `secrets` module under `ssh:<profileId>`.

```typescript
type SshProfile = {
  id: string;           // uuid
  name: string;         // display name, e.g. "prod-server"
  host: string;
  port: number;         // default 22
  user: string;
  authMethod: "key" | "agent";
  keyPath?: string;     // absolute path, e.g. ~/.ssh/id_ed25519
  knownFingerprint?: string; // SHA256 of host key; absent until first connect
};
```

`WorkspaceEnv` frontend type gains:
```typescript
| { kind: "ssh"; profileId: string }
```

Rust `WorkspaceEnv` enum gains:
```rust
Ssh { profile_id: String }
```

**Host key verification** uses TOFU (Trust On First Use): on first connect the fingerprint is shown to the user for confirmation, then stored in the profile. On subsequent connects a mismatch is a hard block.

---

## Rust Module Structure

New module at `src-tauri/src/modules/ssh/`:

```
ssh/
├── mod.rs          — SshState (connection manager), all tauri commands
├── connection.rs   — SshConn: russh client session + SftpSession handle
├── handler.rs      — russh ClientHandler impl (host key verification, auth)
├── pty.rs          — open_shell_channel() wired to existing on_data/on_exit channels
└── sftp.rs         — SFTP wrappers matching the fs:: command API surface
```

**`SshState`** registered with `.manage()`:
```rust
pub struct SshState {
    conns: RwLock<HashMap<String, Arc<SshConn>>>,
}
```

**`SshConn`** holds:
- `russh::client::Handle` — for opening new channels
- `russh_sftp::client::SftpSession` — for file operations, opened once on connect
- `known_fingerprint: String` — SHA256, matched on reconnect

### New Tauri Commands

| Command | Returns | Purpose |
|---|---|---|
| `ssh_profile_list` | `Vec<SshProfile>` | List saved profiles |
| `ssh_profile_save` | `SshProfile` | Create or update a profile |
| `ssh_profile_delete` | `()` | Remove a profile and its keyring entry |
| `ssh_connect` | `()` | Open+cache connection, verify fingerprint |
| `ssh_disconnect` | `()` | Close connection for a profile |
| `ssh_fingerprint_get` | `Option<String>` | Read live fingerprint before TOFU confirm |

### New Cargo Dependencies

```toml
russh = "0.45"
russh-sftp = "2"
uuid = { version = "1", features = ["v4"] }  # already in wmux, add here
```

---

## PTY Channel Integration

`pty_open` gains an SSH branch. The `on_data`/`on_exit` channel interface is identical to local PTY — `TerminalPane` requires no changes.

```rust
WorkspaceEnv::Ssh { profile_id } => {
    let conn = ssh_state.get_or_err(&profile_id)?;
    ssh::pty::open_channel(conn, cols, rows, on_data, on_exit).await
}
```

Inside `ssh::pty::open_channel`:
1. `conn.handle.channel_open_session()` → `Channel`
2. `channel.request_pty("xterm-256color", cols, rows)`
3. `channel.request_shell()`
4. Reader thread: `channel.stdout` → buffer → flush via `on_data` (same backpressure logic as local PTY)
5. Waiter thread: `channel.wait()` → `on_exit`

`pty_write` / `pty_resize` / `pty_close` are unchanged — `Session` gets a new variant wrapping the SSH channel handle.

---

## SFTP / Remote FS

Each `fs::*` command already takes `workspace: WorkspaceEnv`. The SSH branch uses `russh-sftp`'s async API:

| Command | SFTP equivalent |
|---|---|
| `fs_read_dir` | `sftp.read_dir(path)` |
| `fs_read_file` | `sftp.open(path).read_to_end()` |
| `fs_write_file` | `sftp.create(path).write_all()` |
| `fs_stat` | `sftp.metadata(path)` |
| `fs_create_file` | `sftp.create(path)` |
| `fs_create_dir` | `sftp.create_dir(path)` |
| `fs_rename` | `sftp.rename(src, dst)` |
| `fs_delete` | `sftp.remove_file()` / `sftp.remove_dir()` |
| `fs_search` / `fs_grep` | Run remote `find`/`grep` via a shell channel |

`SshConn` holds one persistent `SftpSession` opened during `ssh_connect` and reused for all FS ops.

---

## Frontend Changes

### `WorkspaceEnv` type
Add `ssh` variant; update `env.ts` and `WorkspaceEnvSelector`. SSH profiles appear in the selector on all platforms (not Windows-gated unlike WSL).

### SSH Settings tab
New tab in the existing Settings window:
- Profile list (name, host:port, user)
- Create/edit form: name, host, port, user, auth method, key path picker
- Passphrase stored via existing `secrets_set` command

### First-connect fingerprint dialog
When `ssh_connect` returns a new fingerprint, a modal displays it and requires user confirmation before caching. Standard TOFU flow. Fingerprint mismatch on reconnect shows a hard-block warning modal.

### Connection lifecycle
- `ssh_connect` called when user selects an SSH profile in the workspace selector
- `ssh_disconnect` on workspace switch away or app close
- Status indicator in the selector: connecting / connected / error

---

## Error Handling

| Error | Behavior |
|---|---|
| Auth failure | Toast with "re-enter passphrase" prompt |
| Fingerprint mismatch | Hard-block modal — never silently connect |
| Connection drop mid-session | Terminal shows standard exit notice; FS ops return inline error |
| SFTP unavailable on server | FS ops return "remote FS unavailable"; terminal still works |

---

## Testing

- Unit tests for SFTP wrappers (mock `SftpSession`)
- Integration test: in-process `russh` server fixture, connect, open shell channel, assert round-trip data
- Frontend: existing terminal pane tests pass unchanged (PTY interface is identical)

---

## Out of Scope (this iteration)

- Jump hosts / SSH proxy chains
- Port forwarding
- Remote extension of AI tools over SSH
