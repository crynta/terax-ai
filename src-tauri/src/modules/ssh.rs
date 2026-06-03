use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::OnceLock;

use crate::modules::git::types::GitOutput;
use crate::modules::workspace::WorkspaceEnv;

const REMOTE_ZSHENV: &str = include_str!("pty/scripts/zshenv.zsh");
const REMOTE_ZPROFILE: &str = include_str!("pty/scripts/zprofile.zsh");
const REMOTE_ZLOGIN: &str = include_str!("pty/scripts/zlogin.zsh");
const REMOTE_ZSHRC: &str = include_str!("pty/scripts/zshrc.zsh");
const REMOTE_BASHRC: &str = include_str!("pty/scripts/bashrc.bash");
const REMOTE_FISH_INIT: &str = include_str!("pty/scripts/init.fish");

const SSH_CONNECT_TIMEOUT_SECS: u64 = 10;
const SSH_COMMAND_TIMEOUT_SECS: u64 = 120;
const REMOTE_STDOUT_LIMIT: usize = 16 * 1024 * 1024;
const REMOTE_STDERR_LIMIT: usize = 16 * 1024;

#[derive(Debug, Serialize)]
struct RemoteRequest<'a> {
    workspace_root: &'a str,
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct RemoteEnvelope<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug)]
struct RemoteOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

pub(crate) fn ssh_endpoint(workspace: &WorkspaceEnv) -> Result<(String, Option<u16>), String> {
    match workspace {
        WorkspaceEnv::Ssh {
            host, user, port, ..
        } => {
            validate_host(host)?;
            if let Some(user) = user {
                validate_user(user)?;
            }
            if port.is_some_and(|port| port == 0) {
                return Err("SSH port must be greater than zero".into());
            }
            Ok((
                match user {
                    Some(user) => format!("{user}@{host}"),
                    None => host.clone(),
                },
                *port,
            ))
        }
        _ => Err("workspace is not SSH".into()),
    }
}

pub(crate) fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn remote_shell_command(cwd: Option<&str>, command: &str) -> String {
    let mut out = String::new();
    if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
        out.push_str("cd ");
        out.push_str(&quote_posix(cwd));
        out.push_str(" && ");
    }
    out.push_str(command);
    out
}

pub(crate) fn remote_shell_invocation(command: &str) -> String {
    format!("sh -lc {}", quote_posix(command))
}

pub(crate) fn remote_login_command(cwd: Option<&str>) -> String {
    remote_shell_command(cwd, &remote_login_shell_bootstrap())
}

pub(crate) fn remote_login_shell_bootstrap() -> String {
    format!(
        r#"shell="${{SHELL:-}}"
if [ -z "$shell" ] || [ ! -x "$shell" ]; then
  for candidate in /bin/bash /usr/bin/bash /bin/sh; do
    if [ -x "$candidate" ]; then
      shell="$candidate"
      break
    fi
  done
fi
if [ -z "$shell" ] || [ ! -x "$shell" ]; then
  shell=/bin/sh
fi
shell_name="${{shell##*/}}"
tmpdir="$(mktemp -d 2>/dev/null || mktemp -d -t terax-ssh)"
cleanup() {{
  rm -rf "$tmpdir"
}}
trap cleanup EXIT HUP INT TERM
case "$shell_name" in
  zsh)
    mkdir -p "$tmpdir"
    cat >"$tmpdir/.zshenv" <<'__TERAX_ZSHENV__'
{REMOTE_ZSHENV}
__TERAX_ZSHENV__
    cat >"$tmpdir/.zprofile" <<'__TERAX_ZPROFILE__'
{REMOTE_ZPROFILE}
__TERAX_ZPROFILE__
    cat >"$tmpdir/.zshrc" <<'__TERAX_ZSHRC__'
{REMOTE_ZSHRC}
__TERAX_ZSHRC__
    cat >"$tmpdir/.zlogin" <<'__TERAX_ZLOGIN__'
{REMOTE_ZLOGIN}
__TERAX_ZLOGIN__
    export TERAX_USER_ZDOTDIR="${{TERAX_USER_ZDOTDIR:-$HOME}}"
    export ZDOTDIR="$tmpdir"
    export TERAX_TERMINAL=1
    exec "$shell" -l
    ;;
  bash)
    cat >"$tmpdir/.terax-bashrc" <<'__TERAX_BASHRC__'
{REMOTE_BASHRC}
__TERAX_BASHRC__
    export TERAX_TERMINAL=1
    exec "$shell" --rcfile "$tmpdir/.terax-bashrc" -i
    ;;
  fish)
    cat >"$tmpdir/.terax-fish.fish" <<'__TERAX_FISH__'
{REMOTE_FISH_INIT}
__TERAX_FISH__
    export TERAX_TERMINAL=1
    exec "$shell" -i -C "source $tmpdir/.terax-fish.fish"
    ;;
  *)
    export TERAX_TERMINAL=1
    exec "$shell" -l
    ;;
