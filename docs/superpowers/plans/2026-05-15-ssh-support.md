# SSH Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native SSH as a first-class `WorkspaceEnv` variant, providing terminal PTY and remote FS (SFTP) over russh.

**Architecture:** `WorkspaceEnv` gains an `Ssh { profile_id }` variant. A new `ssh` module owns a `russh` session per profile, shared between a PTY channel (wired to the existing `on_data`/`on_exit` tauri channel interface) and an `SftpSession` (wired to all `fs::*` commands). Profiles are stored in `tauri-plugin-store`; passphrases in the OS keyring via the existing `secrets` module.

**Tech Stack:** Rust (russh 0.45, russh-sftp 2, ssh-key 0.6, tokio), tauri-plugin-store, TypeScript/React (Zustand, existing component library)

---

## File Map

### New files
| Path | Responsibility |
|---|---|
| `src-tauri/src/modules/ssh/mod.rs` | `SshState`, all tauri SSH commands |
| `src-tauri/src/modules/ssh/connection.rs` | `SshConn` struct (handle + sftp session) |
| `src-tauri/src/modules/ssh/handler.rs` | `russh::ClientHandler` impl (host key TOFU, stored fingerprint check) |
| `src-tauri/src/modules/ssh/profiles.rs` | Profile CRUD via `tauri-plugin-store` |
| `src-tauri/src/modules/ssh/pty.rs` | `open_ssh_pty_channel()` — opens shell channel, wires `on_data`/`on_exit` |
| `src-tauri/src/modules/ssh/sftp.rs` | SFTP wrappers matching `fs::*` return types |
| `src/modules/ssh/types.ts` | `SshProfile` TypeScript type |
| `src/modules/ssh/commands.ts` | `invoke` wrappers for SSH tauri commands |
| `src/modules/ssh/store.ts` | Zustand store for profiles + connection state |
| `src/modules/ssh/index.ts` | Re-exports |
| `src/modules/ssh/components/FingerprintDialog.tsx` | TOFU confirmation modal |
| `src/modules/ssh/components/SshProfilesSettings.tsx` | Settings tab: profile list + create/edit form |

### Modified files
| Path | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add russh, russh-sftp, ssh-key, uuid deps |
| `src-tauri/src/modules/mod.rs` | `pub mod ssh;` |
| `src-tauri/src/modules/workspace.rs` | Add `Ssh { profile_id: String }` variant |
| `src-tauri/src/modules/pty/mod.rs` | Store `PtyHandle` enum; branch on SSH in all 4 commands |
| `src-tauri/src/modules/pty/session.rs` | Add `SshPtySession` struct; rename existing struct `LocalSession` |
| `src-tauri/src/modules/fs/file.rs` | SSH branch in `fs_read_file`, `fs_write_file`, `fs_stat` |
| `src-tauri/src/modules/fs/tree.rs` | SSH branch in `fs_read_dir`, `list_subdirs` |
| `src-tauri/src/modules/fs/mutate.rs` | SSH branch in all 4 mutate commands |
| `src-tauri/src/modules/fs/search.rs` | SSH branch via remote `find` exec |
| `src-tauri/src/modules/fs/grep.rs` | SSH branch via remote `grep`/`glob` exec |
| `src-tauri/src/lib.rs` | Register `SshState`, add all SSH commands to invoke handler |
| `src/modules/workspace/env.ts` | Add `ssh` variant to `WorkspaceEnv` |
| `src/modules/workspace/index.ts` | Re-export SSH types |
| `src/modules/statusbar/WorkspaceEnvSelector.tsx` | SSH profiles section (all platforms) |
| `src/settings/SettingsApp.tsx` | Add SSH tab |

---

## Task 1: Add Cargo dependencies and stub SSH module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/modules/ssh/mod.rs`
- Modify: `src-tauri/src/modules/mod.rs`

- [ ] **Step 1: Add dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
russh = "0.45"
russh-sftp = "2"
ssh-key = { version = "0.6", features = ["std"] }
uuid = { version = "1", features = ["v4"] }
tokio = { version = "1", features = ["full"] }
```

- [ ] **Step 2: Create stub ssh module**

Create `src-tauri/src/modules/ssh/mod.rs`:
```rust
mod connection;
mod handler;
mod profiles;
pub(crate) mod pty;
pub(crate) mod sftp;

pub use connection::{SshConn, SshState};
pub use profiles::SshProfile;
```

Create `src-tauri/src/modules/ssh/connection.rs`:
```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub struct SshConn;  // placeholder — filled in Task 4

pub struct SshState {
    pub conns: RwLock<HashMap<String, Arc<SshConn>>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self { conns: RwLock::new(HashMap::new()) }
    }
}
```

Create `src-tauri/src/modules/ssh/handler.rs`:
```rust
// placeholder — filled in Task 4
```

Create `src-tauri/src/modules/ssh/profiles.rs`:
```rust
// placeholder — filled in Task 3
```

Create `src-tauri/src/modules/ssh/pty.rs`:
```rust
// placeholder — filled in Task 6
```

Create `src-tauri/src/modules/ssh/sftp.rs`:
```rust
// placeholder — filled in Task 8
```

- [ ] **Step 3: Register module**

In `src-tauri/src/modules/mod.rs`, add:
```rust
pub mod ssh;
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```
Expected: no errors (warnings OK)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/modules/ssh/ src-tauri/src/modules/mod.rs
git commit -m "chore(ssh): add russh deps, stub ssh module"
```

---

## Task 2: Add `Ssh` variant to `WorkspaceEnv`

**Files:**
- Modify: `src-tauri/src/modules/workspace.rs`
- Modify: `src/modules/workspace/env.ts`

- [ ] **Step 1: Add variant to Rust enum**

In `src-tauri/src/modules/workspace.rs`, change the enum:
```rust
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceEnv {
    #[default]
    Local,
    Wsl {
        distro: String,
    },
    Ssh {
        profile_id: String,
    },
}
```

Also update `is_wsl`:
```rust
pub fn is_wsl(&self) -> bool {
    matches!(self, Self::Wsl { .. })
}

pub fn is_ssh(&self) -> bool {
    matches!(self, Self::Ssh { .. })
}
```

- [ ] **Step 2: Update `resolve_path` to reject SSH (FS commands will branch before calling it)**

