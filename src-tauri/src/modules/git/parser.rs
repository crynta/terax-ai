use crate::modules::git::types::GitChangedFile;

#[derive(Default)]
pub struct PorcelainV2 {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub files: Vec<GitChangedFile>,
}

pub fn parse_porcelain_v2(stdout: &str) -> PorcelainV2 {
    let mut out = PorcelainV2 {
        branch: "HEAD".into(),
        ..Default::default()
    };
    let mut tokens = stdout.split('\0').filter(|t| !t.is_empty()).peekable();
    while let Some(tok) = tokens.next() {
        if let Some(rest) = tok.strip_prefix("# branch.head ") {
            out.branch = rest.to_string();
            out.is_detached = rest == "(detached)";
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.upstream ") {
            out.upstream = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.ab ") {
            let mut parts = rest.split_ascii_whitespace();
            if let Some(a) = parts.next() {
                out.ahead = a.trim_start_matches('+').parse().unwrap_or(0);
            }
            if let Some(b) = parts.next() {
                out.behind = b.trim_start_matches('-').parse().unwrap_or(0);
            }
            continue;
        }
        if tok.starts_with("# ") {
            continue;
        }
        if let Some(rest) = tok.strip_prefix("1 ") {
            if let Some(file) = parse_ordinary(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("2 ") {
            let orig = tokens.next().unwrap_or("").to_string();
            if let Some(file) = parse_renamed(rest, orig) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("u ") {
            if let Some(file) = parse_unmerged(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("? ") {
            out.files.push(make_file('?', '?', rest, None));
            continue;
        }
    }
    out
}

fn skip_fields(s: &str, n: usize) -> Option<&str> {
    let mut rest = s;
    for _ in 0..n {
        let idx = rest.find(' ')?;
        rest = &rest[idx + 1..];
    }
    Some(rest)
}

fn parse_ordinary(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 7)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, path, None))
}

fn parse_renamed(rest: &str, orig_path: String) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let after = skip_fields(rest, 8)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, after, Some(orig_path)))
}

fn parse_unmerged(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 9)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, path, None))
}

// porcelain v2 uses '.' to mean "unchanged"; downstream logic mirrors v1 spaces.
fn xy_chars(xy: &str) -> (char, char) {
    let mut it = xy.chars();
    let to_space = |c: char| if c == '.' { ' ' } else { c };
    (
        to_space(it.next().unwrap_or(' ')),
        to_space(it.next().unwrap_or(' ')),
    )
}

fn make_file(
    index_status: char,
    worktree_status: char,
    path: &str,
    original_path: Option<String>,
) -> GitChangedFile {
    GitChangedFile {
        path: path.to_string(),
        original_path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        staged: is_staged(index_status, worktree_status),
        unstaged: is_unstaged(index_status, worktree_status),
        untracked: index_status == '?' && worktree_status == '?',
        status_label: status_label(index_status, worktree_status),
    }
}

fn is_staged(index_status: char, worktree_status: char) -> bool {
    index_status != ' ' && !(index_status == '?' && worktree_status == '?')
}

fn is_unstaged(index_status: char, worktree_status: char) -> bool {
    worktree_status != ' ' || (index_status == '?' && worktree_status == '?')
}

