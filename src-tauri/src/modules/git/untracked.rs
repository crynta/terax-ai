//! Untracked directories in the changes list.
//!
//! `git status --untracked-files=all` enumerates every untracked file on every
//! refresh, which for a freshly generated or unignored tree can be tens of
//! thousands of paths. `normal` reports each untracked directory as a single
//! `dir/` entry. The panel is a flat file list, so small directories are
//! expanded back into files, under a total budget; a directory that would
//! exceed the budget stays collapsed, and the listing is stopped at the budget
//! instead of being read to the end.

use crate::modules::git::types::GitChangedFile;

/// Files shown across all expanded untracked directories.
pub const MAX_EXPANDED_FILES: usize = 500;
/// Directories expanded per refresh; each costs one git invocation.
pub const MAX_EXPANDED_DIRS: usize = 16;
/// Bytes of listing read before the walk is abandoned.
pub const LISTING_CAP_BYTES: usize = 256 * 1024;

pub fn is_untracked_dir(file: &GitChangedFile) -> bool {
    file.untracked && file.path.ends_with('/')
}

/// The `-z` listing of a directory, or `None` when it holds more than `budget`
/// entries or contains a path we cannot represent.
pub fn parse_listing(listing: &[u8], budget: usize) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for raw in listing.split(|b| *b == 0).filter(|part| !part.is_empty()) {
        if out.len() >= budget {
            return None;
        }
        out.push(String::from_utf8(raw.to_vec()).ok()?);
    }
    Some(out)
}

fn file_entry(template: &GitChangedFile, path: String) -> GitChangedFile {
    GitChangedFile {
        path,
        original_path: None,
        index_status: template.index_status.clone(),
        worktree_status: template.worktree_status.clone(),
        staged: template.staged,
        unstaged: template.unstaged,
        untracked: true,
        status_label: template.status_label.clone(),
    }
}

/// Replaces untracked directory entries by their files, in place, spending at
/// most `MAX_EXPANDED_FILES` entries over at most `MAX_EXPANDED_DIRS`
/// directories. `list` returns the files under a directory when there are at
/// most `budget` of them, and `None` to leave it collapsed.
pub fn expand_untracked_dirs(
    files: Vec<GitChangedFile>,
    mut list: impl FnMut(&str, usize) -> Option<Vec<String>>,
) -> Vec<GitChangedFile> {
    let mut budget = MAX_EXPANDED_FILES;
    let mut dirs_left = MAX_EXPANDED_DIRS;
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        if !is_untracked_dir(&file) {
            out.push(file);
            continue;
        }
        let expanded = if budget == 0 || dirs_left == 0 {
            None
        } else {
            dirs_left -= 1;
            list(&file.path, budget).filter(|paths| paths.len() <= budget)
        };
        match expanded {
            Some(paths) if !paths.is_empty() => {
                budget -= paths.len();
                out.extend(paths.into_iter().map(|path| file_entry(&file, path)));
            }
            // Nothing left to list (everything inside is ignored), or too much.
            Some(_) => {}
            None => out.push(file),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn untracked(path: &str) -> GitChangedFile {
        GitChangedFile {
            path: path.into(),
            original_path: None,
            index_status: "?".into(),
            worktree_status: "?".into(),
            staged: false,
            unstaged: true,
            untracked: true,
            status_label: "Untracked".into(),
        }
    }

    fn tracked(path: &str) -> GitChangedFile {
        GitChangedFile {
            untracked: false,
            index_status: " ".into(),
            worktree_status: "M".into(),
            ..untracked(path)
        }
    }

    fn paths(files: &[GitChangedFile]) -> Vec<&str> {
        files.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn only_untracked_entries_ending_in_a_slash_are_directories() {
        assert!(is_untracked_dir(&untracked("src/new/")));
        assert!(!is_untracked_dir(&untracked("src/new.rs")));
        assert!(!is_untracked_dir(&tracked("src/dir/")));
    }

    #[test]
    fn listings_parse_nul_separated_paths_and_respect_the_budget() {
        assert_eq!(
            parse_listing(b"a/x\0a/y z\0", 5),
            Some(vec!["a/x".into(), "a/y z".into()])
        );
        assert_eq!(parse_listing(b"", 5), Some(vec![]));
        assert_eq!(parse_listing(b"a\0b\0c\0", 2), None, "over budget");
        assert_eq!(
            parse_listing(b"a\0b\0", 2),
            Some(vec!["a".into(), "b".into()])
        );
        assert_eq!(
            parse_listing(&[b'a', 0xff, 0], 5),
            None,
            "not representable"
        );
    }

    #[test]
    fn small_directories_become_files_in_place_and_tracked_entries_are_untouched() {
        let input = vec![
            tracked("a.rs"),
            untracked("new/"),
            untracked("loose.txt"),
            tracked("z.rs"),
        ];
        let out = expand_untracked_dirs(input, |dir, _| {
            assert_eq!(dir, "new/");
            Some(vec!["new/a.rs".into(), "new/sub/b.rs".into()])
        });
        assert_eq!(
            paths(&out),
            vec!["a.rs", "new/a.rs", "new/sub/b.rs", "loose.txt", "z.rs"]
        );
        assert!(out[1].untracked && out[1].unstaged && !out[1].staged);
        assert_eq!(out[1].status_label, "Untracked");
        assert_eq!(out[3].path, "loose.txt");
    }

    #[test]
    fn a_directory_that_is_too_large_or_unreadable_stays_collapsed() {
        let out = expand_untracked_dirs(
            vec![untracked("big/"), untracked("ok/"), untracked("bad/")],
            |dir, _| match dir {
                "ok/" => Some(vec!["ok/f".into()]),
                _ => None,
            },
        );
        assert_eq!(paths(&out), vec!["big/", "ok/f", "bad/"]);
    }

    #[test]
    fn a_directory_of_only_ignored_files_disappears() {
        let out = expand_untracked_dirs(vec![untracked("empty/")], |_, _| Some(vec![]));
        assert!(out.is_empty());
    }

    #[test]
    fn the_budget_is_shared_across_directories_and_passed_down() {
        let mut offered = Vec::new();
        let out = expand_untracked_dirs(
            vec![untracked("one/"), untracked("two/"), untracked("three/")],
            |dir, budget| {
                offered.push((dir.to_string(), budget));
                let count = if dir == "one/" {
                    MAX_EXPANDED_FILES - 1
                } else {
                    5
                };
                Some((0..count).map(|i| format!("{dir}{i}")).collect())
            },
        );
        assert_eq!(offered[0], ("one/".into(), MAX_EXPANDED_FILES));
        assert_eq!(offered[1], ("two/".into(), 1), "only one slot was left");
        assert_eq!(
            out.len(),
            MAX_EXPANDED_FILES - 1 + 2,
            "two/ and three/ stay collapsed"
        );
        assert!(paths(&out).ends_with(&["two/", "three/"]));
    }

    #[test]
    fn the_number_of_git_invocations_is_bounded() {
        let dirs: Vec<_> = (0..40).map(|i| untracked(&format!("d{i}/"))).collect();
        let mut calls = 0;
        let out = expand_untracked_dirs(dirs, |dir, _| {
            calls += 1;
            Some(vec![format!("{dir}f")])
        });
        assert_eq!(calls, MAX_EXPANDED_DIRS);
        assert_eq!(out.len(), 40);
        assert!(out[MAX_EXPANDED_DIRS..]
            .iter()
            .all(|f| f.path.ends_with('/')));
    }
}
