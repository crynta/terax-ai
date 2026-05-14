use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::modules::git::types::{
    GitOutput, TextSource, DEFAULT_TIMEOUT_SECS, MAX_OUTPUT_BYTES, MAX_TIMEOUT_SECS, POLL_INTERVAL,
};

pub fn ensure_git_available() -> Result<(), String> {
    let output = run_git(None, ["--version"], 10)?;
    ensure_success(&output, "git is not available")
}

pub fn git_show_text(repo_root: &Path, spec: &str) -> Result<TextSource, String> {
    let output = run_git_os(
        Some(repo_root),
        [OsStr::new("show"), OsStr::new("--no-textconv"), OsStr::new(spec)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err("git show timed out".into());
    }
    if output.exit_code != Some(0) {
        return Ok(TextSource::Missing);
    }
    decode_text(output.stdout)
}

pub fn git_stdout_line<P, I, S>(cwd: P, args: I, err_prefix: &str) -> Result<String, String>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    match git_stdout_line_opt(cwd, args)? {
        Some(v) => Ok(v),
        None => Err(err_prefix.into()),
    }
}

pub fn git_stdout_line_opt<P, I, S>(cwd: P, args: I) -> Result<Option<String>, String>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git_os(Some(cwd.as_ref()), args, DEFAULT_TIMEOUT_SECS)?;
    if output.timed_out {
        return Err("git command timed out".into());
    }
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        Ok(None)
    } else {
        Ok(Some(line.to_string()))
    }
}

pub fn read_text_file(path: &Path) -> Result<TextSource, String> {
    if !path.exists() {
        return Ok(TextSource::Missing);
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    decode_text(bytes)
}

pub fn run_git<I, S>(cwd: Option<&Path>, args: I, timeout_secs: u64) -> Result<GitOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_git_os(cwd, args, timeout_secs)
}

pub fn run_git_os<I, S>(
    cwd: Option<&Path>,
    args: I,
    timeout_secs: u64,
) -> Result<GitOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let dur = Duration::from_secs(timeout_secs.clamp(1, MAX_TIMEOUT_SECS));
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdout_pipe = child.stdout.take().ok_or("no stdout pipe")?;
    let mut stderr_pipe = child.stderr.take().ok_or("no stderr pipe")?;
    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe));

    let started = Instant::now();
    let mut timed_out = false;
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if started.elapsed() >= dur {
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break None;
        }
        thread::sleep(POLL_INTERVAL);
    };

    let (stdout, _stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr, _stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));

    Ok(GitOutput {
        stdout,
        stderr,
        exit_code,
        timed_out,
    })
}

pub fn ensure_success(output: &GitOutput, context: &str) -> Result<(), String> {
    if output.timed_out {
        return Err(format!("{context}: timed out"));
    }
    if output.exit_code == Some(0) {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown git error".into()
    };
    Err(format!("{context}: {detail}"))
}

fn decode_text(bytes: Vec<u8>) -> Result<TextSource, String> {
    let sniff_len = bytes.len().min(8192);
    if bytes[..sniff_len].contains(&0) {
        return Ok(TextSource::Binary);
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(TextSource::Text(text)),
        Err(_) => Ok(TextSource::Binary),
    }
}

fn drain<R: Read>(reader: &mut R) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_OUTPUT_BYTES {
                    truncated = true;
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
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
