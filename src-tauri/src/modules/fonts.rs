use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::Response;

/// Largest font file we will hand to the webview. Nerd Font families are
/// around 2-10 MB per face; anything past this is not a terminal font.
const MAX_FONT_BYTES: u64 = 30 * 1024 * 1024;

/// Lowercase alphanumerics only, so `MesloLGS NF` and `MesloLGS-NF` compare
/// equal and no path separator or dot from user input can reach the lookup.
fn normalize(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn font_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.push(home.join("Library/Fonts"));
    }
    dirs.push(PathBuf::from("/Library/Fonts"));
    dirs
}

/// Finds `<family> <style>.ttf|otf` in `dirs`, matching on the normalized file
/// stem, e.g. `MesloLGS NF` + `Regular` matches `MesloLGS NF Regular.ttf` and
/// `hack nerd font mono` + `Bold` matches `HackNerdFontMono-Bold.ttf`.
fn find_font_file(dirs: &[PathBuf], family: &str, style: &str) -> Option<PathBuf> {
    let wanted = format!("{}{}", normalize(family), normalize(style));
    if wanted.is_empty() {
        return None;
    }
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_font = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf"));
            if !is_font {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if normalize(stem) == wanted {
                return Some(path);
            }
        }
    }
    None
}

/// Returns the raw bytes of an installed font face so the webview can register
/// it with `FontFace`. WKWebView canvas cannot resolve user-installed fonts by
/// family name, which is why terminal glyphs fall back to a system monospace.
#[tauri::command]
pub fn fonts_read_installed(family: String, style: String) -> Result<Response, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let dirs = font_dirs(home.as_deref());
    let path = find_font_file(&dirs, &family, &style)
        .ok_or_else(|| format!("font not installed: {family} {style}"))?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_FONT_BYTES {
        return Err(format!("font file too large: {size} bytes"));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), b"font").unwrap();
    }

    #[test]
    fn normalize_ignores_case_spaces_and_punctuation() {
        assert_eq!(normalize("MesloLGS NF"), "meslolgsnf");
        assert_eq!(normalize("MesloLGS-NF"), "meslolgsnf");
    }

    #[test]
    fn finds_regular_face_for_family_with_spaces() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "MesloLGS NF Regular.ttf");
        touch(dir.path(), "MesloLGS NF Bold.ttf");
        let dirs = vec![dir.path().to_path_buf()];
        assert_eq!(
            find_font_file(&dirs, "MesloLGS NF", "Regular"),
            Some(dir.path().join("MesloLGS NF Regular.ttf"))
        );
        assert_eq!(
            find_font_file(&dirs, "MesloLGS NF", "Bold"),
            Some(dir.path().join("MesloLGS NF Bold.ttf"))
        );
    }

    #[test]
    fn does_not_match_a_different_family_with_the_same_prefix() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "HackNerdFontMono-Regular.otf");
        let dirs = vec![dir.path().to_path_buf()];
        assert_eq!(find_font_file(&dirs, "Hack Nerd Font", "Regular"), None);
        assert!(find_font_file(&dirs, "Hack Nerd Font Mono", "Regular").is_some());
    }

    #[test]
    fn ignores_non_font_files_and_empty_names() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "MesloLGS NF Regular.txt");
        let dirs = vec![dir.path().to_path_buf()];
        assert_eq!(find_font_file(&dirs, "MesloLGS NF", "Regular"), None);
        assert_eq!(find_font_file(&dirs, "", ""), None);
        assert_eq!(find_font_file(&dirs, "../etc", "passwd"), None);
    }
}
