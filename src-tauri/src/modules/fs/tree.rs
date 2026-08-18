use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::Path;
use std::time::UNIX_EPOCH;

use ignore::WalkBuilder;
use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Milliseconds since UNIX epoch; 0 if unavailable.
    pub mtime: u64,
    pub gitignored: bool,
}

// Whether `dir` is inside a git repo. Walks up only; never descends into
// siblings, so it does not touch protected macOS folders (Desktop, ...).
fn in_git_repo(dir: &Path) -> bool {
    let mut cur = dir;
    loop {
        if cur.join(".git").exists() {
            return true;
        }
        match cur.parent() {
            Some(p) => cur = p,
            None => return false,
        }
    }
}

// Immediate children of `dir` that git does not ignore. Outside a repo every
// name is returned, so nothing is dimmed.
fn git_non_ignored_names(dir: &Path, show_hidden: bool) -> HashSet<String> {
    WalkBuilder::new(dir)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(false)
        .parents(true)
        .max_depth(Some(1))
        .follow_links(false)
        .build()
        .flatten()
        .filter_map(|d| d.file_name().to_str().map(str::to_string))
        .collect()
}

fn natural_cmp_inner(a: &str, b: &str) -> Ordering {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let mut ai = 0;
    let mut bi = 0;

    loop {
        match (a.get(ai).copied(), b.get(bi).copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ac), Some(bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let a_end = ai
                        + a[ai..]
                            .iter()
                            .take_while(|byte| byte.is_ascii_digit())
                            .count();
                    let b_end = bi
                        + b[bi..]
                            .iter()
                            .take_while(|byte| byte.is_ascii_digit())
                            .count();
                    let a_run = &a[ai..a_end];
                    let b_run = &b[bi..b_end];
                    let a_zeros = a_run.iter().take_while(|byte| **byte == b'0').count();
                    let b_zeros = b_run.iter().take_while(|byte| **byte == b'0').count();
                    let a_number = &a_run[a_zeros..];
                    let b_number = &b_run[b_zeros..];

                    let ord = a_number.len().cmp(&b_number.len());
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    let ord = a_number.cmp(b_number);
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    let ord = a_run.len().cmp(&b_run.len());
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    ai = a_end;
                    bi = b_end;
                } else {
                    let ord = ac.to_ascii_lowercase().cmp(&bc.to_ascii_lowercase());
                    if ord != Ordering::Equal {
                        return ord;
                    }
                    ai += 1;
                    bi += 1;
                }
            }
        }
    }
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a_folded = (!a.is_ascii()).then(|| a.to_lowercase());
    let b_folded = (!b.is_ascii()).then(|| b.to_lowercase());
    natural_cmp_inner(
        a_folded.as_deref().unwrap_or(a),
        b_folded.as_deref().unwrap_or(b),
    )
}

/// Lists immediate children of `path`. Dirs first, then files, each sorted
/// with `natural_cmp` (numeric-aware, case-insensitive). Dot-prefixed entries
/// (files and dirs) are hidden unless `show_hidden` is set. `git_decorations`
/// opts into the per-entry `gitignored` flag; off by default so non-explorer
/// callers pay nothing.
#[tauri::command]
pub fn fs_read_dir(
    path: String,
    show_hidden: bool,
    git_decorations: Option<bool>,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("fs_read_dir({}) failed: {e}", root.display());
        e.to_string()
    })?;

    // Gate on a real repo: outside one the walk is pointless and would probe
    // each child for a nested `.git`, which trips macOS folder-access prompts.
    let git_decorations = git_decorations.unwrap_or(false) && in_git_repo(&root);
    let git_visible = if git_decorations {
        git_non_ignored_names(&root, show_hidden)
    } else {
        HashSet::new()
    };

    let mut entries: Vec<DirEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;

            // `metadata()` follows symlinks → it returns the target's stat in
            // one syscall (file_type + size + mtime all derived from it). We
            // fall back to `symlink_metadata` for broken symlinks so we don't
            // silently drop them from the listing.
            let (meta, was_symlink) = match std::fs::metadata(entry.path()) {
                Ok(m) => (Some(m), false),
                Err(_) => (entry.metadata().ok(), true),
            };
            let meta = meta?;

            let kind = if was_symlink {
                EntryKind::Symlink
            } else if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            };

            if name.starts_with('.') && !show_hidden {
                return None;
            }

            let size = meta.len();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let gitignored = git_decorations && !git_visible.contains(&name);
            Some(DirEntry {
                name,
                kind,
                size,
                mtime,
                gitignored,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        let rank = |k: &EntryKind| match k {
            EntryKind::Dir => 0,
            EntryKind::Symlink => 1,
            EntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| natural_cmp(&a.name, &b.name))
    });

    Ok(entries)
}

