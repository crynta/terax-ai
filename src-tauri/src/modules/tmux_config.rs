//! tmux-style prefix keybindings for terminal pane splitting.
//!
//! Reads the user's `.tmux.conf` (best-effort, line-based) so they can split
//! Terax panes with their OWN tmux bindings — e.g. prefix `C-a`, then `\` to
//! split right and `-` to split down. This is a two-stroke prefix sequence,
//! distinct from Terax's single-chord shortcuts; the frontend wires it up
//! separately.
//!
//! No tmux config present → tmux DEFAULTS (prefix `C-b`, `%` = split right,
//! `"` = split down).

use serde::Serialize;

/// tmux default prefix when no `set -g prefix` line is found: `C-b`.
const DEFAULT_PREFIX_KEY: &str = "b";
/// tmux default split-right binding (`bind % split-window -h`).
const DEFAULT_SPLIT_RIGHT: &str = "%";
/// tmux default split-down binding (`bind \" split-window -v`).
const DEFAULT_SPLIT_DOWN: &str = "\"";
/// tmux default pane-navigation bindings are the arrow keys
/// (`bind Left select-pane -L`, etc). The frontend normalizes these tokens to
/// JS `KeyboardEvent.key` names (`Left` -> `ArrowLeft`).
const DEFAULT_FOCUS_LEFT: &str = "Left";
const DEFAULT_FOCUS_RIGHT: &str = "Right";
const DEFAULT_FOCUS_UP: &str = "Up";
const DEFAULT_FOCUS_DOWN: &str = "Down";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrefixKey {
    pub ctrl: bool,
    /// A single lowercased char, e.g. "a".
    pub key: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSplitBindings {
    /// True if a real tmux config file was actually found.
    pub enabled: bool,
    pub prefix: PrefixKey,
    /// The literal key char, e.g. "\\" -> "\", or "%".
    pub split_right: String,
    /// E.g. "-" or "\"".
    pub split_down: String,
    /// Pane-navigation keys (tmux `select-pane -L/-R/-U/-D`). Tokens may be
    /// single chars (`h`) or arrow names (`Left`); the frontend normalizes.
    pub focus_left: String,
    pub focus_right: String,
    pub focus_up: String,
    pub focus_down: String,
}

/// Config file lookup order — first existing path wins.
fn config_path() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("TMUX_CONF") {
        if !p.is_empty() {
            let path = std::path::PathBuf::from(p);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".tmux.conf"),
        home.join(".config").join("tmux").join("tmux.conf"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// Unwrap a tmux config key token: handle `\\` → `\` and strip surrounding
/// single/double quotes (e.g. `'"'` → `"`).
fn unquote_key(token: &str) -> String {
    if token == "\\\\" {
        return "\\".to_string();
    }
    let bytes = token.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'\'' || first == b'"') && first == last {
            return token[1..token.len() - 1].to_string();
        }
    }
    token.to_string()
}

/// Parse a `C-<x>` prefix token into a [`PrefixKey`]. Returns `None` if the
/// token isn't a recognizable `C-<letter>` form.
fn parse_prefix_token(token: &str) -> Option<PrefixKey> {
    let rest = token
        .strip_prefix("C-")
        .or_else(|| token.strip_prefix("c-"))?;
    if rest.len() != 1 {
        return None;
    }
    Some(PrefixKey {
        ctrl: true,
        key: rest.to_lowercase(),
    })
}

enum SplitDir {
    Right,
    Down,
}

/// Detect a `split-window`/`splitw` command in the tokens after the key, and
/// resolve its direction. `-h` = right, `-v` (or bare) = down.
fn split_direction(tokens: &[&str]) -> Option<SplitDir> {
    let has_split = tokens
        .iter()
        .any(|t| *t == "split-window" || *t == "splitw");
    if !has_split {
        return None;
    }
    if tokens.iter().any(|t| *t == "-h") {
        return Some(SplitDir::Right);
    }
    // `-v` or bare `split-window` both default to a vertical (down) split.
    Some(SplitDir::Down)
}

enum FocusDir {
    Left,
    Right,
    Up,
    Down,
}

/// Detect a `select-pane` command in the tokens after the key, and resolve its
/// direction from `-L/-R/-U/-D`. Directionless `select-pane` (e.g. `-t`) is
/// ignored.
fn select_pane_direction(tokens: &[&str]) -> Option<FocusDir> {
    if !tokens.iter().any(|t| *t == "select-pane" || *t == "selectp") {
        return None;
    }
    if tokens.iter().any(|t| *t == "-L") {
        return Some(FocusDir::Left);
    }
    if tokens.iter().any(|t| *t == "-R") {
        return Some(FocusDir::Right);
    }
    if tokens.iter().any(|t| *t == "-U") {
        return Some(FocusDir::Up);
    }
    if tokens.iter().any(|t| *t == "-D") {
        return Some(FocusDir::Down);
    }
    None
}

/// Result of parsing a tmux config: prefix plus optional split / pane-focus
/// keys (None when the user didn't bind that action, so the caller falls back
/// to tmux defaults).
#[derive(Default)]
struct ParsedBindings {
    split_right: Option<String>,
    split_down: Option<String>,
    focus_left: Option<String>,
    focus_right: Option<String>,
    focus_up: Option<String>,
    focus_down: Option<String>,
}

/// Parse tmux config text. Returns the prefix plus optional split-right /
/// split-down keys (None when the user didn't bind that direction, so the
/// caller can fall back to tmux defaults).
///
/// Factored out so the file-reading command and the unit tests share the same
/// best-effort parser.
fn parse_tmux_config(contents: &str) -> (PrefixKey, ParsedBindings) {
    let mut prefix = PrefixKey {
        ctrl: true,
        key: DEFAULT_PREFIX_KEY.to_string(),
    };
    let mut b = ParsedBindings::default();

    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }

        match tokens[0] {
            // set -g prefix C-a  /  set-option -g prefix C-x
            "set" | "set-option" => {
                if let Some(pos) = tokens.iter().position(|t| *t == "prefix") {
                    if let Some(tok) = tokens.get(pos + 1) {
                        if let Some(pk) = parse_prefix_token(tok) {
                            prefix = pk;
                        }
                    }
                }
            }
            // bind <key> split-window -h  /  bind-key -r <key> splitw -v
            "bind" | "bind-key" => {
                let mut i = 1;
                let mut no_prefix = false;
                // Skip flag tokens (-r, -n, -T <table>) to reach the key. A
                // bare "-" is the `-` key itself, not a flag — only multi-char
                // `-x` tokens are flags.
                while i < tokens.len() && tokens[i].len() > 1 && tokens[i].starts_with('-') {
                    if tokens[i] == "-n" {
                        no_prefix = true;
                    }
                    if tokens[i] == "-T" {
                        // -T <table> consumes the next token (the table name).
                        i += 1;
                    }
                    i += 1;
                }
                // `-n` bindings live in the root table (no prefix); we only
                // want prefix-table splits, so ignore them.
                if no_prefix {
                    continue;
                }
                let Some(key_tok) = tokens.get(i) else {
                    continue;
                };
                let key = unquote_key(key_tok);
                let rest = &tokens[i + 1..];
                if let Some(dir) = split_direction(rest) {
                    match dir {
                        SplitDir::Right => {
                            if b.split_right.is_none() {
                                b.split_right = Some(key);
                            }
                        }
                        SplitDir::Down => {
                            if b.split_down.is_none() {
                                b.split_down = Some(key);
                            }
                        }
                    }
                } else if let Some(dir) = select_pane_direction(rest) {
                    match dir {
                        FocusDir::Left if b.focus_left.is_none() => b.focus_left = Some(key),
                        FocusDir::Right if b.focus_right.is_none() => b.focus_right = Some(key),
                        FocusDir::Up if b.focus_up.is_none() => b.focus_up = Some(key),
                        FocusDir::Down if b.focus_down.is_none() => b.focus_down = Some(key),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    (prefix, b)
}

#[tauri::command]
pub fn tmux_split_bindings() -> TmuxSplitBindings {
    match config_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(contents) => {
            let (prefix, b) = parse_tmux_config(&contents);
            build_bindings(true, prefix, b)
        }
        None => build_bindings(
            false,
            PrefixKey {
                ctrl: true,
                key: DEFAULT_PREFIX_KEY.to_string(),
            },
            ParsedBindings::default(),
        ),
    }
}

/// Fill any unbound action with its tmux default.
fn build_bindings(enabled: bool, prefix: PrefixKey, b: ParsedBindings) -> TmuxSplitBindings {
    TmuxSplitBindings {
        enabled,
        prefix,
        split_right: b.split_right.unwrap_or_else(|| DEFAULT_SPLIT_RIGHT.to_string()),
        split_down: b.split_down.unwrap_or_else(|| DEFAULT_SPLIT_DOWN.to_string()),
        focus_left: b.focus_left.unwrap_or_else(|| DEFAULT_FOCUS_LEFT.to_string()),
        focus_right: b.focus_right.unwrap_or_else(|| DEFAULT_FOCUS_RIGHT.to_string()),
        focus_up: b.focus_up.unwrap_or_else(|| DEFAULT_FOCUS_UP.to_string()),
        focus_down: b.focus_down.unwrap_or_else(|| DEFAULT_FOCUS_DOWN.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_config() {
        let cfg = "\
set -g prefix C-a
bind \\\\ split-window -h
bind - split-window -v
";
        let (prefix, b) = parse_tmux_config(cfg);
        assert_eq!(
            prefix,
            PrefixKey {
                ctrl: true,
                key: "a".to_string()
            }
        );
        assert_eq!(b.split_right.as_deref(), Some("\\"));
        assert_eq!(b.split_down.as_deref(), Some("-"));
    }

    #[test]
    fn missing_config_defaults() {
        let (prefix, b) = parse_tmux_config("");
        assert_eq!(
            prefix,
            PrefixKey {
                ctrl: true,
                key: "b".to_string()
            }
        );
        assert_eq!(b.split_right, None);
        assert_eq!(b.split_down, None);
        // The command layer fills these with tmux defaults.
        assert_eq!(DEFAULT_SPLIT_RIGHT, "%");
        assert_eq!(DEFAULT_SPLIT_DOWN, "\"");
    }

    #[test]
    fn quoted_keys() {
        let cfg = "\
set-option -g prefix C-x
bind '|' split-window -h
bind '\"' split-window -v
";
        let (prefix, b) = parse_tmux_config(cfg);
        assert_eq!(prefix.key, "x");
        assert_eq!(b.split_right.as_deref(), Some("|"));
        assert_eq!(b.split_down.as_deref(), Some("\""));
    }

    #[test]
    fn splitw_abbreviation() {
        let cfg = "\
bind v splitw -h
bind s splitw
";
        let (_prefix, b) = parse_tmux_config(cfg);
        assert_eq!(b.split_right.as_deref(), Some("v"));
        // Bare splitw defaults to a vertical (down) split.
        assert_eq!(b.split_down.as_deref(), Some("s"));
    }

    #[test]
    fn no_prefix_binding_ignored() {
        let cfg = "\
bind -n C-Right split-window -h
bind \\\\ split-window -h
";
        let (_prefix, b) = parse_tmux_config(cfg);
        // The -n binding is skipped; the prefixed one wins.
        assert_eq!(b.split_right.as_deref(), Some("\\"));
    }

    #[test]
    fn flags_before_key_skipped() {
        let cfg = "\
bind -r -T prefix M split-window -v
";
        let (_prefix, b) = parse_tmux_config(cfg);
        assert_eq!(b.split_down.as_deref(), Some("M"));
    }

    #[test]
    fn pane_nav_hjkl() {
        let cfg = "\
set -g prefix C-a
bind h select-pane -L
bind j select-pane -D
bind k select-pane -U
bind l select-pane -R
";
        let (_prefix, b) = parse_tmux_config(cfg);
        assert_eq!(b.focus_left.as_deref(), Some("h"));
        assert_eq!(b.focus_down.as_deref(), Some("j"));
        assert_eq!(b.focus_up.as_deref(), Some("k"));
        assert_eq!(b.focus_right.as_deref(), Some("l"));
    }

    #[test]
    fn comments_ignored() {
        let cfg = "\
# set -g prefix C-z
bind | split-window -h
";
        let (prefix, b) = parse_tmux_config(cfg);
        assert_eq!(prefix.key, "b");
        assert_eq!(b.split_right.as_deref(), Some("|"));
    }
}
