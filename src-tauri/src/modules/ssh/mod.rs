mod connection;
mod handler;
pub(crate) mod profiles;
pub(crate) mod pty;
pub(crate) mod sftp;

pub use connection::{SshConn, SshState};
pub use profiles::{ssh_profile_list, update_fingerprint, AuthMethod, SshProfile};

use std::net::ToSocketAddrs;
use std::sync::Arc;

use russh::client;
use russh::keys;
use russh_sftp::client::SftpSession;

use self::handler::SshHandler;

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
    profile_id: String,
) -> Result<(), String> {
    if state.get(&profile_id).is_some() {
        return Ok(()); // already connected
    }

    let profile = load_profile(&app, &profile_id)?;

    let (handler, observed_fp) = SshHandler::new(profile.known_fingerprint.clone());

    let config = Arc::new(client::Config::default());
    let addr_str = format!("{}:{}", profile.host, profile.port);
    let addr = addr_str
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
            let key = keys::load_secret_key(
                std::path::Path::new(&key_path),
                None,
            )
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
                use keys::agent::client::AgentClient;
                let agent_sock = std::env::var("SSH_AUTH_SOCK")
                    .map_err(|_| "SSH_AUTH_SOCK not set — is ssh-agent running?")?;
                let mut agent = AgentClient::connect_uds(&agent_sock)
                    .await
                    .map_err(|e| e.to_string())?;
                let identities = agent.request_identities().await.map_err(|e| e.to_string())?;
                let mut authed = false;
                for key in identities {
                    let (new_agent, result) = handle
                        .authenticate_future(&profile.user, key, agent)
                        .await;
                    agent = new_agent;
                    match result {
                        Ok(true) => {
                            authed = true;
                            break;
                        }
                        Ok(false) => continue,
                        Err(e) => return Err(e.to_string()),
                    }
                }
                if !authed {
                    return Err("SSH agent authentication rejected".into());
                }
            }
            #[cfg(windows)]
            {
                return Err("SSH agent auth on Windows is not yet supported".into());
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
        let _ = conn
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
        log::info!("SSH disconnected profile {profile_id}");
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_home(
    state: tauri::State<'_, SshState>,
    profile_id: String,
) -> Result<String, String> {
    let conn = state.get_or_err(&profile_id)?;
    let output = crate::modules::ssh::sftp::run_remote_command(&conn, "echo $HOME").await?;
    Ok(output.trim().to_string())
}

#[tauri::command]
pub async fn ssh_fingerprint_get(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<Option<String>, String> {
    let profile = load_profile(&app, &profile_id)?;
    Ok(profile.known_fingerprint)
}