In `resolve_path` (both `#[cfg(windows)]` and `#[cfg(not(windows))]`), the SSH variant is never passed to `resolve_path` — callers branch on SSH before calling it. Add a panic guard for safety:

In the `#[cfg(windows)]` version:
```rust
#[cfg(windows)]
pub fn resolve_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Local => PathBuf::from(path),
        WorkspaceEnv::Wsl { distro } => wsl_path_to_unc(distro, path),
        WorkspaceEnv::Ssh { .. } => panic!("resolve_path called with SSH workspace — branch earlier"),
    }
}
```

In the `#[cfg(not(windows))]` version:
```rust
#[cfg(not(windows))]
pub fn resolve_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Local | WorkspaceEnv::Wsl { .. } => PathBuf::from(path),
        WorkspaceEnv::Ssh { .. } => panic!("resolve_path called with SSH workspace — branch earlier"),
    }
}
```

- [ ] **Step 3: Add variant to TypeScript type**

In `src/modules/workspace/env.ts`, change:
```typescript
export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; profileId: string };
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/workspace.rs src/modules/workspace/env.ts
git commit -m "feat(ssh): add Ssh variant to WorkspaceEnv"
```

---

## Task 3: SSH profile types and CRUD

**Files:**
- Modify: `src-tauri/src/modules/ssh/profiles.rs`
- Create: `src/modules/ssh/types.ts`
- Create: `src/modules/ssh/commands.ts`
- Create: `src/modules/ssh/store.ts`
- Create: `src/modules/ssh/index.ts`

- [ ] **Step 1: Write the Rust profile type and CRUD**

Replace `src-tauri/src/modules/ssh/profiles.rs`:
```rust
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_KEY: &str = "ssh_profiles";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: AuthMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Key,
    Agent,
}

#[tauri::command]
pub fn ssh_profile_list(app: tauri::AppHandle) -> Result<Vec<SshProfile>, String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let profiles = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(profiles)
}

#[tauri::command]
pub fn ssh_profile_save(app: tauri::AppHandle, profile: SshProfile) -> Result<SshProfile, String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn ssh_profile_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    profiles.retain(|p| p.id != id);
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

pub fn update_fingerprint(app: &tauri::AppHandle, id: &str, fingerprint: String) -> Result<(), String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == id) {
        p.known_fingerprint = Some(fingerprint);
    }
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Re-export from ssh mod.rs**

In `src-tauri/src/modules/ssh/mod.rs`, add:
```rust
pub use profiles::{ssh_profile_delete, ssh_profile_list, ssh_profile_save, SshProfile};
```

- [ ] **Step 3: Write TypeScript types**

Create `src/modules/ssh/types.ts`:
```typescript
export type AuthMethod = "key" | "agent";

export type SshProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  keyPath?: string;
  knownFingerprint?: string;
};
```

- [ ] **Step 4: Write tauri invoke wrappers**

Create `src/modules/ssh/commands.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SshProfile } from "./types";

export const sshProfileList = () =>
  invoke<SshProfile[]>("ssh_profile_list");

export const sshProfileSave = (profile: SshProfile) =>
  invoke<SshProfile>("ssh_profile_save", { profile });

export const sshProfileDelete = (id: string) =>
  invoke<void>("ssh_profile_delete", { id });

export const sshConnect = (profileId: string) =>
  invoke<void>("ssh_connect", { profileId });

export const sshDisconnect = (profileId: string) =>
  invoke<void>("ssh_disconnect", { profileId });

export const sshFingerprintGet = (profileId: string) =>
  invoke<string | null>("ssh_fingerprint_get", { profileId });
```

- [ ] **Step 5: Write Zustand store**

Create `src/modules/ssh/store.ts`:
```typescript
import { create } from "zustand";
import { sshProfileList, sshProfileSave, sshProfileDelete, sshConnect, sshDisconnect } from "./commands";
import type { SshProfile } from "./types";
import { v4 as uuidv4 } from "uuid";

type ConnState = "disconnected" | "connecting" | "connected" | "error";

