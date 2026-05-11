use std::env;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use ssh2::{
    CheckResult, FileStat as SftpFileStat, FileType, KnownHostFileKind, RenameFlags, Session, Sftp,
};
use ssh2_config::{ParseRule, SshConfig};

use super::file::{FileStat, ReadResult, StatKind};
use super::search::SearchHit;
use super::tree::{DirEntry, EntryKind};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone)]
pub struct RemotePath {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
}

#[derive(Serialize)]
pub struct RemoteUploadResult {
    pub local_path: String,
    pub remote_uri: String,
    pub remote_path: String,
    pub size: u64,
}

pub fn parse_remote_path(raw: &str) -> Option<Result<RemotePath, String>> {
    let rest = raw.strip_prefix("ssh://")?;
    Some(parse_remote_path_inner(rest))
}

fn parse_remote_path_inner(rest: &str) -> Result<RemotePath, String> {
    let slash = rest
        .find('/')
        .ok_or_else(|| "remote path must include an absolute path".to_string())?;
    let authority = &rest[..slash];
    let path = percent_decode(&rest[slash..])?;
    if path.is_empty() || !path.starts_with('/') {
        return Err("remote path must be absolute".to_string());
    }

    let (user, host_port) = match authority.rsplit_once('@') {
        Some((u, hp)) if !u.is_empty() => (Some(percent_decode(u)?), hp),
        _ => (None, authority),
    };
    if host_port.is_empty() {
        return Err("remote path is missing a host".to_string());
    }

    let (host, port) = parse_host_port(host_port)?;
    Ok(RemotePath {
        user,
        host,
        port,
        path,
    })
}

fn parse_host_port(raw: &str) -> Result<(String, Option<u16>), String> {
    if let Some(stripped) = raw.strip_prefix('[') {
        let end = stripped
            .find(']')
            .ok_or_else(|| "invalid IPv6 host in remote path".to_string())?;
        let host = stripped[..end].to_string();
        let tail = &stripped[end + 1..];
        let port = if let Some(p) = tail.strip_prefix(':') {
            Some(parse_port(p)?)
        } else {
            None
        };
        return Ok((host, port));
    }

    match raw.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => {
            Ok((host.to_string(), Some(parse_port(port)?)))
        }
        _ => Ok((raw.to_string(), None)),
    }
}

fn parse_port(raw: &str) -> Result<u16, String> {
    raw.parse::<u16>()
        .map_err(|_| format!("invalid ssh port: {raw}"))
}

fn percent_decode(raw: &str) -> Result<String, String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("invalid percent escape in remote path".to_string());
            }
            let hi = from_hex(bytes[i + 1])?;
            let lo = from_hex(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "remote path is not valid UTF-8".to_string())
}

fn from_hex(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err("invalid percent escape in remote path".to_string()),
    }
}

struct SshTarget {
    connect_host: String,
    known_host: String,
    port: u16,
    user: String,
    identities: Vec<PathBuf>,
}

fn resolve_target(remote: &RemotePath) -> Result<SshTarget, String> {
    let rules = ParseRule::ALLOW_UNKNOWN_FIELDS | ParseRule::ALLOW_UNSUPPORTED_FIELDS;
    let config = SshConfig::parse_default_file(rules).unwrap_or_default();
    let params = config.query(&remote.host);
    if params.proxy_jump.as_ref().is_some_and(|p| !p.is_empty()) {
        return Err("ssh ProxyJump is not supported by Terax remote FS yet".to_string());
    }

    let connect_host = params
        .host_name
        .clone()
        .unwrap_or_else(|| remote.host.clone());
    let port = remote.port.or(params.port).unwrap_or(22);
    let user = remote
        .user
        .clone()
        .or(params.user.clone())
        .or_else(local_username)
        .ok_or_else(|| "could not determine ssh username".to_string())?;

    let identities = params.identity_file.unwrap_or_else(default_identities);

    Ok(SshTarget {
        connect_host,
        known_host: remote.host.clone(),
        port,
        user,
        identities,
    })
}

fn local_username() -> Option<String> {
    env::var("USER")
        .ok()
        .or_else(|| env::var("USERNAME").ok())
        .filter(|s| !s.is_empty())
}

fn default_identities() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| home.join(".ssh").join(name))
        .collect()
}

