pub mod file;
pub mod grep;
pub mod mutate;
pub mod search;
pub mod tree;
pub mod watch;

use std::path::Path;

/// The single canonical-to-display conversion: forward slashes, Windows
/// verbatim `\\?\` prefix stripped. Route every such conversion through here.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy();
    #[cfg(windows)]
    {
        strip_verbatim(&s)
    }
    #[cfg(not(windows))]
    {
        // Backslashes are legal in Unix filenames; never rewrite them.
        s.into_owned()
    }
}

// Pure so it stays unit-testable on any host. `\\?\C:\x` -> `C:/x`.
#[cfg_attr(not(windows), allow(dead_code))]
fn strip_verbatim(s: &str) -> String {
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    };
    stripped.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim;

    #[test]
    fn strips_drive_verbatim_prefix() {
        assert_eq!(strip_verbatim(r"\\?\C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn rewrites_verbatim_unc_to_share_path() {
        assert_eq!(
            strip_verbatim(r"\\?\UNC\server\share\dir"),
            "//server/share/dir"
        );
    }

    #[test]
    fn passes_through_plain_windows_path() {
        assert_eq!(strip_verbatim(r"C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn leaves_forward_slash_path_unchanged() {
        assert_eq!(strip_verbatim("C:/Users/foo"), "C:/Users/foo");
    }

    #[test]
    fn handles_drive_root() {
        assert_eq!(strip_verbatim(r"\\?\C:\"), "C:/");
    }
}