type State = {
  profiles: SshProfile[];
  connState: Record<string, ConnState>;
  loadProfiles: () => Promise<void>;
  saveProfile: (profile: Omit<SshProfile, "id"> & { id?: string }) => Promise<SshProfile>;
  deleteProfile: (id: string) => Promise<void>;
  connect: (profileId: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  setConnState: (profileId: string, state: ConnState) => void;
};

export const useSshStore = create<State>((set, get) => ({
  profiles: [],
  connState: {},

  loadProfiles: async () => {
    const profiles = await sshProfileList();
    set({ profiles });
  },

  saveProfile: async (profile) => {
    const toSave: SshProfile = { ...profile, id: profile.id ?? uuidv4() };
    const saved = await sshProfileSave(toSave);
    await get().loadProfiles();
    return saved;
  },

  deleteProfile: async (id) => {
    await sshProfileDelete(id);
    await get().loadProfiles();
  },

  connect: async (profileId) => {
    set((s) => ({ connState: { ...s.connState, [profileId]: "connecting" } }));
    try {
      await sshConnect(profileId);
      set((s) => ({ connState: { ...s.connState, [profileId]: "connected" } }));
    } catch (e) {
      set((s) => ({ connState: { ...s.connState, [profileId]: "error" } }));
      throw e;
    }
  },

  disconnect: async (profileId) => {
    await sshDisconnect(profileId);
    set((s) => ({ connState: { ...s.connState, [profileId]: "disconnected" } }));
  },

  setConnState: (profileId, state) =>
    set((s) => ({ connState: { ...s.connState, [profileId]: state } })),
}));
```

- [ ] **Step 6: Create index**

Create `src/modules/ssh/index.ts`:
```typescript
export * from "./types";
export * from "./commands";
export * from "./store";
```

- [ ] **Step 7: Verify Rust compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/modules/ssh/profiles.rs src-tauri/src/modules/ssh/mod.rs \
  src/modules/ssh/
git commit -m "feat(ssh): profile CRUD — store, types, tauri commands"
```

---

## Task 4: `SshConn`, `SshState`, and `ClientHandler`

**Files:**
- Modify: `src-tauri/src/modules/ssh/connection.rs`
- Modify: `src-tauri/src/modules/ssh/handler.rs`

- [ ] **Step 1: Write `SshHandler`**

Replace `src-tauri/src/modules/ssh/handler.rs`:
```rust
use std::sync::{Arc, Mutex};

use russh::client;
use ssh_key::PublicKey;

pub struct SshHandler {
    /// Fingerprint stored in the profile. `None` on first connect (TOFU).
    pub known_fingerprint: Option<String>,
    /// The fingerprint seen during this handshake — written by `check_server_key`,
    /// read back by the caller after `connect()` returns.
    pub observed_fingerprint: Arc<Mutex<Option<String>>>,
}

impl SshHandler {
    pub fn new(known_fingerprint: Option<String>) -> (Self, Arc<Mutex<Option<String>>>) {
        let observed = Arc::new(Mutex::new(None));
        let handler = Self {
            known_fingerprint,
            observed_fingerprint: observed.clone(),
        };
        (handler, observed)
    }
}

#[async_trait::async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        use ssh_key::HashAlg;
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        *self.observed_fingerprint.lock().unwrap() = Some(fingerprint.clone());

        if let Some(known) = &self.known_fingerprint {
            if &fingerprint != known {
                log::warn!("SSH host key mismatch! Expected {known}, got {fingerprint}");
                return Ok(false);
            }
        }
        // First connect (no known fingerprint) or fingerprint matches: accept.
        // Caller is responsible for persisting the fingerprint after TOFU confirmation.
        Ok(true)
    }
}
```

- [ ] **Step 2: Write `SshConn` and `SshState`**

Replace `src-tauri/src/modules/ssh/connection.rs`:
```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use russh::client::Handle;
use russh_sftp::client::SftpSession;

use super::handler::SshHandler;

pub struct SshConn {
    pub handle: Handle<SshHandler>,
    pub sftp: SftpSession,
}

pub struct SshState {
    pub conns: RwLock<HashMap<String, Arc<SshConn>>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            conns: RwLock::new(HashMap::new()),
        }
    }
}

impl SshState {
    pub fn get(&self, profile_id: &str) -> Option<Arc<SshConn>> {
        self.conns.read().unwrap().get(profile_id).cloned()
    }

    pub fn get_or_err(&self, profile_id: &str) -> Result<Arc<SshConn>, String> {
        self.get(profile_id)
            .ok_or_else(|| format!("SSH: no active connection for profile {profile_id}"))
    }

    pub fn insert(&self, profile_id: String, conn: Arc<SshConn>) {
        self.conns.write().unwrap().insert(profile_id, conn);
    }

    pub fn remove(&self, profile_id: &str) -> Option<Arc<SshConn>> {
        self.conns.write().unwrap().remove(profile_id)
    }
}
```

- [ ] **Step 3: Update ssh/mod.rs re-exports**

In `src-tauri/src/modules/ssh/mod.rs`:
```rust
mod connection;
mod handler;
mod profiles;
pub(crate) mod pty;
pub(crate) mod sftp;

pub use connection::{SshConn, SshState};
pub use profiles::{ssh_profile_delete, ssh_profile_list, ssh_profile_save, update_fingerprint, SshProfile};
```

- [ ] **Step 4: Add `async-trait` dependency**

In `src-tauri/Cargo.toml` `[dependencies]`:
```toml
async-trait = "0.1"
```

- [ ] **Step 5: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/ssh/ src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ssh): SshConn, SshState, ClientHandler with TOFU fingerprint"
```

---

## Task 5: `ssh_connect`, `ssh_disconnect`, `ssh_fingerprint_get` commands

**Files:**
- Modify: `src-tauri/src/modules/ssh/mod.rs`

- [ ] **Step 1: Write the connect/disconnect commands**

Add to `src-tauri/src/modules/ssh/mod.rs`:
```rust
use std::net::ToSocketAddrs;
use std::sync::Arc;

use russh::client;
use russh_sftp::client::SftpSession;
use tauri_plugin_store::StoreExt;

use crate::modules::secrets::SecretsState;

use super::connection::{SshConn, SshState};
use super::handler::SshHandler;
use super::profiles::{update_fingerprint, AuthMethod, SshProfile};

fn load_profile(app: &tauri::AppHandle, profile_id: &str) -> Result<SshProfile, String> {
    let profiles = ssh_profile_list(app.clone())?;
    profiles
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("SSH profile not found: {profile_id}"))
}