esac"#
    )
}

fn ssh_password(workspace: &WorkspaceEnv) -> Option<&str> {
    match workspace {
        WorkspaceEnv::Ssh { password, .. } => password.as_deref().filter(|s| !s.is_empty()),
        _ => None,
    }
}

pub(crate) fn ssh_auth_options(
    workspace: &WorkspaceEnv,
) -> Result<(Vec<String>, Vec<(String, String)>), String> {
    let mut args = vec!["-o".into(), "StrictHostKeyChecking=accept-new".into()];
    args.extend(ssh_multiplex_options()?);
    if let Some(password) = ssh_password(workspace) {
        let askpass = ssh_askpass_path()?;
        args.extend([
            "-o".into(),
            "BatchMode=no".into(),
            "-o".into(),
            "PubkeyAuthentication=no".into(),
            "-o".into(),
            "PreferredAuthentications=password,keyboard-interactive".into(),
            "-o".into(),
            "KbdInteractiveAuthentication=yes".into(),
            "-o".into(),
            "NumberOfPasswordPrompts=1".into(),
        ]);
        Ok((
            args,
            vec![
                ("SSH_ASKPASS".into(), askpass),
                ("SSH_ASKPASS_REQUIRE".into(), "force".into()),
                ("DISPLAY".into(), ":0".into()),
                ("TERAX_SSH_PASSWORD".into(), password.to_string()),
            ],
        ))
    } else {
        args.extend(["-o".into(), "BatchMode=yes".into()]);
        Ok((args, Vec::new()))
    }
}

#[cfg(unix)]
fn ssh_multiplex_options() -> Result<Vec<String>, String> {
    let dir = dirs::home_dir()
        .ok_or_else(|| "home directory is unavailable".to_string())?
        .join(".terax")
        .join("ssh-control");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dir).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&dir, perms).map_err(|e| e.to_string())?;
    }
    let path = dir.join("%C");
    Ok(vec![
        "-o".into(),
        "ControlMaster=auto".into(),
        "-o".into(),
        "ControlPersist=10m".into(),
        "-o".into(),
        format!("ControlPath={}", path.to_string_lossy()),
    ])
}

#[cfg(not(unix))]
fn ssh_multiplex_options() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

fn ssh_askpass_path() -> Result<String, String> {
    static PATH: OnceLock<Result<String, String>> = OnceLock::new();
    PATH.get_or_init(|| {
        let path = std::env::temp_dir().join(if cfg!(windows) {
            "terax-ssh-askpass.cmd"
        } else {
            "terax-ssh-askpass.sh"
        });
        let script = if cfg!(windows) {
            "@echo off\r\nfor %%I in (\"%TERAX_SSH_PASSWORD%\") do @echo %%~I\r\n".to_string()
        } else {
            "#!/bin/sh\nprintf '%s\\n' \"$TERAX_SSH_PASSWORD\"\n".to_string()
        };
        fs::write(&path, script).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .clone()
}

fn validate_host(host: &str) -> Result<(), String> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return Err("SSH host is required".into());
    }
    if trimmed.len() > 255 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("SSH host contains invalid characters".into());
    }
    Ok(())
}

