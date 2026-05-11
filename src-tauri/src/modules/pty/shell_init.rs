use std::path::PathBuf;

use portable_pty::CommandBuilder;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct ShellProfile {
    pub name: String,
    pub path: String,
}

pub fn build_command(
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<CommandBuilder, String> {
    #[cfg(unix)]
    {
        unix::build(cwd, shell)
    }
    #[cfg(windows)]
    {
        windows::build(cwd, shell)
    }
}

pub fn list_shells() -> Vec<ShellProfile> {
    #[cfg(unix)]
    {
        unix::list()
    }
    #[cfg(windows)]
    {
        windows::list()
    }
}

fn apply_common(cmd: &mut CommandBuilder, cwd: Option<String>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| dirs::home_dir().filter(|p| p.is_dir()))
        .or_else(|| std::env::current_dir().ok());
    if let Some(cwd) = resolved_cwd {
        #[cfg(windows)]
        let cwd = PathBuf::from(cwd.to_string_lossy().replace('/', "\\"));
        log::info!("pty cwd: {}", cwd.display());
        cmd.cwd(cwd);
    } else {
        log::warn!("pty cwd: no usable directory, inheriting from process");
    }
}

#[cfg(unix)]
mod unix {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    pub enum Shell {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl Shell {
        pub fn detect() -> (Shell, String) {
            let path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            let name = path.rsplit('/').next().unwrap_or("").to_string();
            let shell = match name.as_str() {
                "zsh" => Shell::Zsh,
                "bash" => Shell::Bash,
                "fish" => Shell::Fish,
                _ => Shell::Other,
            };
            (shell, path)
        }
    }

    pub fn build(cwd: Option<String>, override_path: Option<String>) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = match override_path {
            Some(p) if !p.is_empty() => {
                let name = p.rsplit('/').next().unwrap_or("").to_string();
                let kind = match name.as_str() {
                    "zsh" => Shell::Zsh,
                    "bash" => Shell::Bash,
                    "fish" => Shell::Fish,
                    _ => Shell::Other,
                };
                (kind, p)
            }
            _ => Shell::detect(),
        };
        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd);