fn connect(remote: &RemotePath) -> Result<(Session, Sftp), String> {
    let target = resolve_target(remote)?;
    let tcp = TcpStream::connect((target.connect_host.as_str(), target.port))
        .map_err(|e| format!("ssh connect failed: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|e| format!("ssh handshake failed: {e}"))?;
    verify_known_host(&session, &target)?;
    authenticate(&session, &target)?;
    let sftp = session
        .sftp()
        .map_err(|e| format!("sftp init failed: {e}"))?;
    Ok((session, sftp))
}

fn verify_known_host(session: &Session, target: &SshTarget) -> Result<(), String> {
    let (key, _) = session
        .host_key()
        .ok_or_else(|| "ssh server did not provide a host key".to_string())?;
    let mut known_hosts = session.known_hosts().map_err(|e| e.to_string())?;

    if let Some(home) = dirs::home_dir() {
        for file in ["known_hosts", "known_hosts2"] {
            let path = home.join(".ssh").join(file);
            if path.exists() {
                known_hosts
                    .read_file(&path, KnownHostFileKind::OpenSSH)
                    .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
            }
        }
    }

    let mut candidates = vec![target.known_host.as_str()];
    if target.connect_host != target.known_host {
        candidates.push(target.connect_host.as_str());
    }
    let check = candidates
        .iter()
        .map(|host| {
            if target.port == 22 {
                known_hosts.check(host, key)
            } else {
                known_hosts.check_port(host, target.port, key)
            }
        })
        .find(|result| !matches!(result, CheckResult::NotFound))
        .unwrap_or(CheckResult::NotFound);

    match check {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err(format!(
            "unknown ssh host: {}. Connect once with normal ssh to trust the host key.",
            target.known_host
        )),
        CheckResult::Mismatch => Err(format!(
            "ssh host key mismatch for {}. Check your known_hosts file.",
            target.known_host
        )),
        CheckResult::Failure => Err(format!(
            "failed to verify ssh host key for {}",
            target.known_host
        )),
    }
}

fn authenticate(session: &Session, target: &SshTarget) -> Result<(), String> {
    if session.userauth_agent(&target.user).is_ok() && session.authenticated() {
        return Ok(());
    }

    for identity in target.identities.iter().filter(|p| p.exists()) {
        if session
            .userauth_pubkey_file(&target.user, None, identity, None)
            .is_ok()
            && session.authenticated()
        {
            return Ok(());
        }
    }

    Err(format!(
        "ssh authentication failed for {}@{}. Use ssh-agent or an unencrypted IdentityFile.",
        target.user, target.known_host
    ))
}

fn remote_path(remote: &RemotePath) -> PathBuf {
    PathBuf::from(&remote.path)
}

fn path_to_remote_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn uri_for_path(remote: &RemotePath, path: &Path) -> String {
    let mut authority = String::new();
    if let Some(user) = &remote.user {
        authority.push_str(user);
        authority.push('@');
    }
    authority.push_str(&remote.host);
    if let Some(port) = remote.port {
        authority.push(':');
        authority.push_str(&port.to_string());
    }
    format!("ssh://{}{}", authority, path_to_remote_string(path))
}

#[tauri::command]
pub fn fs_remote_home(uri: String) -> Result<String, String> {
    let remote = parse_remote_path(&uri)
        .ok_or_else(|| "remote uri must start with ssh://".to_string())??;
    let (_session, sftp) = connect(&remote)?;
    let home = sftp
        .realpath(Path::new("."))
        .unwrap_or_else(|_| PathBuf::from("/"));
    Ok(uri_for_path(&remote, &home))
}

#[tauri::command]
pub fn fs_upload_local_files_to_remote(
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<Vec<RemoteUploadResult>, String> {
    let remote = parse_remote_path(&remote_dir)
        .ok_or_else(|| "remote_dir must start with ssh://".to_string())??;
    let (_session, sftp) = connect(&remote)?;
    let dir = remote_path(&remote);
    let stat = sftp.stat(&dir).map_err(|e| e.to_string())?;
    if stat.file_type() != FileType::Directory {
        return Err(format!(
            "remote destination is not a directory: {}",
            remote.path
        ));
    }

    let mut out = Vec::with_capacity(local_paths.len());
    for local_path in local_paths {
        let local = PathBuf::from(&local_path);
        let meta = std::fs::metadata(&local)
            .map_err(|e| format!("failed to stat {}: {e}", local.display()))?;
        if meta.is_dir() {
            return Err(format!(
                "remote directory upload is not supported yet: {}",
                local.display()
            ));
        }

        let file_name = local
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("local path has no file name: {}", local.display()))?;
        if file_name.chars().any(char::is_control) {
            return Err(format!(
                "file name contains unsupported control characters: {}",
                local.display()
            ));
        }
        let target = unique_remote_child(&sftp, &dir, file_name)?;
        upload_local_file(&sftp, &local, &target)?;
        let remote_path = path_to_remote_string(&target);
        out.push(RemoteUploadResult {
            local_path,
            remote_uri: uri_for_path(&remote, &target),
            remote_path,
            size: meta.len(),
        });
    }

    Ok(out)
}

fn unique_remote_child(sftp: &Sftp, dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let candidate = dir.join(file_name);
    if sftp.stat(&candidate).is_err() {
        return Ok(candidate);
    }

    let name = Path::new(file_name);
    let stem = name
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(file_name);
    let ext = name.extension().and_then(|s| s.to_str());

    for i in 1..=999 {
        let next_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{stem}-{i}.{ext}"),
            _ => format!("{stem}-{i}"),
        };
        let next = dir.join(next_name);
        if sftp.stat(&next).is_err() {
            return Ok(next);
        }
    }

    Err(format!(
        "could not find a free remote filename for {file_name}"
    ))
}

fn upload_local_file(sftp: &Sftp, local: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "remote target has no parent".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "remote target has no file name".to_string())?;
    let tmp = parent.join(format!(".{file_name}.terax-drop.tmp"));

    {
        let mut src = std::fs::File::open(local)
            .map_err(|e| format!("failed to open {}: {e}", local.display()))?;
        let mut dst = sftp.create(&tmp).map_err(|e| e.to_string())?;
        std::io::copy(&mut src, &mut dst).map_err(|e| e.to_string())?;
    }

    sftp.rename(&tmp, target, Some(RenameFlags::ATOMIC))
        .or_else(|_| sftp.rename(&tmp, target, None))
        .map_err(|e| {
            let _ = sftp.unlink(&tmp);
            e.to_string()
        })
}

