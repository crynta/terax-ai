// Shell integration layer.
//
// Emits OSC 7 (current working directory) and OSC 133 A/B/C/D
// (prompt-start / prompt-end / pre-exec / command-done-with-exit-code) so the
// frontend can detect command boundaries and track cwd without re-parsing the
// prompt.
//
// Platform support:
// - Unix (macOS/Linux): zsh, bash via injected rc files
// - Windows: PowerShell, CMD, Git Bash via injected scripts

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
const BASHRC: &str = include_str!("scripts/bashrc.bash");

#[cfg(target_os = "windows")]
const POWERSHELL_PROFILE: &str = include_str!("scripts/powershell.ps1");

#[cfg(target_os = "windows")]
const CMD_AUTORUN: &str = include_str!("scripts/cmd.bat");

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum ShellKind {
    Zsh,
    Bash,
    PowerShell,
    Cmd,
    Other,
}

impl ShellKind {
    #[allow(dead_code)]
    pub fn is_unix_shell(&self) -> bool {
        matches!(self, ShellKind::Zsh | ShellKind::Bash)
    }

    #[allow(dead_code)]
    pub fn is_windows_shell(&self) -> bool {
        matches!(self, ShellKind::PowerShell | ShellKind::Cmd)
    }
}

pub struct DetectedShell {
    pub kind: ShellKind,
    pub path: String,
    #[allow(dead_code)]
    pub is_login_shell: bool,
}

impl DetectedShell {
    pub fn detect() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::detect_windows()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::detect_unix()
        }
    }

    #[cfg(target_os = "windows")]
    fn detect_windows() -> Self {
        // First check $SHELL - Git Bash users may have this set
        if let Ok(shell) = std::env::var("SHELL") {
            let name = Path::new(&shell)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if name == "bash" || name.ends_with("bash.exe") {
                return Self {
                    kind: ShellKind::Bash,
                    path: shell,
                    is_login_shell: true,
                };
            }
        }

        // Check for PowerShell 7 (pwsh)
        if which::which("pwsh").is_ok() {
            let pwsh_path = which::which("pwsh").unwrap();
            return Self {
                kind: ShellKind::PowerShell,
                path: pwsh_path.to_string_lossy().into_owned(),
                is_login_shell: true,
            };
        }

        // Check for Windows PowerShell (powershell)
        if which::which("powershell").is_ok() {
            let ps_path = which::which("powershell").unwrap();
            return Self {
                kind: ShellKind::PowerShell,
                path: ps_path.to_string_lossy().into_owned(),
                is_login_shell: true,
            };
        }

        // Fall back to CMD
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        Self {
            kind: ShellKind::Cmd,
            path: comspec,
            is_login_shell: false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn detect_unix() -> Self {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let name = Path::new(&shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("zsh")
            .to_string();

        let kind = match name.as_str() {
            "zsh" => ShellKind::Zsh,
            "bash" => ShellKind::Bash,
            _ => ShellKind::Other,
        };

        Self {
            kind,
            path: shell,
            is_login_shell: true,
        }
    }
}

pub fn build_command(cwd: Option<String>) -> Result<CommandBuilder, String> {
    let shell = DetectedShell::detect();
    log::info!("detected shell: {:?} at {}", shell.kind, shell.path);

    let mut cmd = CommandBuilder::new(&shell.path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");

    // Resolve working directory
    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .or_else(|| {
            #[cfg(target_os = "windows")]
            {
                std::env::var_os("USERPROFILE").map(PathBuf::from).filter(|p| p.is_dir())
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_dir())
            }
        });

    if let Some(cwd) = resolved_cwd {
        cmd.cwd(cwd);
    }

    match shell.kind {
        ShellKind::Zsh => build_zsh_command(&mut cmd),
        ShellKind::Bash => build_bash_command(&mut cmd),
        ShellKind::PowerShell => build_powershell_command(&mut cmd),
        ShellKind::Cmd => build_cmd_command(&mut cmd),
        ShellKind::Other => {
            log::warn!("unsupported shell '{}', spawning without integration", shell.path);
        }
    }

    Ok(cmd)
}

fn build_zsh_command(cmd: &mut CommandBuilder) {
    match prepare_zdotdir() {
        Ok(zdotdir) => {
            if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                cmd.env("TERAX_USER_ZDOTDIR", user_zd);
            }
            cmd.env("ZDOTDIR", zdotdir.to_string_lossy().as_ref());
        }
        Err(e) => {
            log::warn!("zsh shell integration disabled: {e}");
        }
    }
    cmd.arg("-l");
}

fn build_bash_command(cmd: &mut CommandBuilder) {
    match prepare_bash_rcfile() {
        Ok(rc) => {
            cmd.arg("--rcfile");
            cmd.arg(rc.to_string_lossy().as_ref());
        }
        Err(e) => {
            log::warn!("bash shell integration disabled: {e}");
        }
    }
    cmd.arg("-i");
}

fn build_powershell_command(cmd: &mut CommandBuilder) {
    #[cfg(target_os = "windows")]
    {
        match prepare_powershell_profile() {
            Ok(profile_path) => {
                cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
                cmd.arg(format!(
                    ". '{}'; {}",
                    profile_path.to_string_lossy(),
                    get_powershell_init_script()
                ));
            }
            Err(e) => {
                log::warn!("PowerShell shell integration disabled: {e}");
                cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ""]);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // pwsh on Linux/macOS
        cmd.args(["-NoProfile", "-Command", ""]);
    }
}

#[allow(unused_variables)]
fn build_cmd_command(cmd: &mut CommandBuilder) {
    #[cfg(target_os = "windows")]
    {
        // CMD doesn't support profile injection easily
        // We set PROMPT to include our markers and rely on TERM env var
        cmd.arg("/c");
        // Add minimal init via environment
        cmd.env("TERAX_CMD_INIT", "1");
    }
    #[cfg(not(target_os = "windows"))]
    {
        // This shouldn't happen - CMD only exists on Windows
        log::warn!("CMD shell detected on non-Windows platform");
    }
}

#[cfg(target_os = "windows")]
fn get_powershell_init_script() -> String {
    r#"
$TERAX_HOOKS_LOADED = $true
function global:_terax_prompt {
    $cwd = (Get-Location).Path
    $hostName = $env:COMPUTERNAME
    $esc = [char]27
    "$esc]133;D;$LASTEXITCODE$esc\` $esc]7;file://$hostName$cwd$esc\` $esc]133;A$esc\`"
}
if ($function:prompt) { $global:_orig_prompt = $function:prompt }
function global:prompt { _terax_prompt }
"#.to_string()
}

#[cfg(target_os = "windows")]
fn integration_root() -> Result<PathBuf, String> {
    let root = std::env::temp_dir()
        .join("terax")
        .join("shell-integration");
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    Ok(root)
}

#[cfg(not(target_os = "windows"))]
fn integration_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let root = PathBuf::from(home)
        .join(".cache")
        .join("terax")
        .join("shell-integration");
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

#[cfg(target_os = "windows")]
fn prepare_powershell_profile() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("powershell");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let profile = dir.join("Microsoft.PowerShell_profile.ps1");
    write_if_changed(&profile, POWERSHELL_PROFILE)?;
    Ok(profile)
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