        match shell {
            Shell::Zsh => {
                match prepare_zdotdir() {
                    Ok(zdotdir) => {
                        if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                            cmd.env("TERAX_USER_ZDOTDIR", user_zd);
                        }
                        cmd.env("ZDOTDIR", zdotdir);
                    }
                    Err(e) => {
                        log::warn!("zsh shell integration disabled: {e}");
                    }
                }
                // Login shell so /etc/zprofile runs path_helper on macOS — without
                // this, GUI-launched apps get a minimal PATH missing Homebrew.
                cmd.arg("-l");
            }
            Shell::Bash => {
                match prepare_bash_rcfile() {
                    Ok(rc) => {
                        cmd.arg("--rcfile");
                        cmd.arg(rc);
                    }
                    Err(e) => {
                        log::warn!("bash shell integration disabled: {e}");
                    }
                }
                // bash ignores --rcfile under -l, so we use -i and source
                // /etc/profile from inside our rcfile to emulate login init.
                cmd.arg("-i");
            }
            Shell::Fish => {
                match prepare_fish_init() {
                    Ok(init) => {
                        cmd.arg("--init-command");
                        cmd.arg(format!("source {}", shell_quote(&init)));
                    }
                    Err(e) => {
                        log::warn!("fish shell integration disabled: {e}");
                    }
                }
                cmd.arg("-i");
            }
            Shell::Other => {
                log::info!(
                    "unsupported shell '{}', spawning without integration",
                    shell_path
                );
            }
        }
        Ok(cmd)
    }

    fn shell_quote(p: &Path) -> String {
        let s = p.to_string_lossy();
        format!("'{}'", s.replace('\'', "'\\''"))
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("terax").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        Ok(rc)
    }

    fn prepare_fish_init() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("fish");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let init = dir.join("init.fish");
        write_if_changed(&init, FISH_INIT)?;
        Ok(init)
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        // Atomic replace: a parallel shell startup must never source a half-written file.
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__terax_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    pub fn list() -> Vec<super::ShellProfile> {
        use std::collections::BTreeSet;
        let mut paths: BTreeSet<String> = BTreeSet::new();

        if let Ok(content) = fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if Path::new(line).is_file() {
                    paths.insert(line.to_string());
                }
            }
        }

        for fallback in [
            "/bin/zsh",
            "/bin/bash",
            "/bin/sh",
            "/usr/bin/zsh",
            "/usr/bin/bash",
            "/usr/bin/fish",
            "/opt/homebrew/bin/fish",
            "/usr/local/bin/fish",
        ] {
            if Path::new(fallback).is_file() {
                paths.insert(fallback.to_string());
            }
        }

        paths
            .into_iter()
            .map(|path| {
                let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                super::ShellProfile { name, path }
            })
            .collect()
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const PROFILE_PS1: &str = include_str!("scripts/profile.ps1");

    pub fn build(cwd: Option<String>, override_path: Option<String>) -> Result<CommandBuilder, String> {
        let shell_path = match override_path {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => super::windows_shell_path(),
        };
        let shell_name = shell_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_powershell = shell_name == "pwsh.exe" || shell_name == "powershell.exe";

        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd);

        if is_powershell {
            match prepare_ps_profile() {
                Ok(profile) => {
                    cmd.arg("-NoLogo");
                    cmd.arg("-NoExit");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(profile);
                }
                Err(e) => {
                    log::warn!("powershell shell integration disabled: {e}");
                }
            }
        } else {
            log::info!("spawning {} without shell integration", shell_name);
        }

        log::info!("spawning Windows shell: {}", shell_path.display());
        Ok(cmd)
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("terax").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_ps_profile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("powershell");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let file = dir.join("profile.ps1");
        write_if_changed(&file, PROFILE_PS1)?;
        Ok(file)
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__terax_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    pub fn list() -> Vec<super::ShellProfile> {
        let mut found: Vec<super::ShellProfile> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        let mut push = |name: &str, path: PathBuf| {
            if !path.is_file() {
                return;
            }
            let key = path.to_string_lossy().to_ascii_lowercase();
            if !seen.insert(key) {
                return;
            }
            found.push(super::ShellProfile {
                name: name.to_string(),
                path: path.to_string_lossy().into_owned(),
            });
        };

        // PowerShell 7 (pwsh)
        if let Some(p) = super::which_in_path("pwsh.exe") {
            push("PowerShell 7", p);
        }
        if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            push(
                "PowerShell 7",
                pf.join("PowerShell").join("7").join("pwsh.exe"),
            );
        }

        // Windows PowerShell 5
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        push(
            "Windows PowerShell",
            system_root
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
        );

        // Command Prompt
        push("Command Prompt", system_root.join("System32").join("cmd.exe"));

        // Git Bash
        let git_bash_candidates = [
            std::env::var_os("ProgramFiles")
                .map(PathBuf::from)
                .map(|p| p.join("Git").join("bin").join("bash.exe")),
            std::env::var_os("ProgramFiles(x86)")
                .map(PathBuf::from)
                .map(|p| p.join("Git").join("bin").join("bash.exe")),
            dirs::home_dir()
                .map(|h| h.join("AppData/Local/Programs/Git/bin/bash.exe")),
        ];
        for c in git_bash_candidates.into_iter().flatten() {
            push("Git Bash", c);
        }

        // WSL
        push("WSL", system_root.join("System32").join("wsl.exe"));

        found
    }
}

#[cfg(windows)]
pub fn windows_shell_path() -> PathBuf {
    if let Some(p) = which_in_path("pwsh.exe") {
        return p;
    }

    if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        let candidate = pf.join("PowerShell").join("7").join("pwsh.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    let system32 = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let ps5 = system32
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        return ps5;
    }

    system32.join("cmd.exe")
}

#[cfg(windows)]
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