/// Lists immediate subdirectories of `path`. Kept for the CwdBreadcrumb.
///
/// Symlinks to directories are included (matches shell `cd` semantics).
/// Hidden entries are filtered by dot-prefix only.
#[tauri::command]
pub fn list_subdirs(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("list_subdirs({}) read_dir failed: {e}", root.display());
        e.to_string()
    })?;

    let mut dirs: Vec<String> = read
        .filter_map(Result::ok)
        .filter(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => true,
            Ok(t) if t.is_symlink() => std::fs::metadata(entry.path())
                .map(|m| m.is_dir())
                .unwrap_or(false),
            _ => false,
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| show_hidden || !name.starts_with('.'))
        .collect();

    dirs.sort_by(|a, b| natural_cmp(a, b));
    Ok(dirs)
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    fn sorted(mut v: Vec<&str>) -> Vec<&str> {
        v.sort_by(|a, b| natural_cmp(a, b));
        v
    }

    #[test]
    fn numbers_sort_as_values_not_lexically() {
        assert_eq!(
            sorted(vec!["17", "170", "18", "3", "20", "171", "9"]),
            vec!["3", "9", "17", "18", "20", "170", "171"],
        );
    }

    #[test]
    fn numbers_embedded_in_names() {
        assert_eq!(
            sorted(vec!["10-x-plan.md", "2-x-plan.md", "1-x-plan.md"]),
            vec!["1-x-plan.md", "2-x-plan.md", "10-x-plan.md"],
        );
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(natural_cmp("Apple", "apple"), Ordering::Equal);
        assert_eq!(natural_cmp("École", "école"), Ordering::Equal);
        assert_eq!(natural_cmp("Б2", "б2"), Ordering::Equal);
        assert_eq!(sorted(vec!["b", "A", "c"]), vec!["A", "b", "c"]);
        assert_eq!(sorted(vec!["École", "éclair"]), vec!["éclair", "École"]);
    }

    #[test]
    fn non_cased_unicode_keeps_code_point_order() {
        assert_eq!(sorted(vec!["나", "가", "다"]), vec!["가", "나", "다"]);
    }

    #[test]
    fn leading_zeros_are_a_total_order() {
        // Same value, differing zero padding: never Equal, and antisymmetric.
        assert_eq!(natural_cmp("007", "7"), Ordering::Greater);
        assert_eq!(natural_cmp("7", "007"), Ordering::Less);
        assert_eq!(sorted(vec!["v007", "v7", "v08"]), vec!["v7", "v007", "v08"]);
    }

    #[test]
    fn long_numbers_compare_without_overflow() {
        assert_eq!(
            natural_cmp("file99999999999999999999", "file100000000000000000000"),
            Ordering::Less,
        );
    }

    #[test]
    fn comparator_is_antisymmetric_and_transitive() {
        let names = [
            "", "A", "a", "É", "é", "Б", "б", "0", "00", "1", "file2", "file02", "file10", "가",
        ];

        for a in names {
            for b in names {
                assert_eq!(natural_cmp(a, b), natural_cmp(b, a).reverse());
                for c in names {
                    if natural_cmp(a, b) != Ordering::Greater
                        && natural_cmp(b, c) != Ordering::Greater
                    {
                        assert_ne!(natural_cmp(a, c), Ordering::Greater);
                    }
                }
            }
        }
    }
}