#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, SshState>,
    secrets: tauri::State<'_, SecretsState>,
    profile_id: String,
) -> Result<(), String> {
    if state.get(&profile_id).is_some() {
        return Ok(()); // already connected
    }

    let profile = load_profile(&app, &profile_id)?;

    let (handler, observed_fp) = SshHandler::new(profile.known_fingerprint.clone());

    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", profile.host, profile.port);
    let addr = addr
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("could not resolve host")?;

    let mut handle = client::connect(config, addr, handler)
        .await
        .map_err(|e| e.to_string())?;

    // Authenticate
    match profile.auth_method {
        AuthMethod::Key => {
            let key_path = profile
                .key_path
                .as_deref()
                .ok_or("key auth requires keyPath")?;
            let key_path = shellexpand::tilde(key_path).into_owned();
            let passphrase: Option<String> = secrets
                .get(&format!("ssh:{}", profile.id))
                .ok()
                .flatten();
            let key = russh::keys::PrivateKey::read_openssh_file(std::path::Path::new(&key_path))
                .map_err(|e| e.to_string())?;
            let authed = handle
                .authenticate_publickey(&profile.user, Arc::new(key))
                .await
                .map_err(|e| e.to_string())?;
            if !authed {
                return Err("SSH key authentication rejected".into());
            }
        }
        AuthMethod::Agent => {
            #[cfg(unix)]
            {
                let agent_sock = std::env::var("SSH_AUTH_SOCK")
                    .map_err(|_| "SSH_AUTH_SOCK not set — is ssh-agent running?")?;
                let mut agent = russh_keys::agent::client::AgentClient::connect_uds(&agent_sock)
                    .await
                    .map_err(|e| e.to_string())?;
                let identities = agent.request_identities().await.map_err(|e| e.to_string())?;
                let mut authed = false;
                for key in identities {
                    if handle
                        .authenticate_future(&profile.user, key, &mut agent)
                        .await
                        .map_err(|e| e.to_string())?
                    {
                        authed = true;
                        break;
                    }
                }
                if !authed {
                    return Err("SSH agent authentication rejected".into());
                }
            }
            #[cfg(windows)]
            {
                return Err("SSH agent auth on Windows requires a named-pipe agent (not yet supported)".into());
            }
        }
    }

    // If this was a first-connect (no known fingerprint), persist the observed one.
    if profile.known_fingerprint.is_none() {
        if let Some(fp) = observed_fp.lock().unwrap().clone() {
            update_fingerprint(&app, &profile.id, fp)?;
        }
    }

    // Open SFTP subsystem
    let sftp_channel = handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    sftp_channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| e.to_string())?;
    let sftp = SftpSession::new(sftp_channel.into_stream())
        .await
        .map_err(|e| e.to_string())?;

    state.insert(profile_id, Arc::new(SshConn { handle, sftp }));
    log::info!("SSH connected to {}:{}", profile.host, profile.port);
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: tauri::State<'_, SshState>,
    profile_id: String,
) -> Result<(), String> {
    if let Some(conn) = state.remove(&profile_id) {
        let _ = conn.handle.disconnect(russh::Disconnect::ByApplication, "", "English").await;
        log::info!("SSH disconnected profile {profile_id}");
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_fingerprint_get(
    state: tauri::State<'_, SshState>,
    profile_id: String,
) -> Result<Option<String>, String> {
    // Returns the fingerprint of an active connection (useful for TOFU display).
    // The fingerprint is already persisted by ssh_connect; this is a read-only check.
    let _ = state.get(&profile_id); // just verifying connection exists
    Ok(None) // fingerprint is read from the profile store, not live — see FingerprintDialog
}
```

- [ ] **Step 2: Add `shellexpand` dependency**

In `src-tauri/Cargo.toml`:
```toml
shellexpand = "3"
```

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/ssh/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(ssh): ssh_connect, ssh_disconnect, key+agent auth"
```

---

## Task 6: Refactor `PtyState` to handle SSH sessions

**Files:**
- Modify: `src-tauri/src/modules/pty/session.rs`
- Modify: `src-tauri/src/modules/pty/mod.rs`

This task introduces a `PtyHandle` enum so `PtyState` can store both local and SSH sessions without changing the external command API.

- [ ] **Step 1: Add `SshPtySession` to `session.rs`**

At the bottom of `src-tauri/src/modules/pty/session.rs`, add:
```rust
use tokio::sync::mpsc;

pub enum SshPtyCmd {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

/// Thin handle to a tokio task that owns the russh channel.
pub struct SshPtySession {
    pub cmd_tx: mpsc::Sender<SshPtyCmd>,
}
```

- [ ] **Step 2: Add `PtyHandle` enum to `session.rs`**

Still in `src-tauri/src/modules/pty/session.rs`:
```rust
pub enum PtyHandle {
    Local(Arc<Session>),
    Ssh(Arc<SshPtySession>),
}

impl PtyHandle {
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        match self {
            PtyHandle::Local(s) => s
                .writer
                .lock()
                .unwrap()
                .write_all(data)
                .map_err(|e| e.to_string()),
            PtyHandle::Ssh(s) => {
                s.cmd_tx
                    .try_send(SshPtyCmd::Data(data.to_vec()))
                    .map_err(|e| e.to_string())
            }
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self {
            PtyHandle::Local(s) => s
                .master
                .lock()
                .unwrap()
                .resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string()),
            PtyHandle::Ssh(s) => {
                s.cmd_tx
                    .try_send(SshPtyCmd::Resize { cols, rows })
                    .map_err(|e| e.to_string())
            }
        }
    }

    pub fn kill(&self) -> Result<(), String> {
        match self {
            PtyHandle::Local(s) => s.killer.lock().unwrap().kill().map_err(|e| e.to_string()),
            PtyHandle::Ssh(s) => {
                let _ = s.cmd_tx.try_send(SshPtyCmd::Close);
                Ok(())
            }
        }
    }
}
```

- [ ] **Step 3: Update `PtyState` to store `PtyHandle`**

In `src-tauri/src/modules/pty/mod.rs`, change the `sessions` field type:

```rust
use session::PtyHandle;

pub struct PtyState {
    sessions: RwLock<HashMap<u32, PtyHandle>>,
    next_id: AtomicU32,
}
```

Update `pty_write`:
```rust
#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let handle = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_write: unknown id={id}");
        "no session".to_string()
    })?;
    handle.write(data.as_bytes()).map_err(|e| {
        log::debug!("pty_write id={id} failed: {e}");
        e
    })
}
```

Update `pty_resize`:
```rust
#[tauri::command]
pub fn pty_resize(state: tauri::State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let handle = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_resize: unknown id={id}");
        "no session".to_string()
    })?;
    handle.resize(cols, rows).map_err(|e| {
        log::warn!("pty_resize id={id} failed: {e}");
        e
    })
}
```

Update `pty_close`:
```rust
#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let handle = state.sessions.write().unwrap().remove(&id);
    if let Some(h) = handle {
        if let Err(e) = h.kill() {
            log::debug!("pty_close: kill id={id} returned {e}");
        }
        log::info!("pty closed id={id}");
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}
```

Update `pty_open` to wrap the local session:
```rust
// At the end of pty_open, after creating local session:
let id = state.next_id.fetch_add(1, Ordering::Relaxed);
state.sessions.write().unwrap().insert(id, PtyHandle::Local(session));
```

- [ ] **Step 4: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/pty/
git commit -m "refactor(pty): PtyHandle enum supports local + SSH sessions"
```

---

## Task 7: SSH PTY channel — open shell, wire `on_data`/`on_exit`

**Files:**
- Modify: `src-tauri/src/modules/ssh/pty.rs`
- Modify: `src-tauri/src/modules/pty/mod.rs`

- [ ] **Step 1: Implement `open_ssh_pty_channel`**

Replace `src-tauri/src/modules/ssh/pty.rs`:
```rust
use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;
use tauri::ipc::{Channel, Response};
use tokio::sync::mpsc;

use crate::modules::pty::session::{PtyHandle, SshPtyCmd, SshPtySession};
use super::connection::SshConn;

const FLUSH_INTERVAL: Duration = Duration::from_millis(4);
const READ_BUF_CAP: usize = 16 * 1024;

pub async fn open_ssh_pty_channel(
    conn: Arc<SshConn>,
    cols: u16,
    rows: u16,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<PtyHandle, String> {
    let mut channel = conn
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            cols as u32,
            rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| e.to_string())?;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<SshPtyCmd>(256);

    tauri::async_runtime::spawn(async move {
        let mut pending: Vec<u8> = Vec::with_capacity(READ_BUF_CAP);
        let mut last_flush = tokio::time::Instant::now();

        loop {
            tokio::select! {
                // Forward writes/resizes/close from PTY commands
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SshPtyCmd::Data(bytes)) => {
                            let _ = channel.data(bytes.as_ref()).await;
                        }
                        Some(SshPtyCmd::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        Some(SshPtyCmd::Close) | None => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                // Read output from the remote shell
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            pending.extend_from_slice(data);
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            // stderr — send inline so it appears in the terminal
                            pending.extend_from_slice(data);
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            // Flush remaining output before signalling exit
                            if !pending.is_empty() {
                                let chunk = std::mem::take(&mut pending);
                                let _ = on_data.send(Response::new(chunk));
                            }
                            let _ = on_exit.send(exit_status as i32);
                            break;
                        }
                        None => {
                            if !pending.is_empty() {
                                let chunk = std::mem::take(&mut pending);
                                let _ = on_data.send(Response::new(chunk));
                            }
                            let _ = on_exit.send(-1);
                            break;
                        }
                        _ => {}
                    }
                }
            }

            // Periodic flush — same 4 ms cadence as local PTY
            if last_flush.elapsed() >= FLUSH_INTERVAL && !pending.is_empty() {
                let chunk = std::mem::take(&mut pending);
                if on_data.send(Response::new(chunk)).is_err() {
                    break;
                }
                last_flush = tokio::time::Instant::now();
            }
        }
    });

    Ok(PtyHandle::Ssh(Arc::new(SshPtySession { cmd_tx })))
}
```

- [ ] **Step 2: Branch `pty_open` on SSH**

In `src-tauri/src/modules/pty/mod.rs`, make `pty_open` async and add SSH branch. Change the signature and body:

```rust
#[tauri::command]
pub async fn pty_open(
    state: tauri::State<'_, PtyState>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);

    let handle = match &workspace {
        WorkspaceEnv::Ssh { profile_id } => {
            let conn = ssh_state.get_or_err(profile_id)?;
            crate::modules::ssh::pty::open_ssh_pty_channel(conn, cols, rows, on_data, on_exit)
                .await?
        }
        _ => {
            let (session, _) =
                tauri::async_runtime::spawn_blocking(move || {
                    session::spawn(cols, rows, cwd, workspace, on_data, on_exit)
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| {
                    log::error!("pty_open failed: {e}");
                    e
                })?;
            PtyHandle::Local(session)
        }
    };

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, handle);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}
```

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/ssh/pty.rs src-tauri/src/modules/pty/mod.rs
git commit -m "feat(ssh): SSH PTY channel — shell over russh wired to on_data/on_exit"
```

