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

/// Parse tmux config text. Returns the prefix plus optional split-right /
/// split-down keys (None when the user didn't bind that direction, so the
/// caller can fall back to tmux defaults).
///
/// Factored out so the file-reading command and the unit tests share the same
/// best-effort parser.
fn parse_tmux_config(contents: &str) -> (PrefixKey, Option<String>, Option<String>) {
    let mut prefix = PrefixKey {
        ctrl: true,
        key: DEFAULT_PREFIX_KEY.to_string(),
    };
    let mut split_right: Option<String> = None;
    let mut split_down: Option<String> = None;

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
                            if split_right.is_none() {
                                split_right = Some(key);
                            }
                        }
                        SplitDir::Down => {
                            if split_down.is_none() {
                                split_down = Some(key);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    (prefix, split_right, split_down)
}

#[tauri::command]
pub fn tmux_split_bindings() -> TmuxSplitBindings {
    match config_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(contents) => {
            let (prefix, right, down) = parse_tmux_config(&contents);
            TmuxSplitBindings {
                enabled: true,
                prefix,
                split_right: right.unwrap_or_else(|| DEFAULT_SPLIT_RIGHT.to_string()),
                split_down: down.unwrap_or_else(|| DEFAULT_SPLIT_DOWN.to_string()),
            }
        }
        None => TmuxSplitBindings {
            enabled: false,
            prefix: PrefixKey {
                ctrl: true,
                key: DEFAULT_PREFIX_KEY.to_string(),
            },
            split_right: DEFAULT_SPLIT_RIGHT.to_string(),
            split_down: DEFAULT_SPLIT_DOWN.to_string(),
        },
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
        let (prefix, right, down) = parse_tmux_config(cfg);
        assert_eq!(
            prefix,
            PrefixKey {
                ctrl: true,
                key: "a".to_string()
            }
        );
        assert_eq!(right.as_deref(), Some("\\"));
        assert_eq!(down.as_deref(), Some("-"));
    }

    #[test]
    fn missing_config_defaults() {
        let (prefix, right, down) = parse_tmux_config("");
        assert_eq!(
            prefix,
            PrefixKey {
                ctrl: true,
                key: "b".to_string()
            }
        );
        assert_eq!(right, None);
        assert_eq!(down, None);
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
        let (prefix, right, down) = parse_tmux_config(cfg);
        assert_eq!(prefix.key, "x");
        assert_eq!(right.as_deref(), Some("|"));
        assert_eq!(down.as_deref(), Some("\""));
    }

    #[test]
    fn splitw_abbreviation() {
        let cfg = "\
bind v splitw -h
bind s splitw
";
        let (_prefix, right, down) = parse_tmux_config(cfg);
        assert_eq!(right.as_deref(), Some("v"));
        // Bare splitw defaults to a vertical (down) split.
        assert_eq!(down.as_deref(), Some("s"));
    }

    #[test]
    fn no_prefix_binding_ignored() {
        let cfg = "\
bind -n C-Right split-window -h
bind \\\\ split-window -h
";
        let (_prefix, right, _down) = parse_tmux_config(cfg);
        // The -n binding is skipped; the prefixed one wins.
        assert_eq!(right.as_deref(), Some("\\"));
    }

    #[test]
    fn flags_before_key_skipped() {
        let cfg = "\
bind -r -T prefix M split-window -v
";
        let (_prefix, _right, down) = parse_tmux_config(cfg);
        assert_eq!(down.as_deref(), Some("M"));
    }

    #[test]
    fn comments_ignored() {
        let cfg = "\
# set -g prefix C-z
bind | split-window -h
";
        let (prefix, right, _down) = parse_tmux_config(cfg);
        assert_eq!(prefix.key, "b");
        assert_eq!(right.as_deref(), Some("|"));
    }
}
