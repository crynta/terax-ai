use std::path::PathBuf;

use portable_pty::CommandBuilder;
use serde::Serialize;

use crate::modules::workspace::WorkspaceEnv;

#[cfg(windows)]
const BASHRC_SCRIPT: &str = include_str!("scripts/bashrc.bash");

#[cfg(windows)]
fn bashrc_script() -> &'static str {
    BASHRC_SCRIPT
}

pub fn build_command(
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<CommandBuilder, String> {
    // SSH takes priority regardless of platform
    if let WorkspaceEnv::Ssh {
        host,
        user,
        port,
        key_path,
        password,
    } = &workspace
    {
        return build_ssh(cwd, host, user, *port, key_path, password);
    }
    #[cfg(unix)]
    {
        let _ = workspace;
        unix::build(cwd)
    }
    #[cfg(windows)]
    {
        windows::build(cwd, workspace)
    }
}

fn sshpass_available() -> bool {
    std::process::Command::new("sshpass")
        .arg("--version")
        .output()
        .is_ok()
}

fn build_ssh(
    _cwd: Option<String>,
    host: &str,
    user: &Option<String>,
    port: Option<u16>,
    key_path: &Option<String>,
    password: &Option<String>,
) -> Result<CommandBuilder, String> {
    let use_sshpass = password.is_some() && sshpass_available();

    let (program, pass_args): (&str, Vec<String>) = if use_sshpass {
        (
            "sshpass",
            vec![
                "-p".into(),
                password.as_ref().unwrap().clone(),
                "ssh".into(),
            ],
        )
    } else {
        ("ssh", vec![])
    };

    let mut cmd = CommandBuilder::new(program);
    for a in pass_args {
        cmd.arg(&a);
    }
    cmd.arg("-t");
    cmd.arg("-o");
    cmd.arg("ControlMaster=no");
    cmd.arg("-o");
    cmd.arg("LogLevel=QUIET");
    if let Some(k) = key_path {
        cmd.arg("-i");
        cmd.arg(k);
    }
    if let Some(p) = port {
        cmd.arg("-p");
        cmd.arg(p.to_string());
    }
    let mut target = String::new();
    if let Some(u) = user {
        target.push_str(u);
        target.push('@');
    }
    target.push_str(host);
    cmd.arg(&target);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");

    // Inject shell integration for OSC 7 (CWD tracking)
    let init_script = r#"
_terax_urlencode() {
  local LC_ALL=C s="$1" i c
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9/._~-]) printf '%s' "$c" ;;
      *) printf '%%%02X' "'$c" ;;
    esac
  done
}
_terax_osc7() {
  printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-$(uname -n)}" "$(_terax_urlencode "$PWD")"
}
if [ -n "$BASH_VERSION" ]; then
  PROMPT_COMMAND="_terax_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
elif [ -n "$ZSH_VERSION" ]; then
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _terax_osc7
fi
exec "${SHELL:-/bin/bash}" -i
"#
    .trim();

    cmd.arg("bash");
    cmd.arg("-c");
    cmd.arg(init_script);

    Ok(cmd)
}

/// Describes a detected shell on the system (used by frontend session dialog).
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub enum DetectedShell {
    Pwsh,
    PowerShell,
    Cmd,
    GitBash,
    Bash,
    Zsh,
    Fish,
    WslBash,
    Ssh,
    Other(String),
}

#[allow(dead_code)]
impl DetectedShell {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pwsh => "PowerShell 7",
            Self::PowerShell => "Windows PowerShell 5",
            Self::Cmd => "Command Prompt",
            Self::GitBash => "Git Bash",
            Self::Bash => "Bash",
            Self::Zsh => "Zsh",
            Self::Fish => "Fish",
            Self::WslBash => "WSL Bash",
            Self::Ssh => "SSH",
            Self::Other(_) => "Other",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            Self::Pwsh => "powershell",
            Self::PowerShell => "powershell",
            Self::Cmd => "cmd",
            Self::GitBash => "git-bash",
            Self::Bash => "bash",
            Self::Zsh => "zsh",
            Self::Fish => "fish",
            Self::WslBash => "wsl",
            Self::Ssh => "ssh",
            Self::Other(_) => "terminal",
        }
    }
}

/// Detect all available shells on the current system.
#[tauri::command]
pub fn list_available_shells() -> Vec<serde_json::Value> {
    let mut shells = Vec::new();

    #[cfg(windows)]
    {
        // Detect pwsh.exe
        if let Some(_p) = which_in_path("pwsh.exe") {
            shells.push(serde_json::json!({"kind": "Pwsh", "label": "PowerShell 7", "icon": "powershell", "path": "pwsh.exe"}));
        }
        // Detect powershell.exe
        let system32 = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32");
        let ps5 = system32
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if ps5.exists() {
            shells.push(serde_json::json!({"kind": "PowerShell", "label": "Windows PowerShell 5", "icon": "powershell", "path": ps5.to_string_lossy()}));
        }
        // Detect cmd.exe
        let cmd = system32.join("cmd.exe");
        if cmd.exists() {
            shells.push(serde_json::json!({"kind": "Cmd", "label": "Command Prompt", "icon": "cmd", "path": cmd.to_string_lossy()}));
        }
        // Detect Git Bash
        if let Some(gb) = detect_git_bash() {
            shells.push(serde_json::json!({"kind": "GitBash", "label": "Git Bash", "icon": "git-bash", "path": gb.to_string_lossy()}));
        }
        // Detect WSL distros (from workspace module)
        // WSL distros are already available via wsl_list_distros
    }

    #[cfg(unix)]
    {
        // Detect zsh
        if which_in_path("zsh").is_some() {
            shells.push(
                serde_json::json!({"kind": "Zsh", "label": "Zsh", "icon": "zsh", "path": "zsh"}),
            );
        }
        // Detect bash
        if which_in_path("bash").is_some() {
            shells.push(serde_json::json!({"kind": "Bash", "label": "Bash", "icon": "bash", "path": "bash"}));
        }
        // Detect fish
        if which_in_path("fish").is_some() {
            shells.push(serde_json::json!({"kind": "Fish", "label": "Fish", "icon": "fish", "path": "fish"}));
        }
    }

    shells
}