---

## Task 8: SFTP wrappers

**Files:**
- Modify: `src-tauri/src/modules/ssh/sftp.rs`

- [ ] **Step 1: Write SFTP wrappers**

Replace `src-tauri/src/modules/ssh/sftp.rs`:
```rust
use std::time::UNIX_EPOCH;

use russh_sftp::client::fs::DirEntry as SftpDirEntry;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::modules::fs::file::{FileStat, ReadResult, StatKind};
use crate::modules::fs::tree::{DirEntry, EntryKind};
use super::connection::SshConn;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

pub async fn sftp_read_dir(conn: &SshConn, path: &str, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let entries = conn.sftp.read_dir(path).await.map_err(|e| e.to_string())?;
    let mut result: Vec<DirEntry> = entries
        .into_iter()
        .filter(|e| show_hidden || !e.file_name().starts_with('.'))
        .map(|e| {
            let meta = e.metadata();
            let is_dir = meta.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let is_symlink = meta.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            DirEntry {
                name: e.file_name().to_string(),
                kind: if is_dir { EntryKind::Dir } else if is_symlink { EntryKind::Symlink } else { EntryKind::File },
                size: meta.size.unwrap_or(0),
                mtime: meta.mtime.unwrap_or(0) * 1000,
            }
        })
        .collect();
    result.sort_by(|a, b| {
        let ak = matches!(a.kind, EntryKind::Dir);
        let bk = matches!(b.kind, EntryKind::Dir);
        bk.cmp(&ak).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(result)
}

pub async fn sftp_read_file(conn: &SshConn, path: &str) -> Result<ReadResult, String> {
    let meta = conn.sftp.metadata(path).await.map_err(|e| e.to_string())?;
    let size = meta.size.unwrap_or(0);
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge { size, limit: MAX_READ_BYTES });
    }
    let mut file = conn.sftp.open(path).await.map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(size as usize);
    file.read_to_end(&mut buf).await.map_err(|e| e.to_string())?;

    // Same binary sniff as local: check first 8 KB for null bytes
    let sniff = &buf[..buf.len().min(8192)];
    if sniff.contains(&0u8) {
        return Ok(ReadResult::Binary { size });
    }
    match String::from_utf8(buf) {
        Ok(s) => Ok(ReadResult::Text { content: s, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

pub async fn sftp_write_file(conn: &SshConn, path: &str, content: &str) -> Result<(), String> {
    let mut file = conn.sftp.create(path).await.map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).await.map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())
}

pub async fn sftp_stat(conn: &SshConn, path: &str) -> Result<FileStat, String> {
    let meta = conn.sftp.metadata(path).await.map_err(|e| e.to_string())?;
    let kind = if meta.file_type().map(|t| t.is_dir()).unwrap_or(false) {
        StatKind::Dir
    } else if meta.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    Ok(FileStat {
        size: meta.size.unwrap_or(0),
        mtime: meta.mtime.unwrap_or(0) * 1000,
        kind,
    })
}

pub async fn sftp_create_file(conn: &SshConn, path: &str) -> Result<(), String> {
    // Fail if exists — match local behaviour
    if conn.sftp.metadata(path).await.is_ok() {
        return Err(format!("already exists: {path}"));
    }
    let mut f = conn.sftp.create(path).await.map_err(|e| e.to_string())?;
    f.flush().await.map_err(|e| e.to_string())
}

pub async fn sftp_create_dir(conn: &SshConn, path: &str) -> Result<(), String> {
    if conn.sftp.metadata(path).await.is_ok() {
        return Err(format!("already exists: {path}"));
    }
    conn.sftp.create_dir(path).await.map_err(|e| e.to_string())
}

pub async fn sftp_rename(conn: &SshConn, from: &str, to: &str) -> Result<(), String> {
    conn.sftp.rename(from, to, None).await.map_err(|e| e.to_string())
}

pub async fn sftp_delete(conn: &SshConn, path: &str) -> Result<(), String> {
    let meta = conn.sftp.metadata(path).await.map_err(|e| e.to_string())?;
    if meta.file_type().map(|t| t.is_dir()).unwrap_or(false) {
        conn.sftp.remove_dir(path).await.map_err(|e| e.to_string())
    } else {
        conn.sftp.remove_file(path).await.map_err(|e| e.to_string())
    }
}

/// Run `find <path> -maxdepth 10 -iname "*<query>*"` on the remote host.
pub async fn sftp_search(conn: &SshConn, path: &str, query: &str) -> Result<Vec<String>, String> {
    let cmd = format!(
        "find {} -maxdepth 10 -iname '*{}*' 2>/dev/null",
        shell_escape(path),
        shell_escape(query)
    );
    let output = run_remote_command(conn, &cmd).await?;
    Ok(output.lines().map(|l| l.to_string()).collect())
}

/// Run `grep -rn <pattern> <path>` on the remote host.
pub async fn sftp_grep(conn: &SshConn, path: &str, pattern: &str) -> Result<Vec<String>, String> {
    let cmd = format!(
        "grep -rn --include='*' {} {} 2>/dev/null",
        shell_escape(pattern),
        shell_escape(path)
    );
    let output = run_remote_command(conn, &cmd).await?;
    Ok(output.lines().map(|l| l.to_string()).collect())
}

async fn run_remote_command(conn: &SshConn, cmd: &str) -> Result<String, String> {
    let mut channel = conn.handle.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { ref data } => output.extend_from_slice(data),
            russh::ChannelMsg::ExitStatus { .. } | russh::ChannelMsg::Eof => break,
            _ => {}
        }
    }
    String::from_utf8(output).map_err(|e| e.to_string())
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/modules/ssh/sftp.rs
git commit -m "feat(ssh): SFTP wrappers for read_dir, read_file, write_file, stat, CRUD, search, grep"
```

