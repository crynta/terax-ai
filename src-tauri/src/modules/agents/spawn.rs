//! Subprocess spawn helper with explicit env-var control.
//!
//! `agent_client_protocol_tokio::AcpAgent` is convenient but its
//! `McpServerStdio` config only lets us *add* env vars — there's no way to
//! *remove* an inherited one. That bites us when Terax is launched from a
//! shell that exports `ANTHROPIC_API_KEY=""` (e.g. inside Claude Desktop's
//! local-agent mode): the empty string overrides the user's keychain
//! OAuth lookup and the shim throws.
//!
//! This module mirrors AcpAgent's `ConnectTo<Client>` impl but takes a
//! pre-built `tokio::process::Command` so the caller can call
//! `cmd.env_remove(...)` before we spawn.

use std::process::Stdio;

use agent_client_protocol::{Client, ConnectTo, Lines};
use tokio::process::{Child, Command};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

/// Pre-prepared `tokio::process::Command` ready to be spawned for an ACP
/// session. We hold it (not the child) so we can defer the actual spawn
/// to inside `connect_to`, where the protocol future runs.
pub struct AcpSubprocess {
    pub command: Command,
}

impl AcpSubprocess {
    pub fn new(command: Command) -> Self {
        Self { command }
    }
}

impl ConnectTo<Client> for AcpSubprocess {
    async fn connect_to(
        self,
        client: impl ConnectTo<<Client as agent_client_protocol::Role>::Counterpart>,
    ) -> Result<(), agent_client_protocol::Error> {
        use futures::io::BufReader;
        use futures::{AsyncBufReadExt, AsyncWriteExt, StreamExt};

        let (child_stdin, child_stdout, child_stderr, child) = spawn_with_pipes(self.command)?;

        // Collect stderr in the background so we can include it in the
        // error message if the child exits non-zero before the protocol
        // shake-hands. Bounded — we don't keep more than ~16 KiB.
        let (stderr_tx, stderr_rx) = tokio::sync::oneshot::channel::<String>();
        tokio::spawn(async move {
            let reader = BufReader::new(child_stderr.compat());
            let mut lines = reader.lines();
            let mut collected = String::new();
            while let Some(Ok(line)) = lines.next().await {
                if collected.len() < 16 * 1024 {
                    if !collected.is_empty() {
                        collected.push('\n');
                    }
                    collected.push_str(&line);
                }
            }
            let _ = stderr_tx.send(collected);
        });

        let child_monitor = monitor_child(child, stderr_rx);

        let incoming_lines = BufReader::new(child_stdout.compat()).lines();
        let outgoing_sink = futures::sink::unfold(
            child_stdin.compat_write(),
            async move |mut writer, line: String| {
                let mut bytes = line.into_bytes();
                bytes.push(b'\n');
                writer.write_all(&bytes).await?;
                Ok::<_, std::io::Error>(writer)
            },
        );

        let protocol_future =
            ConnectTo::<Client>::connect_to(Lines::new(outgoing_sink, incoming_lines), client);

        tokio::select! {
            r = protocol_future => r,
            r = child_monitor => r,
        }
    }
}

fn spawn_with_pipes(
    mut cmd: Command,
) -> Result<
    (
        tokio::process::ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
        Child,
    ),
    agent_client_protocol::Error,
> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(agent_client_protocol::Error::into_internal_error)?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| agent_client_protocol::util::internal_error("Failed to open stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| agent_client_protocol::util::internal_error("Failed to open stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| agent_client_protocol::util::internal_error("Failed to open stderr"))?;
    Ok((stdin, stdout, stderr, child))
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.start_kill();
    }
}

async fn monitor_child(
    child: Child,
    stderr_rx: tokio::sync::oneshot::Receiver<String>,
) -> Result<(), agent_client_protocol::Error> {
    let mut guard = ChildGuard(child);
    let status = guard.0.wait().await.map_err(|e| {
        agent_client_protocol::util::internal_error(format!("failed to wait for child: {e}"))
    })?;
    if status.success() {
        return Ok(());
    }
    let stderr = stderr_rx.await.unwrap_or_default();
    let msg = if stderr.is_empty() {
        format!("agent exited with {status}")
    } else {
        format!("agent exited with {status}: {stderr}")
    };
    Err(agent_client_protocol::util::internal_error(msg))
}
