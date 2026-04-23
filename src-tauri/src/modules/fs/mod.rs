use std::path::PathBuf;

// Lists immediate subdirectories of `path`. Expects an absolute path;
// tilde expansion is the caller's responsibility.
//
// Symlinks to directories are included (matches shell `cd` semantics).
// Hidden entries are filtered by dot-prefix only; Windows FILE_ATTRIBUTE_HIDDEN
// is not considered — acceptable for the current macOS/Linux target.
#[tauri::command]
pub fn list_subdirs(path: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&path);
    let read = std::fs::read_dir(&root).map_err(|e| e.to_string())?;

    let mut dirs: Vec<String> = read
        .filter_map(Result::ok)
        .filter(|entry| {
            std::fs::metadata(entry.path())
                .map(|m| m.is_dir())
                .unwrap_or(false)
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .collect();

    dirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(dirs)
}