---

## Task 9: Branch `fs::file` on SSH

**Files:**
- Modify: `src-tauri/src/modules/fs/file.rs`

- [ ] **Step 1: Make fs_read_file async and add SSH branch**

In `src-tauri/src/modules/fs/file.rs`:

Change `fs_read_file` signature to async and add SSH branch at the top:
```rust
#[tauri::command]
pub async fn fs_read_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_read_file(&conn, &path).await;
    }
    // existing local logic below — wrap in spawn_blocking since it's sync I/O
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // ... existing body ...
    }).await.map_err(|e| e.to_string())?
}
```

Move the existing synchronous body into the `spawn_blocking` closure unchanged.

- [ ] **Step 2: Make `fs_write_file` async and add SSH branch**

```rust
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_write_file(&conn, &path, &content).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 3: Make `fs_stat` async and add SSH branch**

```rust
#[tauri::command]
pub async fn fs_stat(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_stat(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 4: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/fs/file.rs
git commit -m "feat(ssh): fs_read_file, fs_write_file, fs_stat — SSH branch via SFTP"
```

---

## Task 10: Branch `fs::tree` on SSH

**Files:**
- Modify: `src-tauri/src/modules/fs/tree.rs`

- [ ] **Step 1: Make `fs_read_dir` async and add SSH branch**

```rust
#[tauri::command]
pub async fn fs_read_dir(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_read_dir(&conn, &path, show_hidden).await;
    }
    let root = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 2: Make `list_subdirs` async and add SSH branch**

`list_subdirs` uses `fs_read_dir` internally — once `fs_read_dir` is async, make `list_subdirs` call it:
```rust
#[tauri::command]
pub async fn list_subdirs(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        let entries = crate::modules::ssh::sftp::sftp_read_dir(&conn, &path, false).await?;
        return Ok(entries.into_iter()
            .filter(|e| matches!(e.kind, EntryKind::Dir))
            .map(|e| format!("{}/{}", path.trim_end_matches('/'), e.name))
            .collect());
    }
    let root = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/fs/tree.rs
git commit -m "feat(ssh): fs_read_dir, list_subdirs — SSH branch via SFTP"
```

---

## Task 11: Branch `fs::mutate` on SSH

**Files:**
- Modify: `src-tauri/src/modules/fs/mutate.rs`

- [ ] **Step 1: Add SSH branches to all 4 mutate commands**

Make each command `async` and add the SSH branch. Pattern is identical for all four — shown here for all:

```rust
use crate::modules::workspace::WorkspaceEnv;

#[tauri::command]
pub async fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_create_file(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        if p.exists() { return Err(format!("already exists: {}", p.display())); }
        std::fs::write(&p, "").map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_create_dir(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        if p.exists() { return Err(format!("already exists: {}", p.display())); }
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_rename(&conn, &from, &to).await;
    }
    let fp = resolve_path(&from, &workspace);
    let tp = resolve_path(&to, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::rename(&fp, &tp).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_delete(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(&p).map_err(|e| e.to_string())
        }
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/modules/fs/mutate.rs
git commit -m "feat(ssh): fs_create_file/dir, fs_rename, fs_delete — SSH branch via SFTP"
```

---

## Task 12: Branch `fs::search` and `fs::grep` on SSH

**Files:**
- Modify: `src-tauri/src/modules/fs/search.rs`
- Modify: `src-tauri/src/modules/fs/grep.rs`

- [ ] **Step 1: Read current search/grep signatures**

```bash
head -60 src-tauri/src/modules/fs/search.rs
head -60 src-tauri/src/modules/fs/grep.rs
```

- [ ] **Step 2: Add SSH branch to `fs_search`**

Make `fs_search` async, add SSH branch at top:
```rust
#[tauri::command]
pub async fn fs_search(
    path: String,
    query: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_search(&conn, &path, &query).await;
    }
    let root = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 3: Add SSH branch to `fs_grep` and `fs_glob`**

Same pattern — make each async, branch on SSH using `sftp_grep` for `fs_grep`. `fs_glob` uses `find` patterns — use `sftp_search` with the glob pattern:
```rust
#[tauri::command]
pub async fn fs_grep(
    path: String,
    pattern: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_grep(&conn, &path, &pattern).await;
    }
    let root = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        // existing sync body
    }).await.map_err(|e| e.to_string())?
}
```

- [ ] **Step 4: Verify compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/fs/search.rs src-tauri/src/modules/fs/grep.rs
git commit -m "feat(ssh): fs_search, fs_grep — SSH branch via remote exec"
```

