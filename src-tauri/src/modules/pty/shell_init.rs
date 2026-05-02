// Shell integration layer.
//
// Emits OSC 7 (current working directory) and OSC 133 A/B/C/D
// (prompt-start / prompt-end / pre-exec / command-done-with-exit-code) so the
// frontend can detect command boundaries and track cwd without re-parsing the
// prompt.
//
// Safety notes:
// - Files are written atomically (tmp + rename) to avoid a half-written rc
//   being sourced by a parallel shell spawn.
// - $__TERAX_HOOKS_LOADED guards re-sourcing within a single shell (e.g. user
//   runs `source ~/.zshrc`). It is intentionally NOT exported — each nested
//   interactive shell installs its own hooks for its own prompt.
// - User's existing ZDOTDIR is preserved via TERAX_USER_ZDOTDIR — otherwise a
//   user with `ZDOTDIR=~/.config/zsh` would have every `$ZDOTDIR/...` path in
//   their config silently point at our cache dir.
// - PS1/PS0 markers are re-injected on every prompt in case the user's framework
//   (powerlevel10k, starship) rebuilds the prompt string.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

// Shell integration scripts live as real files under `scripts/` so editors can
// lint/highlight them. `include_str!` inlines them at compile time, so the
// runtime still ships a single binary.
const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
const BASHRC: &str = include_str!("scripts/bashrc.bash");

pub enum Shell {
    Zsh,
    Bash,
    Other,
}

impl Shell {
    pub fn detect() -> (Shell, String) {
        let path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let name = path.rsplit('/').next().unwrap_or("").to_string();
        let shell = match name.as_str() {
            "zsh" => Shell::Zsh,
            "bash" => Shell::Bash,
            _ => Shell::Other,
        };
        (shell, path)
    }
}

pub fn build_command(cwd: Option<String>) -> Result<CommandBuilder, String> {
    let (shell, shell_path) = Shell::detect();
    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .filter(|p| p.is_dir())
        })
        .or_else(|| std::env::current_dir().ok());
    if let Some(cwd) = resolved_cwd {
        cmd.cwd(cwd);
    }

    match shell {
        Shell::Zsh => {
            match prepare_zdotdir() {
                Ok(zdotdir) => {
                    // Preserve the user's ZDOTDIR (if any) so our integration
                    // scripts can source their real config from the right place.
                    if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                        cmd.env("TERAX_USER_ZDOTDIR", user_zd);
                    }
                    cmd.env("ZDOTDIR", zdotdir);
                }
                Err(e) => {
                    log::warn!("zsh shell integration disabled: {e}");
                }
            }
            // Login shell so /etc/zprofile runs → path_helper on macOS injects
            // Homebrew/user bins into PATH. Without this, apps launched from
            // Finder/Dock get a minimal PATH.
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
            // NOT passing `-l`: bash ignores --rcfile for login shells. We
            // emulate login-shell init inside our rcfile by explicitly sourcing
            // /etc/profile first.
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

fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == content {
            return Ok(());
        }
    }
    // Atomic replace via tmp + rename so a concurrent shell startup can never
    // source a half-written file. Suffix (not with_extension) because our
    // dotfile basenames have no extension in the Path sense (.zshrc → "").
    let mut tmp: OsString = path.as_os_str().to_owned();
    tmp.push(".__terax_tmp__");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        // Best-effort cleanup of the tmp file on rename failure.
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), path.display())
    })
}