pub fn read_dir(remote: &RemotePath) -> Result<Vec<DirEntry>, String> {
    let (_session, sftp) = connect(remote)?;
    read_dir_with_sftp(&sftp, &remote_path(remote))
}

pub fn search(
    remote: &RemotePath,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let cap = limit.unwrap_or(200).min(1000);
    let (_session, sftp) = connect(remote)?;
    let root = remote_path(remote);
    let mut out = Vec::with_capacity(cap.min(64));
    search_walk(&sftp, remote, &root, &root, &q, cap, &mut out)?;
    out.sort_by(|a, b| {
        let an = a.name.to_lowercase().contains(&q);
        let bn = b.name.to_lowercase().contains(&q);
        bn.cmp(&an).then(a.rel.len().cmp(&b.rel.len()))
    });
    Ok(out)
}

fn search_walk(
    sftp: &Sftp,
    remote: &RemotePath,
    root: &Path,
    dir: &Path,
    query: &str,
    cap: usize,
    out: &mut Vec<SearchHit>,
) -> Result<(), String> {
    if out.len() >= cap {
        return Ok(());
    }
    for (path, stat) in sftp.readdir(dir).map_err(|e| e.to_string())? {
        if out.len() >= cap {
            break;
        }
        let Some(name) = path.file_name().map(|s| s.to_string_lossy().into_owned()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let rel = match path.strip_prefix(root) {
            Ok(p) => path_to_remote_string(p),
            Err(_) => continue,
        };
        if rel.to_lowercase().contains(query) {
            out.push(SearchHit {
                path: uri_for_path(remote, &path),
                rel: rel.clone(),
                name,
                is_dir: stat.file_type() == FileType::Directory,
            });
        }
        if stat.file_type() == FileType::Directory {
            search_walk(sftp, remote, root, &path, query, cap, out)?;
        }
    }
    Ok(())
}

fn read_dir_with_sftp(sftp: &Sftp, path: &Path) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = sftp
        .readdir(path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|(path, stat)| {
            let name = path.file_name()?.to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let kind = entry_kind(&stat);
            Some(DirEntry {
                name,
                kind,
                size: stat.size.unwrap_or(0),
                mtime: stat.mtime.unwrap_or(0) * 1000,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        let rank = |k: &EntryKind| match k {
            EntryKind::Dir => 0,
            EntryKind::Symlink => 1,
            EntryKind::File => 2,
        };
        rank(&a.kind).cmp(&rank(&b.kind)).then_with(|| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.name.cmp(&b.name))
        })
    });
    Ok(entries)
}