fn validate_user(user: &str) -> Result<(), String> {
    let trimmed = user.trim();
    if trimmed.is_empty() {
        return Err("SSH user is required".into());
    }
    if trimmed.len() > 255
        || trimmed
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '@' | ':' | '\\'))
    {
        return Err("SSH user contains invalid characters".into());
    }
    Ok(())
}

fn validate_root(root: &str) -> Result<(), String> {
    if root.trim().is_empty() {
        return Err("SSH root path is required".into());
    }
    if !root.starts_with('/') {
        return Err("SSH root path must be absolute".into());
    }
    Ok(())
}

fn build_command(
    workspace: &WorkspaceEnv,
    op: &str,
    payload: &serde_json::Value,
) -> Result<Command, String> {
    let (target, port) = ssh_endpoint(workspace)?;
    let root_path = match workspace {
        WorkspaceEnv::Ssh { root_path, .. } => {
            validate_root(root_path)?;
            root_path.as_str()
        }
        _ => return Err("workspace is not SSH".into()),
    };
    let request = RemoteRequest {
        workspace_root: root_path,
        payload: payload.clone(),
    };
    let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let remote = remote_shell_invocation(&format!(
        "python3 - {} {}",
        quote_posix(op),
        quote_posix(&request_json)
    ));
    let (auth_args, auth_envs) = ssh_auth_options(workspace)?;
    let mut cmd = Command::new("ssh");
    cmd.arg("-T");
    cmd.arg("-o")
        .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"));
    for arg in auth_args {
        cmd.arg(arg);
    }
    if let Some(port) = port {
        cmd.arg("-p").arg(port.to_string());
    }
    cmd.arg(target);
    cmd.arg(remote);
    for (key, value) in auth_envs {
        cmd.env(key, value);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(cmd)
}

fn run_remote_json<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    op: &str,
    payload: serde_json::Value,
    timeout_secs: u64,
) -> Result<T, String> {
    let mut cmd = build_command(workspace, op, &payload)?;
    crate::modules::proc::hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin pipe".to_string())?;
    stdin
        .write_all(REMOTE_PYTHON.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(stdin);

    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout pipe".to_string())?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr pipe".to_string())?;

    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe, REMOTE_STDOUT_LIMIT));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe, REMOTE_STDERR_LIMIT));

    let start = Instant::now();
    let dur = Duration::from_secs(timeout_secs.max(1).min(SSH_COMMAND_TIMEOUT_SECS));
    let timed_out = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let _ = status.code();
            break false;
        }
        if start.elapsed() >= dur {
            let _ = child.kill();
            let _ = child.wait().map_err(|e| e.to_string())?;
            break true;
        }
        thread::sleep(Duration::from_millis(50));
    };

    let (stdout, _stdout_truncated) = stdout_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let (stderr, _stderr_truncated) = stderr_handle.join().unwrap_or_else(|_| (Vec::new(), false));

    let output = RemoteOutput {
        stdout,
        stderr,
        timed_out,
    };

    if output.timed_out {
        return Err("SSH command timed out".into());
    }

    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let env: RemoteEnvelope<T> = serde_json::from_str(&stdout_text).map_err(|e| {
        let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr_text.is_empty() {
            format!("{e}: {stderr_text}")
        } else {
            e.to_string()
        }
    })?;
    if !env.ok {
        return Err(env
            .error
            .unwrap_or_else(|| "remote SSH command failed".into()));
    }
    env.data
        .ok_or_else(|| "remote SSH command returned no data".into())
}

fn run_remote_unit(
    workspace: &WorkspaceEnv,
    op: &str,
    payload: serde_json::Value,
    timeout_secs: u64,
) -> Result<(), String> {
    let _: serde_json::Value = run_remote_json(workspace, op, payload, timeout_secs)?;
    Ok(())
}