#[cfg(windows)]
fn detect_git_bash() -> Option<PathBuf> {
    // Git Bash is typically installed in Program Files
    for pf in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(pf).map(PathBuf::from) {
            let candidates = [
                dir.join("Git").join("bin").join("bash.exe"),
                dir.join("Git").join("usr").join("bin").join("bash.exe"),
            ];
            for c in &candidates {
                if c.is_file() {
                    return Some(c.clone());
                }
            }
        }
    }
    // Also check PATH
    which_in_path("bash.exe")
}

fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    #[cfg(target_os = "macos")]
    let fallback = "en_US.UTF-8";
    #[cfg(all(unix, not(target_os = "macos")))]
    let fallback = "C.UTF-8";
    #[cfg(windows)]
    let fallback = "en_US.UTF-8";
    cmd.env("LANG", fallback);
}

fn apply_common(cmd: &mut CommandBuilder, cwd: Option<String>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");
    ensure_utf8_locale(cmd);

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
            let path = login_shell()
                .or_else(|| std::env::var("SHELL").ok())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/bin/zsh".into());
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

    fn login_shell() -> Option<String> {
        use std::ffi::CStr;
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                return None;
            }
            let shell_ptr = (*pw).pw_shell;
            if shell_ptr.is_null() {
                return None;
            }
            CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
        }
    }

    pub fn build(cwd: Option<String>) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = Shell::detect();
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
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::modules::workspace::WorkspaceEnv;
    use portable_pty::CommandBuilder;

    const PROFILE_PS1: &str = include_str!("scripts/profile.ps1");

    pub fn build(cwd: Option<String>, workspace: WorkspaceEnv) -> Result<CommandBuilder, String> {
        if let WorkspaceEnv::Wsl { distro } = workspace {
            return build_wsl(cwd, distro);
        }
        let shell_path = super::windows_shell_path();
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

    fn build_wsl(cwd: Option<String>, distro: String) -> Result<CommandBuilder, String> {
        let wsl_cwd = cwd.map(|c| resolve_wsl_cwd(&distro, c));
        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(&distro);
        cmd.arg("--cd");
        cmd.arg(wsl_cwd.as_deref().filter(|s| !s.is_empty()).unwrap_or("~"));
        cmd.arg("--exec");
        cmd.arg("bash");
        match prepare_wsl_bash_rcfile(&distro) {
            Ok(rc) => {
                cmd.arg("--rcfile");
                cmd.arg(rc);
            }
            Err(e) => {
                log::warn!("WSL bash shell integration disabled for {distro}: {e}");
            }
        }
        cmd.arg("-i");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERAX_TERMINAL", "1");
        super::ensure_utf8_locale(&mut cmd);
        log::info!("spawning WSL shell: {distro}");
        Ok(cmd)
    }

    /// Convert a Windows path (C:\foo) to a WSL Linux path (/mnt/c/foo) for
    /// `wsl.exe --cd`.  Uses `wslpath -u` when available; falls back to the
    /// convention `/mnt/<drive>/<rest>`.
    fn resolve_wsl_cwd(distro: &str, cwd: String) -> String {
        let bytes = cwd.as_bytes();
        let is_windows_path = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/');
        if !is_windows_path {
            return cwd; // already a Linux path or relative
        }
        // Try wslpath -u for reliable conversion
        let args = ["-d", distro, "--exec", "wslpath", "-u", &cwd];
        if let Ok(out) = std::process::Command::new("wsl.exe").args(&args).output() {
            if out.status.success() {
                let converted = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !converted.is_empty() {
                    return converted;
                }
            }
        }
        // Fallback: C:\path → /mnt/c/path
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let rest = cwd[3..].replace('\\', "/");
        format!("/mnt/{}/{}", drive, rest.trim_start_matches('/'))
    }

    fn prepare_wsl_bash_rcfile(distro: &str) -> Result<String, String> {
        let home = crate::modules::workspace::wsl_home(distro.to_string())?;
        let linux_dir = format!(
            "{}/.cache/terax/shell-integration/bash",
            home.trim_end_matches('/')
        );
        let linux_rc = format!("{linux_dir}/bashrc");

        let content = super::bashrc_script().replace("\r\n", "\n");

        // Write file inside WSL to avoid UNC access denied (os error 5) on some systems.
        // We use 'sh -c' to ensure directory creation and file writing happen in one go.
        let mut child = std::process::Command::new("wsl.exe")
            .args([
                "-d",
                distro,
                "--exec",
                "sh",
                "-c",
                &format!("mkdir -p '{}' && cat > '{}'", linux_dir, linux_rc),
            ])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn wsl write: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(content.as_bytes())
                .map_err(|e| format!("write to wsl stdin: {e}"))?;
        }

        let status = child
            .wait()
            .map_err(|e| format!("wait for wsl write: {e}"))?;
        if !status.success() {
            return Err(format!(
                "wsl write failed for {distro} (exit code {:?})",
                status.code()
            ));
        }

        Ok(linux_rc)
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