pub fn read_file(remote: &RemotePath) -> Result<ReadResult, String> {
    let (_session, sftp) = connect(remote)?;
    let path = remote_path(remote);
    let stat = sftp.stat(&path).map_err(|e| e.to_string())?;
    let size = stat.size.unwrap_or(0);
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let mut file = sftp.open(&path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(size.min(MAX_READ_BYTES) as usize);
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

pub fn read_bytes(remote: &RemotePath, limit: u64) -> Result<Vec<u8>, String> {
    let (_session, sftp) = connect(remote)?;
    let path = remote_path(remote);
    let stat = sftp.stat(&path).map_err(|e| e.to_string())?;
    let size = stat.size.unwrap_or(0);
    if size > limit {
        return Err(format!(
            "file exceeds binary preview limit: {size} > {limit}"
        ));
    }

    let mut file = sftp.open(&path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(size as usize);
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

pub fn write_file(remote: &RemotePath, content: String) -> Result<(), String> {
    let (_session, sftp) = connect(remote)?;
    let target = remote_path(remote);
    let parent = target
        .parent()
        .ok_or_else(|| "remote path has no parent".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "remote path has no file name".to_string())?;
    let tmp = parent.join(format!(".{file_name}.terax.tmp"));

    {
        let mut file = sftp.create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let rename_result = sftp
        .rename(
            &tmp,
            &target,
            Some(RenameFlags::OVERWRITE | RenameFlags::ATOMIC),
        )
        .or_else(|_| sftp.rename(&tmp, &target, Some(RenameFlags::OVERWRITE)))
        .or_else(|_| {
            let _ = sftp.unlink(&target);
            sftp.rename(&tmp, &target, None)
        });

    rename_result.map_err(|e| {
        let _ = sftp.unlink(&tmp);
        e.to_string()
    })
}

pub fn stat(remote: &RemotePath) -> Result<FileStat, String> {
    let (_session, sftp) = connect(remote)?;
    let stat = sftp
        .lstat(&remote_path(remote))
        .map_err(|e| e.to_string())?;
    Ok(FileStat {
        size: stat.size.unwrap_or(0),
        mtime: stat.mtime.unwrap_or(0) * 1000,
        kind: stat_kind(&stat),
    })
}

pub fn create_file(remote: &RemotePath) -> Result<(), String> {
    let (_session, sftp) = connect(remote)?;
    let path = remote_path(remote);
    if sftp.stat(&path).is_ok() {
        return Err(format!("already exists: {}", remote.path));
    }
    let _file = sftp.create(&path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_dir(remote: &RemotePath) -> Result<(), String> {
    let (_session, sftp) = connect(remote)?;
    let path = remote_path(remote);
    if sftp.stat(&path).is_ok() {
        return Err(format!("already exists: {}", remote.path));
    }
    mkdir_all(&sftp, &path)
}

fn mkdir_all(sftp: &Sftp, path: &Path) -> Result<(), String> {
    let mut acc = PathBuf::from("/");
    for component in path.components().skip(1) {
        acc.push(component);
        if sftp.stat(&acc).is_ok() {
            continue;
        }
        sftp.mkdir(&acc, 0o755).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn rename(from: &RemotePath, to: &RemotePath) -> Result<(), String> {
    if from.user != to.user || from.host != to.host || from.port != to.port {
        return Err("remote rename across different ssh hosts is not supported".to_string());
    }
    let (_session, sftp) = connect(from)?;
    let from_path = remote_path(from);
    let to_path = remote_path(to);
    if sftp.stat(&from_path).is_err() {
        return Err(format!("not found: {}", from.path));
    }
    if sftp.stat(&to_path).is_ok() {
        return Err(format!("already exists: {}", to.path));
    }
    sftp.rename(&from_path, &to_path, Some(RenameFlags::ATOMIC))
        .or_else(|_| sftp.rename(&from_path, &to_path, None))
        .map_err(|e| e.to_string())
}

pub fn delete(remote: &RemotePath) -> Result<(), String> {
    let (_session, sftp) = connect(remote)?;
    delete_path(&sftp, &remote_path(remote))
}

fn delete_path(sftp: &Sftp, path: &Path) -> Result<(), String> {
    let stat = sftp.lstat(path).map_err(|e| e.to_string())?;
    if stat.file_type() == FileType::Directory {
        for (child, _) in sftp.readdir(path).map_err(|e| e.to_string())? {
            delete_path(sftp, &child)?;
        }
        sftp.rmdir(path).map_err(|e| e.to_string())
    } else {
        sftp.unlink(path).map_err(|e| e.to_string())
    }
}

fn entry_kind(stat: &SftpFileStat) -> EntryKind {
    match stat.file_type() {
        FileType::Directory => EntryKind::Dir,
        FileType::Symlink => EntryKind::Symlink,
        _ => EntryKind::File,
    }
}

fn stat_kind(stat: &SftpFileStat) -> StatKind {
    match stat.file_type() {
        FileType::Directory => StatKind::Dir,
        FileType::Symlink => StatKind::Symlink,
        _ => StatKind::File,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_dir, create_file, delete, fs_remote_home, fs_upload_local_files_to_remote,
        parse_remote_path, read_dir, read_file, rename, write_file,
    };
    use crate::modules::fs::file::ReadResult;

    #[test]
    fn parses_basic_remote_path() {
        let remote = parse_remote_path("ssh://devbox/home/app")
            .expect("remote scheme")
            .expect("valid remote path");

        assert_eq!(remote.user, None);
        assert_eq!(remote.host, "devbox");
        assert_eq!(remote.port, None);
        assert_eq!(remote.path, "/home/app");
    }

    #[test]
    fn parses_user_port_and_percent_encoding() {
        let remote = parse_remote_path("ssh://simon@example.com:2222/home/simon/My%20App")
            .expect("remote scheme")
            .expect("valid remote path");

        assert_eq!(remote.user.as_deref(), Some("simon"));
        assert_eq!(remote.host, "example.com");
        assert_eq!(remote.port, Some(2222));
        assert_eq!(remote.path, "/home/simon/My App");
    }

    #[test]
    fn rejects_missing_absolute_path() {
        let err = parse_remote_path("ssh://devbox")
            .expect("remote scheme")
            .expect_err("path is required");

        assert!(err.contains("absolute path"));
    }

    #[test]
    #[ignore = "requires TERAX_REMOTE_TEST_URI=ssh://host/path and mutates that test directory"]
    fn remote_sftp_smoke() {
        let root = std::env::var("TERAX_REMOTE_TEST_URI")
            .expect("set TERAX_REMOTE_TEST_URI=ssh://host/path");
        let root = root.trim_end_matches('/');
        let dir = format!("{root}/nested");
        let file = format!("{dir}/hello.txt");
        let renamed = format!("{dir}/renamed.txt");
        let upload_src =
            std::env::temp_dir().join(format!("terax-upload-smoke-{}.bin", std::process::id()));

        let _ = parse_remote_path(root)
            .expect("remote scheme")
            .and_then(|remote| delete(&remote));

        let home = fs_remote_home(root.to_string()).expect("resolve remote home");
        assert!(home.starts_with("ssh://"));
        assert!(home.contains("/"));

        create_dir(
            &parse_remote_path(&dir)
                .expect("remote scheme")
                .expect("valid remote dir"),
        )
        .expect("create dir");
        create_file(
            &parse_remote_path(&file)
                .expect("remote scheme")
                .expect("valid remote file"),
        )
        .expect("create file");
        write_file(
            &parse_remote_path(&file)
                .expect("remote scheme")
                .expect("valid remote file"),
            "hello from terax\n".to_string(),
        )
        .expect("write file");

        std::fs::write(&upload_src, [0_u8, 1, 2, 3, 4, 5]).expect("write local upload fixture");
        let uploaded = fs_upload_local_files_to_remote(
            vec![upload_src.to_string_lossy().into_owned()],
            dir.clone(),
        )
        .expect("upload local file to remote");
        let _ = std::fs::remove_file(&upload_src);
        assert_eq!(uploaded.len(), 1);
        assert_eq!(uploaded[0].size, 6);
        assert!(uploaded[0].remote_path.ends_with(".bin"));

        let read = read_file(
            &parse_remote_path(&file)
                .expect("remote scheme")
                .expect("valid remote file"),
        )
        .expect("read file");
        match read {
            ReadResult::Text { content, .. } => assert_eq!(content, "hello from terax\n"),
            _ => panic!("expected text read result"),
        }

        let uploaded_read = read_file(
            &parse_remote_path(&uploaded[0].remote_uri)
                .expect("remote scheme")
                .expect("valid uploaded file"),
        )
        .expect("read uploaded binary file");
        match uploaded_read {
            ReadResult::Binary { size } => assert_eq!(size, 6),
            _ => panic!("expected binary read result"),
        }

        rename(
            &parse_remote_path(&file)
                .expect("remote scheme")
                .expect("valid remote file"),
            &parse_remote_path(&renamed)
                .expect("remote scheme")
                .expect("valid remote file"),
        )
        .expect("rename file");

        let entries = read_dir(
            &parse_remote_path(&dir)
                .expect("remote scheme")
                .expect("valid remote dir"),
        )
        .expect("read dir");
        assert!(entries.iter().any(|entry| entry.name == "renamed.txt"));

        delete(
            &parse_remote_path(root)
                .expect("remote scheme")
                .expect("valid remote root"),
        )
        .expect("cleanup remote test dir");
    }
}
