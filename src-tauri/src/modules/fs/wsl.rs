use super::file::{FileStat, ReadResult, StatKind};
use super::tree::{DirEntry, EntryKind};
use crate::modules::fs::to_canon;
use std::process::Command;

pub fn wsl_read_dir(distro: &str, path: &str, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let script = format!(
        "cd {0} && for f in {1}; do \
           [ \"$f\" = \".\" -o \"$f\" = \"..\" ] && continue; \
           if [ -L \"$f\" ]; then k=symlink; \
           elif [ -d \"$f\" ]; then k=dir; \
           else k=file; fi; \
           s=$(stat -c '%s' \"$f\" 2>/dev/null || echo 0); \
           m=$(stat -c '%Y' \"$f\" 2>/dev/null || echo 0); \
           printf '%s|%s|%s|%s\\n' \"$k\" \"$s\" \"$m\" \"$f\"; \
         done",
        sh_quote(path),
        if show_hidden { "* .*" } else { "*" }
    );

    let output = run_wsl_output(distro, &script)?;
    let mut entries = Vec::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            continue;
        }
        let kind = match parts[0] {
            "dir" => EntryKind::Dir,
            "symlink" => EntryKind::Symlink,
            _ => EntryKind::File,
        };
        let size: u64 = parts[1].parse().unwrap_or(0);
        let mtime: u64 = parts[2].parse().unwrap_or(0);
        let name = parts[3].to_string();
        entries.push(DirEntry {
            name,
            kind,
            size,
            mtime: mtime * 1000,
        });
    }
    Ok(entries)
}

pub fn wsl_read_file(distro: &str, path: &str) -> Result<ReadResult, String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "--exec", "cat", path]);
    let out = cmd.output().map_err(|e| format!("WSL failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "WSL read failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let bytes = out.stdout;
    let size = bytes.len() as u64;

    // Simple sniff for binary
    if bytes.iter().take(1024).any(|&b| b == 0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

pub fn wsl_write_file(distro: &str, path: &str, content: &str) -> Result<(), String> {
    let mut child = Command::new("wsl.exe")
        .args([
            "-d",
            distro,
            "--exec",
            "sh",
            "-c",
            &format!("cat > {}", sh_quote(path)),
        ])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("WSL spawn failed: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("WSL write failed: {e}"))?;
    }
    let status = child.wait().map_err(|e| format!("WSL wait failed: {e}"))?;
    if !status.success() {
        return Err("WSL write failed".into());
    }
    Ok(())
}

pub fn wsl_stat(distro: &str, path: &str) -> Result<FileStat, String> {
    let script = format!("stat -c '%s|%Y|%F' {}", sh_quote(path));
    let output = run_wsl_output(distro, &script)?;
    let parts: Vec<&str> = output.trim().split('|').collect();
    if parts.len() < 3 {
        return Err("WSL stat failed".into());
    }

    let size: u64 = parts[0].parse().unwrap_or(0);
    let mtime: u64 = parts[1].parse().unwrap_or(0);
    let kind = if parts[2].contains("directory") {
        StatKind::Dir
    } else if parts[2].contains("symbolic link") {
        StatKind::Symlink
    } else {
        StatKind::File
    };

    Ok(FileStat {
        size,
        mtime: mtime * 1000,
        kind,
    })
}

fn run_wsl_output(distro: &str, script: &str) -> Result<String, String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro, "--exec", "sh", "-c", script]);
    let out = cmd.output().map_err(|e| format!("WSL failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "WSL command failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
