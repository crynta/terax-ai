use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::modules::fs::file::{FileStat, ReadResult, StatKind};
use crate::modules::fs::tree::{DirEntry, EntryKind};
use super::connection::SshConn;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

pub async fn sftp_read_dir(conn: &SshConn, path: &str, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let read_dir = conn.sftp.read_dir(path).await.map_err(|e| e.to_string())?;
    let mut result: Vec<DirEntry> = read_dir
        .into_iter()
        .filter(|e| show_hidden || !e.file_name().starts_with('.'))
        .map(|e| {
            let meta = e.metadata();
            let ft = meta.file_type();
            DirEntry {
                name: e.file_name(),
                kind: if ft.is_dir() {
                    EntryKind::Dir
                } else if ft.is_symlink() {
                    EntryKind::Symlink
                } else {
                    EntryKind::File
                },
                size: meta.size.unwrap_or(0),
                mtime: meta.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            }
        })
        .collect();
    result.sort_by(|a, b| {
        let ak = matches!(a.kind, EntryKind::Dir);
        let bk = matches!(b.kind, EntryKind::Dir);
        bk.cmp(&ak)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
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
    let ft = meta.file_type();
    let kind = if ft.is_dir() {
        StatKind::Dir
    } else if ft.is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    Ok(FileStat {
        size: meta.size.unwrap_or(0),
        mtime: meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        kind,
    })
}

pub async fn sftp_create_file(conn: &SshConn, path: &str) -> Result<(), String> {
    if conn.sftp.try_exists(path).await.map_err(|e| e.to_string())? {
        return Err(format!("already exists: {path}"));
    }
    let mut f = conn.sftp.create(path).await.map_err(|e| e.to_string())?;
    f.flush().await.map_err(|e| e.to_string())
}

pub async fn sftp_create_dir(conn: &SshConn, path: &str) -> Result<(), String> {
    if conn.sftp.try_exists(path).await.map_err(|e| e.to_string())? {
        return Err(format!("already exists: {path}"));
    }
    conn.sftp.create_dir(path).await.map_err(|e| e.to_string())
}

pub async fn sftp_rename(conn: &SshConn, from: &str, to: &str) -> Result<(), String> {
    conn.sftp.rename(from, to).await.map_err(|e| e.to_string())
}

pub async fn sftp_delete(conn: &SshConn, path: &str) -> Result<(), String> {
    let meta = conn.sftp.metadata(path).await.map_err(|e| e.to_string())?;
    if meta.file_type().is_dir() {
        conn.sftp.remove_dir(path).await.map_err(|e| e.to_string())
    } else {
        conn.sftp.remove_file(path).await.map_err(|e| e.to_string())
    }
}

pub async fn sftp_search(conn: &SshConn, path: &str, query: &str) -> Result<Vec<String>, String> {
    let iname_pattern = format!("*{query}*");
    let cmd = format!(
        "find {} -maxdepth 10 -iname {} 2>/dev/null",
        shell_escape(path),
        shell_escape(&iname_pattern)
    );
    let output = run_remote_command(conn, &cmd).await?;
    Ok(output.lines().map(|l| l.to_string()).collect())
}

pub async fn sftp_grep(conn: &SshConn, path: &str, pattern: &str) -> Result<Vec<String>, String> {
    let cmd = format!(
        "grep -rn --include='*' {} {} 2>/dev/null",
        shell_escape(pattern),
        shell_escape(path)
    );
    let output = run_remote_command(conn, &cmd).await?;
    Ok(output.lines().map(|l| l.to_string()).collect())
}

pub async fn run_remote_command(conn: &SshConn, cmd: &str) -> Result<String, String> {
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