fn drain<R: Read>(reader: &mut R, limit: usize) -> (Vec<u8>, bool) {
    let mut out: Vec<u8> = Vec::with_capacity(limit.min(4096));
    let mut buf = [0u8; 16 * 1024];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= limit {
                    truncated = true;
                    continue;
                }
                let take = (limit - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

pub fn is_ssh(workspace: &WorkspaceEnv) -> bool {
    matches!(workspace, WorkspaceEnv::Ssh { .. })
}

pub fn workspace_root(workspace: &WorkspaceEnv) -> Option<&str> {
    match workspace {
        WorkspaceEnv::Ssh { root_path, .. } => Some(root_path.as_str()),
        _ => None,
    }
}

pub fn read_dir<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    path: &str,
    show_hidden: bool,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "read_dir",
        serde_json::json!({
            "path": path,
            "show_hidden": show_hidden,
        }),
        timeout_secs,
    )
}

pub fn list_subdirs<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    path: &str,
    show_hidden: bool,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "list_subdirs",
        serde_json::json!({
            "path": path,
            "show_hidden": show_hidden,
        }),
        timeout_secs,
    )
}

pub fn read_file<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "read_file",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn write_file(
    workspace: &WorkspaceEnv,
    path: &str,
    content: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    run_remote_unit(
        workspace,
        "write_file",
        serde_json::json!({
            "path": path,
            "content": content,
        }),
        timeout_secs,
    )
}

pub fn stat<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "stat",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn canonicalize<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "canonicalize",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn create_file(workspace: &WorkspaceEnv, path: &str, timeout_secs: u64) -> Result<(), String> {
    run_remote_unit(
        workspace,
        "create_file",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn create_dir(workspace: &WorkspaceEnv, path: &str, timeout_secs: u64) -> Result<(), String> {
    run_remote_unit(
        workspace,
        "create_dir",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn rename(
    workspace: &WorkspaceEnv,
    from: &str,
    to: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    run_remote_unit(
        workspace,
        "rename",
        serde_json::json!({
            "from": from,
            "to": to,
        }),
        timeout_secs,
    )
}

pub fn delete(workspace: &WorkspaceEnv, path: &str, timeout_secs: u64) -> Result<(), String> {
    run_remote_unit(
        workspace,
        "delete",
        serde_json::json!({ "path": path }),
        timeout_secs,
    )
}

pub fn search<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    root: &str,
    query: &str,
    limit: Option<usize>,
    show_hidden: bool,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "search",
        serde_json::json!({
            "root": root,
            "query": query,
            "limit": limit,
            "show_hidden": show_hidden,
        }),
        timeout_secs,
    )
}

pub fn list_files<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    root: &str,
    limit: Option<usize>,
    max_depth: Option<usize>,
    show_hidden: bool,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "list_files",
        serde_json::json!({
            "root": root,
            "limit": limit,
            "max_depth": max_depth,
            "show_hidden": show_hidden,
        }),
        timeout_secs,
    )
}

pub fn grep<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    pattern: &str,
    root: &str,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "grep",
        serde_json::json!({
            "pattern": pattern,
            "root": root,
            "glob": glob,
            "case_insensitive": case_insensitive,
            "max_results": max_results,
        }),
        timeout_secs,
    )
}

pub fn glob<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    pattern: &str,
    root: &str,
    max_results: Option<usize>,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "glob",
        serde_json::json!({
            "pattern": pattern,
            "root": root,
            "max_results": max_results,
        }),
        timeout_secs,
    )
}

pub fn git<T: DeserializeOwned>(
    workspace: &WorkspaceEnv,
    cwd: &str,
    args: Vec<String>,
    timeout_secs: u64,
) -> Result<T, String> {
    run_remote_json(
        workspace,
        "git",
        serde_json::json!({
            "cwd": cwd,
            "args": args,
        }),
        timeout_secs,
    )
}

#[derive(Deserialize)]
struct RemoteGitOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
}

pub(crate) fn git_output(
    workspace: &WorkspaceEnv,
    cwd: &str,
    args: Vec<String>,
    timeout_secs: u64,
) -> Result<GitOutput, String> {
    let out: RemoteGitOutput = git(workspace, cwd, args, timeout_secs)?;
    Ok(GitOutput {
        stdout: out.stdout.into_bytes(),
        stderr: out.stderr.into_bytes(),
        exit_code: out.exit_code,
        timed_out: out.timed_out,
        truncated: out.truncated,
    })
}

