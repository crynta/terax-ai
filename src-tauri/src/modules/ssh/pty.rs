use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;
use tauri::ipc::{Channel, Response};
use tokio::sync::mpsc;

use crate::modules::pty::session::{PtyHandle, SshPtyCmd, SshPtySession};
use super::connection::SshConn;

const FLUSH_INTERVAL: Duration = Duration::from_millis(4);

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
        let mut pending: Vec<u8> = Vec::with_capacity(16 * 1024);
        let mut last_flush = tokio::time::Instant::now();

        loop {
            tokio::select! {
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
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            pending.extend_from_slice(data);
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            pending.extend_from_slice(data);
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
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
                        Some(msg) => {
                            log::debug!("ssh pty: unhandled channel msg {msg:?}");
                        }
                    }
                }
            }

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
