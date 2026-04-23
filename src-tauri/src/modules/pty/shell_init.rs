use std::fs;
use std::path::PathBuf;

use portable_pty::CommandBuilder;

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
    cmd.env("TERAX_TERMINAL", "1");

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::current_dir().ok());
    if let Some(cwd) = resolved_cwd {
        cmd.cwd(cwd);
    }

    match shell {
        Shell::Zsh => {
            if let Ok(zdotdir) = prepare_zdotdir() {
                cmd.env("ZDOTDIR", zdotdir);
            }
        }
        Shell::Bash => {
            if let Ok(rc) = prepare_bash_rcfile() {
                cmd.arg("--rcfile");
                cmd.arg(rc);
                cmd.arg("-i");
            }
        }
        Shell::Other => {}
    }
    Ok(cmd)
}

fn integration_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let root = PathBuf::from(home)
        .join(".cache")
        .join("terax")
        .join("shell-integration");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn prepare_zdotdir() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("zsh");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_if_changed(dir.join(".zshenv"), ZSHENV)?;
    write_if_changed(dir.join(".zprofile"), ZPROFILE)?;
    write_if_changed(dir.join(".zshrc"), ZSHRC)?;
    write_if_changed(dir.join(".zlogin"), ZLOGIN)?;
    Ok(dir)
}

fn prepare_bash_rcfile() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("bash");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let rc = dir.join("bashrc");
    write_if_changed(rc.clone(), BASHRC)?;
    Ok(rc)
}

fn write_if_changed(path: PathBuf, content: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(&path) {
        if existing == content {
            return Ok(());
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

const ZSHENV: &str = r#"# terax-shell-integration (zshenv)
[ -f "$HOME/.zshenv" ] && source "$HOME/.zshenv"
"#;

const ZPROFILE: &str = r#"# terax-shell-integration (zprofile)
[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile"
"#;

const ZLOGIN: &str = r#"# terax-shell-integration (zlogin)
[ -f "$HOME/.zlogin" ] && source "$HOME/.zlogin"
"#;

const ZSHRC: &str = r#"# terax-shell-integration (zshrc)
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
if [[ -z "$__TERAX_HOOKS_LOADED" ]]; then
  __TERAX_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null
  _terax_precmd() {
    printf '\e]7;file://%s%s\e\\' "${HOST}" "${PWD}"
    printf '\e]133;A\e\\'
  }
  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _terax_precmd
    add-zsh-hook chpwd  _terax_precmd
  fi
  _terax_precmd
fi
"#;

const BASHRC: &str = r#"# terax-shell-integration (bashrc)
if [ -z "$__TERAX_HOOKS_LOADED" ]; then
  __TERAX_HOOKS_LOADED=1
  [ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile"
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
  _terax_precmd() {
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME}" "${PWD}"
    printf '\e]133;A\e\\'
  }
  case ":${PROMPT_COMMAND:-}:" in
    *":_terax_precmd:"*) ;;
    *) PROMPT_COMMAND="_terax_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac
  _terax_precmd
fi
"#;