const REMOTE_PYTHON: &str = r#"
import fnmatch
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile

MAX_READ_BYTES = 10 * 1024 * 1024
BINARY_SNIFF_BYTES = 8192
MAX_SCANNED = 50000
PRUNE_DIRS = {
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
}

def emit(ok, data=None, error=None):
    payload = {"ok": ok, "data": data, "error": error}
    print(json.dumps(payload, ensure_ascii=False))

def fail(message):
    emit(False, error=message)
    sys.exit(1)

def load_request():
    if len(sys.argv) < 3:
        fail("missing remote request")
    op = sys.argv[1]
    try:
        req = json.loads(sys.argv[2])
    except Exception as exc:
        fail(f"invalid request envelope: {exc}")
    payload = req.get("payload") or {}
    root = req.get("workspace_root")
    if not isinstance(root, str) or not root:
        fail("workspace root is required")
    return op, root, payload

def real(path):
    return os.path.realpath(path)

def within(root, path):
    root = real(root)
    path = real(path)
    if root == os.sep:
        return True
    if path == root:
        return True
    prefix = root.rstrip(os.sep) + os.sep
    return path.startswith(prefix)

def assert_under(root, path):
    if not within(root, path):
        raise ValueError(f"path escapes workspace root: {path}")
    return path

def abs_path(root, path):
    if not isinstance(path, str) or not path:
        raise ValueError("path is required")
    if not os.path.isabs(path):
        raise ValueError("path must be absolute")
    return assert_under(root, path)

def stat_entry(path):
    try:
        st = os.stat(path, follow_symlinks=True)
        kind = "symlink" if os.path.islink(path) else ("dir" if stat.S_ISDIR(st.st_mode) else "file")
    except FileNotFoundError:
        st = os.lstat(path)
        kind = "symlink" if stat.S_ISLNK(st.st_mode) else ("dir" if stat.S_ISDIR(st.st_mode) else "file")
    return {
        "kind": kind,
        "size": int(st.st_size),
        "mtime": int(getattr(st, "st_mtime", 0) * 1000),
    }

def list_dir(root, path, show_hidden):
    p = abs_path(root, path)
    if not os.path.isdir(p):
        raise ValueError(f"not a directory: {path}")
    entries = []
    with os.scandir(p) as it:
        for entry in it:
            name = entry.name
            if name.startswith(".") and not show_hidden:
                continue
            try:
                meta = entry.stat(follow_symlinks=True)
                is_link = entry.is_symlink()
                kind = "symlink" if is_link else ("dir" if stat.S_ISDIR(meta.st_mode) else "file")
            except FileNotFoundError:
                meta = entry.stat(follow_symlinks=False)
                kind = "symlink" if stat.S_ISLNK(meta.st_mode) else ("dir" if stat.S_ISDIR(meta.st_mode) else "file")
            entries.append({
                "name": name,
                "kind": kind,
                "size": int(meta.st_size),
                "mtime": int(getattr(meta, "st_mtime", 0) * 1000),
            })
    rank = {"dir": 0, "symlink": 1, "file": 2}
    entries.sort(key=lambda e: (rank.get(e["kind"], 3), e["name"].lower()))
    return entries

def list_subdirs(root, path, show_hidden):
    p = abs_path(root, path)
    if not os.path.isdir(p):
        raise ValueError(f"not a directory: {path}")
    dirs = []
    with os.scandir(p) as it:
        for entry in it:
            name = entry.name
            if name.startswith(".") and not show_hidden:
                continue
            try:
                is_dir = entry.is_dir(follow_symlinks=True)
            except FileNotFoundError:
                is_dir = False
            if is_dir:
                dirs.append(name)
    dirs.sort(key=lambda s: s.lower())
    return dirs

def classify_bytes(data):
    sniff = data[:BINARY_SNIFF_BYTES]
    if b"\0" in sniff:
        return {"kind": "binary", "size": len(data)}
    try:
        return {"kind": "text", "content": data.decode("utf-8"), "size": len(data)}
    except UnicodeDecodeError:
        return {"kind": "binary", "size": len(data)}