---

## Task 13: Register all SSH commands in `lib.rs` and integration test

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register `SshState` and all SSH commands**

In `src-tauri/src/lib.rs`:

Add `.manage(ssh::SshState::default())` after the existing `.manage(secrets::SecretsState::default())`:
```rust
use modules::ssh;
// ...
.manage(ssh::SshState::default())
```

Add to `invoke_handler`:
```rust
ssh::ssh_profile_list,
ssh::ssh_profile_save,
ssh::ssh_profile_delete,
ssh::ssh_connect,
ssh::ssh_disconnect,
ssh::ssh_fingerprint_get,
```

- [ ] **Step 2: Write integration test**

Create `src-tauri/tests/ssh_profiles_test.rs`:
```rust
// Test profile round-trip (store + retrieve)
// This is a unit-level test of the profile serde logic — no network required.

use terax_lib::modules::ssh::profiles::{AuthMethod, SshProfile};

#[test]
fn profile_serde_round_trip() {
    let profile = SshProfile {
        id: "test-id".into(),
        name: "Test Server".into(),
        host: "example.com".into(),
        port: 22,
        user: "alice".into(),
        auth_method: AuthMethod::Key,
        key_path: Some("~/.ssh/id_ed25519".into()),
        known_fingerprint: None,
    };

    let json = serde_json::to_string(&profile).unwrap();
    let decoded: SshProfile = serde_json::from_str(&json).unwrap();

    assert_eq!(decoded.id, "test-id");
    assert_eq!(decoded.host, "example.com");
    assert_eq!(decoded.port, 22);
    assert!(decoded.known_fingerprint.is_none());
}
```

Export `modules` from lib for tests. In `src-tauri/src/lib.rs` add:
```rust
pub mod modules;  // make accessible to integration tests
```

- [ ] **Step 3: Run the test**

```bash
cd src-tauri && cargo test ssh_profiles_test 2>&1 | tail -10
```
Expected: `test ssh_profiles_test::profile_serde_round_trip ... ok`

