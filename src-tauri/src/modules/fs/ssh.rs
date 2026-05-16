use std::process::Command;

use super::tree::DirEntry;
use crate::modules::workspace::SshConnection;

/// List directory entries on a remote host via SSH.
pub fn ssh_read_dir(
    conn: &SshConnection,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<DirEntry>, String> {
    let quoted_path = sh_quote(path);
    // Build a script that outputs pipe-delimited entries:
    //   kind|size|mtime|name
    // Detects GNU stat (-c) vs BSD stat (-f) automatically.
    let script = format!(
        "cd {0} 2>/dev/null || {{ echo 'ERROR:path not found'; exit 1; }}; \
         LC_ALL=C; \
         for f in *; do \
           if [ -L \"$f\" ]; then k=symlink; \
           elif [ -d \"$f\" ]; then k=dir; \
           else k=file; fi; \
           if command -v stat >/dev/null 2>&1; then \
             if stat -c '%s' . >/dev/null 2>&1; then \
               s=$(stat -c '%s' \"$f\" 2>/dev/null || echo 0); \
               m=$(stat -c '%Y' \"$f\" 2>/dev/null || echo 0); \
             else \
               s=$(stat -f '%z' \"$f\" 2>/dev/null || echo 0); \
               m=$(stat -f '%m' \"$f\" 2>/dev/null || echo 0); \
             fi; \
           else s=0; m=0; fi; \
           printf '%s|%s|%s|%s\\n' \"$k\" \"$s\" \"$m\" \"$f\"; \
         done",
        quoted_path
    );

    if show_hidden {
        let hidden_script = format!(
            "cd {0} 2>/dev/null || {{ echo 'ERROR:path not found'; exit 1; }}; \
             LC_ALL=C; \
             for f in .*; do \
               [ \"$f\" = \".\" -o \"$f\" = \"..\" ] && continue; \
               [ ! -e \"$f\" ] && continue; \
               if [ -L \"$f\" ]; then k=symlink; \
               elif [ -d \"$f\" ]; then k=dir; \
               else k=file; fi; \
               if command -v stat >/dev/null 2>&1; then \
                 if stat -c '%s' . >/dev/null 2>&1; then \
                   s=$(stat -c '%s' \"$f\" 2>/dev/null || echo 0); \
                   m=$(stat -c '%Y' \"$f\" 2>/dev/null || echo 0); \
                 else \
                   s=$(stat -f '%z' \"$f\" 2>/dev/null || echo 0); \
                   m=$(stat -f '%m' \"$f\" 2>/dev/null || echo 0); \
                 fi; \
               else s=0; m=0; fi; \
               printf '%s|%s|%s|%s\\n' \"$k\" \"$s\" \"$m\" \"$f\"; \
             done",
            quoted_path
        );
        run_ssh_script(conn, &format!("({}) && ({})", script, hidden_script))
    } else {
        run_ssh_script(conn, &script)
    }
}

/// List subdirectories on a remote host via SSH.
pub fn ssh_list_subdirs(
    conn: &SshConnection,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<String>, String> {
    let quoted_path = sh_quote(path);
    let script = if show_hidden {
        format!(
            "cd {0} 2>/dev/null || exit 1; \
             for f in * .*; do \
               [ \"$f\" = \".\" -o \"$f\" = \"..\" ] && continue; \
               [ -d \"$f\" ] && echo \"$f\"; \
             done",
            quoted_path
        )
    } else {
        format!(
            "cd {0} 2>/dev/null || exit 1; \
             for f in *; do \
               [ -d \"$f\" ] && echo \"$f\"; \
             done",
            quoted_path
        )
    };
    let output = run_ssh_output(conn, &script)?;
    let mut dirs: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    dirs.sort_by_key(|a| a.to_lowercase());
    Ok(dirs)
}

fn run_ssh_script(conn: &SshConnection, script: &str) -> Result<Vec<DirEntry>, String> {
    let output = run_ssh_output(conn, script)?;
    let mut entries: Vec<DirEntry> = Vec::new();

    if output.starts_with("ERROR:") {
        return Err(output.trim_start_matches("ERROR:").trim().to_string());
    }

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            continue;
        }
        let kind = match parts[0] {
            "dir" => super::tree::EntryKind::Dir,
            "symlink" => super::tree::EntryKind::Symlink,
            _ => super::tree::EntryKind::File,
        };
        let size: u64 = parts[2].parse().unwrap_or(0);
        let mtime_secs: u64 = parts[1].parse().unwrap_or(0);
        let name = parts[3].to_string();
        entries.push(DirEntry {
            name,
            kind,
            size,
            mtime: mtime_secs * 1000,
        });
    }

    // Sort: dirs first, then files, case-insensitive by name
    entries.sort_by(|a, b| {
        let rank = |k: &super::tree::EntryKind| match k {
            super::tree::EntryKind::Dir => 0,
            super::tree::EntryKind::Symlink => 1,
            super::tree::EntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

fn sshpass_available() -> bool {
    std::process::Command::new("sshpass")
        .arg("--version")
        .output()
        .is_ok()
}

fn run_ssh_output(conn: &SshConnection, command: &str) -> Result<String, String> {
    let use_sshpass = conn.password.as_deref().is_some_and(|p| !p.is_empty()) && sshpass_available();

    let (program, pass_args): (&str, Vec<String>) = if use_sshpass {
        (
            "sshpass",
            vec![
                "-p".into(),
                conn.password.clone().unwrap(),
                "ssh".into(),
            ],
        )
    } else {
        ("ssh", vec![])
    };

    let mut cmd = Command::new(program);
    for a in &pass_args {
        cmd.arg(a);
    }
    cmd.arg("-o").arg("ConnectTimeout=5");
    cmd.arg("-o").arg("StrictHostKeyChecking=no");
    cmd.arg("-o").arg("BatchMode=yes");
    cmd.arg("-o").arg("LogLevel=QUIET");

    if let Some(k) = &conn.key_path {
        cmd.arg("-i").arg(k);
    }
    if let Some(p) = conn.port {
        cmd.arg("-p").arg(p.to_string());
    }

    let mut target = String::new();
    if let Some(u) = &conn.user {
        target.push_str(u);
        target.push('@');
    }
    target.push_str(&conn.host);
    cmd.arg(&target);
    cmd.arg(command);

    let output = cmd.output().map_err(|e| format!("SSH failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SSH command failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Minimal shell quoting: wrap in single quotes and escape inner single quotes.
fn sh_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}