def read_file(root, path):
    p = abs_path(root, path)
    st = os.stat(p, follow_symlinks=True)
    size = int(st.st_size)
    if size > MAX_READ_BYTES:
        return {"kind": "toolarge", "size": size, "limit": MAX_READ_BYTES}
    with open(p, "rb") as fh:
        data = fh.read()
    result = classify_bytes(data)
    if result["kind"] == "text":
        result["size"] = size
    return result

def atomic_write(path, content):
    parent = os.path.dirname(path)
    if not parent:
        raise ValueError("path has no parent")
    if not os.path.isdir(parent):
        raise ValueError(f"parent directory missing: {parent}")
    fd, tmp = tempfile.mkstemp(prefix=".terax-", dir=parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        if os.path.exists(path):
            try:
                perms = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
            except FileNotFoundError:
                perms = None
        else:
            perms = None
        os.replace(tmp, path)
        if perms is not None:
            os.chmod(path, perms)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def write_file(root, path, content):
    p = abs_path(root, path)
    parent = os.path.dirname(p)
    if not os.path.isdir(parent):
        raise ValueError(f"parent directory missing: {parent}")
    atomic_write(p, content.encode("utf-8"))
    return None

def canonicalize(root, path):
    p = abs_path(root, path)
    canon = os.path.realpath(p)
    return assert_under(root, canon)

def create_file(root, path):
    p = abs_path(root, path)
    parent = os.path.dirname(p)
    if not os.path.isdir(parent):
        raise ValueError(f"parent directory missing: {parent}")
    if os.path.exists(p):
        raise ValueError(f"already exists: {p}")
    with open(p, "x", encoding="utf-8"):
        pass
    return None

def create_dir(root, path):
    p = abs_path(root, path)
    if os.path.exists(p):
        raise ValueError(f"already exists: {p}")
    os.makedirs(p, exist_ok=False)
    return None

def rename(root, src, dst):
    a = abs_path(root, src)
    b = abs_path(root, dst)
    if not os.path.exists(a):
        raise ValueError(f"not found: {a}")
    if os.path.exists(b):
        raise ValueError(f"already exists: {b}")
    os.rename(a, b)
    return None

def delete(root, path):
    p = abs_path(root, path)
    if not os.path.lexists(p):
        raise ValueError(f"not found: {p}")
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p)
    else:
        os.unlink(p)
    return None

def safe_name(name):
    if not name or len(name) > 255:
        return False
    return not any(c in name for c in "\\\x00\r\n\t")

def search(root, query, limit, show_hidden):
    q = (query or "").strip().lower()
    if not q:
        return {"hits": [], "truncated": False}
    cap = min(int(limit or 200), 1000)
    hits = []
    scanned = 0
    truncated = False
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        rel = os.path.relpath(current, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        if depth > 64:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in PRUNE_DIRS and (show_hidden or not d.startswith("."))]
        current_name = os.path.basename(current)
        if current != root:
            scanned += 1
            if scanned > MAX_SCANNED:
                truncated = True
                break
        names = list(dirs) + list(files)
        for name in names:
            if not show_hidden and name.startswith("."):
                continue
            path = os.path.join(current, name)
            rel_path = os.path.relpath(path, root).replace(os.sep, "/")
            if q not in rel_path.lower():
                continue
            is_dir = os.path.isdir(path)
            hits.append({
                "path": path.replace(os.sep, "/"),
                "rel": rel_path,
                "name": name,
                "is_dir": is_dir,
            })
            if len(hits) >= cap:
                truncated = True
                return {"hits": hits, "truncated": truncated}
        if current_name in PRUNE_DIRS:
            dirs[:] = []
    hits.sort(key=lambda h: (q not in h["name"].lower(), len(h["rel"])))
    return {"hits": hits, "truncated": truncated}