fn status_label(index_status: char, worktree_status: char) -> String {
    match (index_status, worktree_status) {
        ('?', '?') => "Untracked".into(),
        ('A', _) => "Added".into(),
        ('M', _) | (_, 'M') => "Modified".into(),
        ('D', _) | (_, 'D') => "Deleted".into(),
        ('R', _) | (_, 'R') => "Renamed".into(),
        ('C', _) | (_, 'C') => "Copied".into(),
        ('U', _) | (_, 'U') => "Unmerged".into(),
        _ => "Changed".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn ordinary(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 aaaa bbbb {path}\0")
    }

    #[test]
    fn porcelain_v2_parses_branch_and_files() {
        let stdout = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 abc def src/a.rs\0",
            "2 R. N... 100644 100644 100644 abc def R100 src/new.rs\0src/old.rs\0",
            "? src/untracked.rs\0",
        );
        let parsed = parse_porcelain_v2(stdout);
        assert_eq!(parsed.branch, "main");
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(!parsed.is_detached);
        assert_eq!(parsed.files.len(), 3);
        assert_eq!(parsed.files[0].path, "src/a.rs");
        assert!(parsed.files[0].unstaged);
        assert_eq!(parsed.files[1].path, "src/new.rs");
        assert_eq!(parsed.files[1].original_path.as_deref(), Some("src/old.rs"));
        assert!(parsed.files[1].staged);
        assert_eq!(parsed.files[2].path, "src/untracked.rs");
        assert!(parsed.files[2].untracked);
    }

    #[test]
    fn handles_detached_head() {
        let parsed = parse_porcelain_v2("# branch.oid abc\0# branch.head (detached)\0");
        assert!(parsed.is_detached);
        assert_eq!(parsed.branch, "(detached)");
        assert!(parsed.upstream.is_none());
    }

    #[test]
    fn empty_input_yields_safe_defaults() {
        let parsed = parse_porcelain_v2("");
        assert_eq!(parsed.branch, "HEAD");
        assert!(parsed.files.is_empty());
        assert_eq!(parsed.ahead, 0);
        assert_eq!(parsed.behind, 0);
        assert!(!parsed.is_detached);
        assert!(parsed.upstream.is_none());
    }

    #[test]
    fn preserves_paths_with_spaces() {
        let parsed = parse_porcelain_v2(&ordinary(".M", "src/my file name.rs"));
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "src/my file name.rs");
    }

    #[test]
    fn rename_consumes_orig_token_without_eating_next_entry() {
        let stdout = format!(
            "2 R. N... 100644 100644 100644 abc def R100 new.rs\0old.rs\0{}",
            ordinary(".M", "after.rs"),
        );
        let parsed = parse_porcelain_v2(&stdout);
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].path, "new.rs");
        assert_eq!(parsed.files[0].original_path.as_deref(), Some("old.rs"));
        assert_eq!(parsed.files[0].status_label, "Renamed");
        assert_eq!(parsed.files[1].path, "after.rs");
        assert!(parsed.files[1].original_path.is_none());
    }

    #[test]
    fn unmerged_entry_parsed_and_labeled() {
        let parsed =
            parse_porcelain_v2("u UU N... 100644 100644 100644 100644 a b c conflict.rs\0");
        assert_eq!(parsed.files.len(), 1);
        let f = &parsed.files[0];
        assert_eq!(f.path, "conflict.rs");
        assert_eq!(f.status_label, "Unmerged");
        assert!(f.staged);
        assert!(f.unstaged);
    }

    #[test]
    fn staged_unstaged_untracked_matrix() {
        let cases = [
            (".M", false, true, false, "Modified"),
            ("M.", true, false, false, "Modified"),
            ("MM", true, true, false, "Modified"),
            ("A.", true, false, false, "Added"),
            ("D.", true, false, false, "Deleted"),
            (".D", false, true, false, "Deleted"),
        ];
        for (xy, staged, unstaged, untracked, label) in cases {
            let parsed = parse_porcelain_v2(&ordinary(xy, "f.rs"));
            let f = &parsed.files[0];
            assert_eq!(f.staged, staged, "staged for {xy}");
            assert_eq!(f.unstaged, unstaged, "unstaged for {xy}");
            assert_eq!(f.untracked, untracked, "untracked for {xy}");
            assert_eq!(f.status_label, label, "label for {xy}");
        }
    }

    #[test]
    fn untracked_is_unstaged_but_not_staged() {
        let parsed = parse_porcelain_v2("? new.rs\0");
        let f = &parsed.files[0];
        assert!(f.untracked);
        assert!(!f.staged);
        assert!(f.unstaged);
        assert_eq!(f.status_label, "Untracked");
        assert_eq!(f.index_status, "?");
        assert_eq!(f.worktree_status, "?");
    }

    #[test]
    fn malformed_entries_are_skipped_without_panic() {
        let parsed = parse_porcelain_v2("1 .M\0? ok.rs\0");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "ok.rs");
    }

    #[test]
    fn branch_ab_tolerates_non_numeric() {
        let ok = parse_porcelain_v2("# branch.ab +5 -3\0");
        assert_eq!((ok.ahead, ok.behind), (5, 3));
        let garbage = parse_porcelain_v2("# branch.ab +x -y\0");
        assert_eq!((garbage.ahead, garbage.behind), (0, 0));
    }

    proptest! {
        #[test]
        fn parse_porcelain_never_panics(input in ".*") {
            let _ = parse_porcelain_v2(&input);
        }

        #[test]
        fn parsed_files_paths_are_preserved(
            path in "[A-Za-z0-9_/\\-. ]{1,80}"
        ) {
            let parsed = parse_porcelain_v2(&format!("? {path}\0"));
            prop_assert!(parsed.files.len() <= 1);
            if !parsed.files.is_empty() {
                prop_assert_eq!(&parsed.files[0].path, &path);
            }
        }

        #[test]
        fn xy_dot_maps_to_space(xy in "(\\.|[A-Z?]){2}") {
            let (a, b) = xy_chars(&xy);
            prop_assert!(a != '.');
            prop_assert!(b != '.');
        }

        #[test]
        fn ahead_behind_non_negative(ahead in 0u32..=1000, behind in 0u32..=1000) {
            let parsed = parse_porcelain_v2(&format!(
                "# branch.ab +{ahead} -{behind}\0"
            ));
            prop_assert_eq!(parsed.ahead, ahead);
            prop_assert_eq!(parsed.behind, behind);
        }
    }
}