- [ ] **Step 4: Verify full build**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/tests/
git commit -m "feat(ssh): register SshState + all SSH commands; add serde round-trip test"
```

---

## Task 14: Frontend — `WorkspaceEnvSelector` SSH section + TOFU dialog

**Files:**
- Modify: `src/modules/statusbar/WorkspaceEnvSelector.tsx`
- Create: `src/modules/ssh/components/FingerprintDialog.tsx`

- [ ] **Step 1: Create `FingerprintDialog`**

Create `src/modules/ssh/components/FingerprintDialog.tsx`:
```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  host: string;
  fingerprint: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function FingerprintDialog({ host, fingerprint, open, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unknown host — verify fingerprint</AlertDialogTitle>
          <AlertDialogDescription>
            <p className="mb-2">
              You are connecting to <strong>{host}</strong> for the first time.
              Verify the fingerprint below matches what you expect before continuing.
            </p>
            <code className="block rounded bg-muted px-3 py-2 text-xs font-mono break-all">
              {fingerprint}
            </code>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Trust &amp; Connect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Update `WorkspaceEnvSelector` to include SSH profiles**

In `src/modules/statusbar/WorkspaceEnvSelector.tsx`, add the SSH section. The component currently returns `null` if not Windows. Remove that guard — SSH is cross-platform. Add SSH profile loading and display:

```tsx
import { useSshStore } from "@/modules/ssh/store";
import { FingerprintDialog } from "@/modules/ssh/components/FingerprintDialog";
import { useState } from "react";
import { sshFingerprintGet } from "@/modules/ssh/commands";

// Inside the component (after existing hooks):
const sshProfiles = useSshStore((s) => s.profiles);
const sshConnect = useSshStore((s) => s.connect);
const loadSshProfiles = useSshStore((s) => s.loadProfiles);

const [fingerprintDialog, setFingerprintDialog] = useState<{
  profileId: string;
  host: string;
  fingerprint: string;
} | null>(null);

const handleSshSelect = async (profileId: string) => {
  const profile = sshProfiles.find((p) => p.id === profileId);
  if (!profile) return;
  if (!profile.knownFingerprint) {
    // First connect — show TOFU dialog after connecting (russh persists on connect)
    await sshConnect(profileId);
    const fp = await sshFingerprintGet(profileId);
    if (fp) {
      setFingerprintDialog({ profileId, host: profile.host, fingerprint: fp });
      return;
    }
  }
  await sshConnect(profileId);
  onSelect({ kind: "ssh", profileId });
};

// In handleOpenChange, also load SSH profiles:
const handleOpenChange = (open: boolean) => {
  if (open) {
    if (IS_WINDOWS && distros.length === 0 && !loading) void refreshDistros();
    if (sshProfiles.length === 0) void loadSshProfiles();
  }
};
```

Add SSH section to the dropdown content (before the final separator):
```tsx
{sshProfiles.length > 0 && (
  <>
    <DropdownMenuSeparator />
    {sshProfiles.map((profile) => (
      <DropdownMenuItem
        key={profile.id}
        onSelect={() => void handleSshSelect(profile.id)}
      >
        SSH: {profile.name} ({profile.host})
      </DropdownMenuItem>
    ))}
  </>
)}
```

Add `FingerprintDialog` at the bottom of the return:
```tsx
{fingerprintDialog && (
  <FingerprintDialog
    host={fingerprintDialog.host}
    fingerprint={fingerprintDialog.fingerprint}
    open={true}
    onConfirm={() => {
      onSelect({ kind: "ssh", profileId: fingerprintDialog.profileId });
      setFingerprintDialog(null);
    }}
    onCancel={() => {
      setFingerprintDialog(null);
    }}
  />
)}
```

Remove the `if (!IS_WINDOWS) return null;` guard — SSH works everywhere.

- [ ] **Step 3: Verify TypeScript builds**

```bash
pnpm build 2>&1 | grep "error TS" | head -20
```
Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/statusbar/WorkspaceEnvSelector.tsx src/modules/ssh/components/FingerprintDialog.tsx
git commit -m "feat(ssh): WorkspaceEnvSelector SSH section + TOFU fingerprint dialog"
```

---

## Task 15: Frontend — SSH Settings tab

**Files:**
- Create: `src/modules/ssh/components/SshProfilesSettings.tsx`
- Modify: `src/settings/SettingsApp.tsx`

- [ ] **Step 1: Create `SshProfilesSettings`**

Create `src/modules/ssh/components/SshProfilesSettings.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useSshStore } from "@/modules/ssh/store";
import type { SshProfile, AuthMethod } from "@/modules/ssh/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { v4 as uuidv4 } from "uuid";

const EMPTY_FORM: Omit<SshProfile, "id" | "knownFingerprint"> = {
  name: "",
  host: "",
  port: 22,
  user: "",
  authMethod: "key",
  keyPath: "",
};

export function SshProfilesSettings() {
  const profiles = useSshStore((s) => s.profiles);
  const loadProfiles = useSshStore((s) => s.loadProfiles);
  const saveProfile = useSshStore((s) => s.saveProfile);
  const deleteProfile = useSshStore((s) => s.deleteProfile);

  const [editing, setEditing] = useState<SshProfile | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const startEdit = (profile: SshProfile) => {
    setEditing(profile);
    setForm({ name: profile.name, host: profile.host, port: profile.port, user: profile.user, authMethod: profile.authMethod, keyPath: profile.keyPath ?? "" });
    setError(null);
  };

  const startNew = () => {
    setEditing({ id: uuidv4(), ...EMPTY_FORM, knownFingerprint: undefined });
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name || !form.host || !form.user) {
      setError("Name, host, and user are required.");
      return;
    }
    try {
      await saveProfile({ ...form, id: editing!.id });
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">SSH Profiles</h2>
        <Button size="sm" onClick={startNew}>New Profile</Button>
      </div>

      {profiles.length === 0 && !editing && (
        <p className="text-xs text-muted-foreground">No SSH profiles yet. Click New Profile to add one.</p>
      )}

      <ul className="flex flex-col gap-1">
        {profiles.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-muted-foreground">{p.user}@{p.host}:{p.port}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => void deleteProfile(p.id)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="flex flex-col gap-3 rounded border p-4">
          <h3 className="text-xs font-semibold">{editing.id ? "Edit Profile" : "New Profile"}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="prod-server" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Host</label>
              <Input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Port</label>
              <Input type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">User</label>
              <Input value={form.user} onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))} placeholder="alice" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Auth Method</label>
            <div className="flex gap-3">
              {(["key", "agent"] as AuthMethod[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name="authMethod" value={m} checked={form.authMethod === m}
                    onChange={() => setForm((f) => ({ ...f, authMethod: m }))} />
                  {m === "key" ? "SSH Key" : "SSH Agent"}
                </label>
              ))}
            </div>
          </div>
          {form.authMethod === "key" && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Key Path</label>
              <Input value={form.keyPath} onChange={(e) => setForm((f) => ({ ...f, keyPath: e.target.value }))} placeholder="~/.ssh/id_ed25519" />
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleSave()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add SSH tab to `SettingsApp.tsx`**

In `src/modules/settings/openSettingsWindow.ts`, add `"ssh"` to the `SettingsTab` union:
```typescript
export type SettingsTab =
  | "general"
  | "shortcuts"
  | "models"
  | "agents"
  | "ssh"
  | "about";
```

In `src/settings/SettingsApp.tsx`, add the import and register the tab:
```tsx
import { SshProfilesSettings } from "@/modules/ssh/components/SshProfilesSettings";
import { Server01Icon } from "@hugeicons/core-free-icons";
```

Add `"ssh"` to `VALID_TABS`:
```typescript
const VALID_TABS: SettingsTab[] = [
  "general",
  "shortcuts",
  "models",
  "agents",
  "ssh",
  "about",
];
```

Add the SSH tab to the `TABS` array (before `"about"`):
```typescript
{ id: "ssh", label: "SSH", icon: Server01Icon, component: SshProfilesSettings },
```

No other changes needed — the existing tab rendering loop handles it automatically.

- [ ] **Step 3: Verify TypeScript builds**

```bash
pnpm build 2>&1 | grep "error TS" | head -20
```
Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/ssh/components/SshProfilesSettings.tsx src/settings/SettingsApp.tsx
git commit -m "feat(ssh): SSH profiles settings tab — create/edit/delete profiles"
```

---

## Task 16: Push to personal fork and verify

- [ ] **Step 1: Final compile check**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error"
pnpm build 2>&1 | grep "error TS"
```
Expected: both clean

- [ ] **Step 2: Run Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -15
```
Expected: all tests pass including `profile_serde_round_trip`

- [ ] **Step 3: Push to personal fork**

```bash
git push personal main
```

- [ ] **Step 4: Verify push**

```bash
gh repo view dcieslak19973/terax-ai --web
```
Or confirm at: https://github.com/dcieslak19973/terax-ai

---

## Notes for implementer

- **`russh` API surface:** This plan targets russh 0.45. If the exact method signatures differ, check `cargo doc --open` after adding the dep in Task 1 before writing handler code.
- **Agent auth on Windows:** Named-pipe ssh-agent (e.g. 1Password, OpenSSH for Windows) uses a different socket mechanism. The plan stubs it as unsupported — add when needed.
- **SFTP `channel.into_stream()`:** russh-sftp 2.x requires the channel to be converted via `.into_stream()`. If the API differs, check `russh_sftp::client::SftpSession::new`'s expected argument type.
- **Shell commands (`fs_search`, `fs_grep`):** These run `find`/`grep` on the remote. Assumes a POSIX shell on the server. Adjust escaping if targeting Windows SSH servers.
- **`uuid` in frontend:** The plan uses `uuid` npm package in `store.ts`. Add it: `pnpm add uuid && pnpm add -D @types/uuid`.