def list_files(root, limit, max_depth, show_hidden):
    cap = max(1, min(int(limit or 2000), 10000))
    depth_limit = max(1, min(int(max_depth or 8), 16))
    files = []
    scanned = 0
    truncated = False
    for current, dirs, filenames in os.walk(root, topdown=True, followlinks=False):
        rel = os.path.relpath(current, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        if depth > depth_limit:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in PRUNE_DIRS and (show_hidden or not d.startswith("."))]
        for name in filenames:
            if not show_hidden and name.startswith("."):
                continue
            path = os.path.join(current, name)
            rel_path = os.path.relpath(path, root).replace(os.sep, "/")
            files.append(rel_path)
            if len(files) >= cap:
                truncated = True
                return {"files": sorted(files, key=lambda s: s.lower()), "truncated": truncated}
        scanned += 1
        if scanned > MAX_SCANNED:
            truncated = True
            break
    files.sort(key=lambda s: s.lower())
    return {"files": files, "truncated": truncated}

def matches_globs(rel, globs):
    if not globs:
        return True
    return any(fnmatch.fnmatch(rel, pat) for pat in globs)

def grep(root, pattern, globs, case_insensitive, max_results):
    pat = pattern or ""
    if not pat.strip():
        return {"hits": [], "truncated": False, "files_scanned": 0}
    if case_insensitive:
        pat_cmp = pat.lower()
    else:
        pat_cmp = pat
    cap = min(int(max_results or 200), 1000)
    hits = []
    files_scanned = 0
    truncated = False
    for current, dirs, filenames in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if d not in PRUNE_DIRS]
        for name in filenames:
            rel = os.path.relpath(os.path.join(current, name), root).replace(os.sep, "/")
            if not matches_globs(rel, globs):
                continue
            files_scanned += 1
            if files_scanned > MAX_SCANNED:
                truncated = True
                return {"hits": hits, "truncated": truncated, "files_scanned": files_scanned}
            try:
                with open(os.path.join(current, name), "r", encoding="utf-8") as fh:
                    for idx, line in enumerate(fh, 1):
                        text = line.rstrip("\n")
                        cmp = text.lower() if case_insensitive else text
                        if pat_cmp in cmp:
                            hits.append({
                                "path": rel.replace(os.sep, "/"),
                                "rel": rel.replace(os.sep, "/"),
                                "line": idx,
                                "text": text,
                            })
                            if len(hits) >= cap:
                                return {"hits": hits, "truncated": True, "files_scanned": files_scanned}
            except (UnicodeDecodeError, OSError):
                continue
    return {"hits": hits, "truncated": truncated, "files_scanned": files_scanned}

def glob_search(root, pattern, max_results):
    pat = pattern or ""
    cap = min(int(max_results or 200), 1000)
    hits = []
    for current, dirs, filenames in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if d not in PRUNE_DIRS]
        for name in filenames + dirs:
            rel = os.path.relpath(os.path.join(current, name), root).replace(os.sep, "/")
            if fnmatch.fnmatch(rel, pat):
                hits.append({"path": os.path.join(current, name).replace(os.sep, "/"), "rel": rel})
                if len(hits) >= cap:
                    return {"hits": hits, "truncated": True}
    hits.sort(key=lambda h: h["rel"].lower())
    return {"hits": hits, "truncated": False}

def git_run(cwd, args):
    if not isinstance(cwd, str) or not cwd:
        raise ValueError("cwd is required")
    if not os.path.isabs(cwd):
        raise ValueError("cwd must be absolute")
    proc = subprocess.run(
        ["git"] + list(args or []),
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        env=dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_ASKPASS="", SSH_ASKPASS=""),
    )
    return {
        "stdout": proc.stdout.decode("utf-8", errors="replace"),
        "stderr": proc.stderr.decode("utf-8", errors="replace"),
        "exit_code": proc.returncode,
        "timed_out": False,
        "truncated": False,
    }

def main():
    op, root, payload = load_request()
    try:
        if op == "read_dir":
            emit(True, list_dir(root, payload.get("path"), bool(payload.get("show_hidden"))))
        elif op == "list_subdirs":
            emit(True, list_subdirs(root, payload.get("path"), bool(payload.get("show_hidden"))))
        elif op == "read_file":
            emit(True, read_file(root, payload.get("path")))
        elif op == "write_file":
            write_file(root, payload.get("path"), payload.get("content", ""))
            emit(True, {})
        elif op == "stat":
            p = abs_path(root, payload.get("path"))
            emit(True, stat_entry(p))
        elif op == "canonicalize":
            emit(True, canonicalize(root, payload.get("path")))
        elif op == "create_file":
            create_file(root, payload.get("path"))
            emit(True, {})
        elif op == "create_dir":
            create_dir(root, payload.get("path"))
            emit(True, {})
        elif op == "rename":
            rename(root, payload.get("from"), payload.get("to"))
            emit(True, {})
        elif op == "delete":
            delete(root, payload.get("path"))
            emit(True, {})
        elif op == "search":
            target = abs_path(root, payload.get("root"))
            emit(True, search(target, payload.get("query", ""), payload.get("limit"), bool(payload.get("show_hidden"))))
        elif op == "list_files":
            target = abs_path(root, payload.get("root"))
            emit(True, list_files(target, payload.get("limit"), payload.get("max_depth"), bool(payload.get("show_hidden"))))
        elif op == "grep":
            target = abs_path(root, payload.get("root"))
            emit(True, grep(target, payload.get("pattern", ""), payload.get("glob"), payload.get("case_insensitive"), payload.get("max_results")))
        elif op == "glob":
            target = abs_path(root, payload.get("root"))
            emit(True, glob_search(target, payload.get("pattern", ""), payload.get("max_results")))
        elif op == "git":
            cwd = abs_path(root, payload.get("cwd"))
            emit(True, git_run(cwd, payload.get("args")))
        else:
            fail(f"unsupported op: {op}")
    except Exception as exc:
        emit(False, error=str(exc))

if __name__ == "__main__":
    main()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_login_shell_bootstrap_falls_back_to_common_shells() {
        let script = remote_login_shell_bootstrap();
        assert!(script.contains("/bin/bash"));
        assert!(script.contains("/usr/bin/bash"));
        assert!(script.contains("/bin/sh"));
        assert!(script.contains("exec \"$shell\" -l"));
    }

    #[test]
    fn remote_shell_invocation_wraps_command_in_single_shell_argument() {
        assert_eq!(remote_shell_invocation("echo hi"), "sh -lc 'echo hi'");
    }

    #[test]
    fn ssh_auth_options_enable_askpass_when_password_present() {
        let workspace = WorkspaceEnv::Ssh {
            id: "ssh-1".into(),
            label: "ssh".into(),
            host: "example.com".into(),
            user: Some("alice".into()),
            port: Some(22),
            root_path: "/srv/app".into(),
            password: Some("secret".into()),
        };
        let (args, envs) = ssh_auth_options(&workspace).expect("options");
        assert!(args.windows(2).any(|w| w == ["-o", "ControlMaster=auto"]));
        assert!(args.windows(2).any(|w| w == ["-o", "ControlPersist=10m"]));
        assert!(args.windows(2).any(|w| w == ["-o", "BatchMode=no"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["-o", "PubkeyAuthentication=no"]));
        assert!(envs.iter().any(|(k, _)| k == "SSH_ASKPASS"));
        assert!(envs
            .iter()
            .any(|(k, v)| k == "TERAX_SSH_PASSWORD" && v == "secret"));
    }

    #[test]
    fn ssh_auth_options_use_batchmode_when_password_missing() {
        let workspace = WorkspaceEnv::Ssh {
            id: "ssh-1".into(),
            label: "ssh".into(),
            host: "example.com".into(),
            user: Some("alice".into()),
            port: Some(22),
            root_path: "/srv/app".into(),
            password: None,
        };
        let (args, envs) = ssh_auth_options(&workspace).expect("options");
        assert!(args
            .windows(2)
            .any(|w| w == ["-o", "StrictHostKeyChecking=accept-new"]));
        assert!(args.windows(2).any(|w| w == ["-o", "ControlMaster=auto"]));
        assert!(args.windows(2).any(|w| w == ["-o", "ControlPersist=10m"]));
        assert!(args.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(envs.is_empty());
    }
}
