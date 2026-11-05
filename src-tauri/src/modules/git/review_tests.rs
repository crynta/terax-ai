//! Integration tests for the review backend against real temporary
//! repositories: scopes, summaries, structured diffs and hunk operations.

use crate::modules::git::diff::FileStatus;
use crate::modules::git::review::{
    self, ApplyHunksRequest, ApplyMode, ApplySelection, CheckpointEndpoint, ContentsOmitted,
    DiffSide, GitDiffScope, HunkSelection, RefusalCode,
};
use crate::modules::git::testutil::TestRepo;

pub(super) fn summary(repo: &TestRepo, scope: &GitDiffScope) -> review::GitDiffSummary {
    review::diff_summary(&repo.registry, &repo.path(), scope, &repo.ws).expect("summary")
}

pub(super) fn file_diff(repo: &TestRepo, scope: &GitDiffScope, path: &str) -> review::GitFileDiff {
    review::diff_file(
        &repo.registry,
        &repo.path(),
        scope,
        path,
        None,
        true,
        &repo.ws,
    )
    .expect("file diff")
}

pub(super) fn numbered(count: usize, prefix: &str) -> String {
    (1..=count).map(|i| format!("{prefix}{i}\n")).collect()
}

pub(super) fn find<'a>(
    summary: &'a review::GitDiffSummary,
    path: &str,
) -> &'a crate::modules::git::diff::DiffFileSummary {
    summary
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not in {:?}", summary.files))
}

pub(super) fn apply(
    repo: &TestRepo,
    scope: GitDiffScope,
    path: &str,
    mode: ApplyMode,
    selection: ApplySelection,
) -> review::ApplyOutcome {
    review::apply_hunks(
        &repo.registry,
        &repo.path(),
        &ApplyHunksRequest {
            scope,
            path: path.to_string(),
            old_path: None,
            mode,
            selection,
        },
        &repo.ws,
    )
    .expect("apply")
}

pub(super) fn hunks(ids: &[String]) -> ApplySelection {
    ApplySelection::Hunks {
        items: ids
            .iter()
            .map(|id| HunkSelection {
                id: id.clone(),
                lines: None,
            })
            .collect(),
    }
}

#[test]
fn uncommitted_summary_covers_modified_deleted_renamed_untracked_and_binary() {
    let repo = TestRepo::new();
    repo.write("keep.txt", &numbered(10, "k"));
    repo.write("gone.txt", "bye\n");
    repo.write("old name.txt", &numbered(20, "r"));
    repo.write("bin.dat", "x");
    repo.commit_all("fixtures");

    repo.write(
        "keep.txt",
        &numbered(10, "k").replace("k5\n", "K5\nextra\n"),
    );
    std::fs::remove_file(repo.root.join("gone.txt")).unwrap();
    repo.git(&["mv", "old name.txt", "new name \u{e9}.txt"]);
    repo.write("untracked dir/new file.txt", "a\nb\nc");
    repo.write_bytes("blob.bin", &[0, 1, 2, 3]);
    repo.write_bytes("bin.dat", &[0, 9, 9]);

    let result = summary(&repo, &GitDiffScope::Uncommitted);
    assert!(!result.truncated && !result.untracked_truncated);

    let keep = find(&result, "keep.txt");
    assert_eq!(keep.status, FileStatus::Modified);
    assert_eq!((keep.added, keep.removed), (2, 1));

    assert_eq!(find(&result, "gone.txt").status, FileStatus::Deleted);
    assert_eq!(find(&result, "gone.txt").removed, 1);

    let renamed = find(&result, "new name \u{e9}.txt");
    assert_eq!(renamed.status, FileStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("old name.txt"));

    let untracked = find(&result, "untracked dir/new file.txt");
    assert_eq!(untracked.status, FileStatus::Untracked);
    assert_eq!((untracked.added, untracked.removed), (3, 0));
    assert!(!untracked.approximate);

    assert!(find(&result, "blob.bin").binary);
    assert!(find(&result, "bin.dat").binary);
    assert_eq!(result.totals.files as usize, result.files.len());
    assert_eq!(result.totals.binary, 2);
    assert!(matches!(result.from, DiffSide::Rev { .. }));
    assert_eq!(result.to, DiffSide::Worktree { tree: None });
}

#[test]
fn staged_and_unstaged_scopes_split_the_same_changes() {
    let repo = TestRepo::new();
    repo.write("a.txt", &numbered(6, "a"));
    repo.write("b.txt", "b\n");
    repo.commit_all("base");

    repo.write("a.txt", &numbered(6, "a").replace("a2\n", "A2\n"));
    repo.git(&["add", "a.txt"]);
    repo.write(
        "a.txt",
        &numbered(6, "a")
            .replace("a2\n", "A2\n")
            .replace("a5\n", "A5\n"),
    );
    repo.write("b.txt", "B\n");
    repo.write("fresh.txt", "new\n");

    let staged = summary(&repo, &GitDiffScope::Staged);
    assert_eq!(staged.files.len(), 1);
    assert_eq!(
        (find(&staged, "a.txt").added, find(&staged, "a.txt").removed),
        (1, 1)
    );

    let unstaged = summary(&repo, &GitDiffScope::Unstaged);
    let paths: Vec<_> = unstaged.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["a.txt", "b.txt", "fresh.txt"]);
    assert_eq!(find(&unstaged, "fresh.txt").status, FileStatus::Untracked);
    assert_eq!(unstaged.from, DiffSide::Index);

    let all = summary(&repo, &GitDiffScope::Uncommitted);
    assert_eq!(
        (find(&all, "a.txt").added, find(&all, "a.txt").removed),
        (2, 2)
    );
}

#[test]
fn unborn_head_diffs_against_the_empty_tree() {
    let repo = TestRepo::unborn();
    repo.write("first.txt", "1\n2\n");
    repo.git(&["add", "first.txt"]);
    repo.write("loose.txt", "x\n");

    let staged = summary(&repo, &GitDiffScope::Staged);
    assert_eq!(find(&staged, "first.txt").status, FileStatus::Added);
    assert_eq!(find(&staged, "first.txt").added, 2);

    let all = summary(&repo, &GitDiffScope::Uncommitted);
    assert_eq!(find(&all, "first.txt").status, FileStatus::Added);
    assert_eq!(find(&all, "loose.txt").status, FileStatus::Untracked);
}

#[test]
fn commit_scope_handles_root_ordinary_and_merge_commits() {
    let repo = TestRepo::new();
    let root_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    repo.write("a.txt", "1\n");
    let second = repo.commit_all("second");

    let root = summary(
        &repo,
        &GitDiffScope::Commit {
            sha: root_sha.clone(),
        },
    );
    assert_eq!(find(&root, "README.md").status, FileStatus::Added);

    let ordinary = summary(&repo, &GitDiffScope::Commit { sha: second });
    assert_eq!(ordinary.files.len(), 1);
    assert_eq!(find(&ordinary, "a.txt").status, FileStatus::Added);

    repo.git(&["switch", "-q", "-c", "side"]);
    repo.write("side.txt", "s\n");
    repo.commit_all("side work");
    repo.git(&["switch", "-q", "main"]);
    repo.write("main.txt", "m\n");
    repo.commit_all("main work");
    repo.git(&["merge", "-q", "--no-ff", "-m", "merge", "side"]);
    let merge = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    let merged = summary(&repo, &GitDiffScope::Commit { sha: merge });
    let paths: Vec<_> = merged.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["side.txt"], "first-parent diff only");
}

#[test]
fn range_scope_is_three_dot_through_the_merge_base() {
    let repo = TestRepo::new();
    repo.git(&["switch", "-q", "-c", "feature"]);
    repo.write("feature.txt", "f\n");
    repo.commit_all("feature work");
    repo.git(&["switch", "-q", "main"]);
    repo.write("main-only.txt", "m\n");
    repo.commit_all("main moved on");

    let scope = GitDiffScope::Range {
        base: "main".into(),
        head: "feature".into(),
    };
    let result = summary(&repo, &scope);
    let paths: Vec<_> = result.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        vec!["feature.txt"],
        "main's own commits are not in the range"
    );

    let mb = review::merge_base(&repo.registry, &repo.path(), "main", "feature", &repo.ws)
        .unwrap()
        .unwrap();
    assert_eq!(result.merge_base.as_deref(), Some(mb.as_str()));
    assert_eq!(mb, repo.git(&["merge-base", "main", "feature"]).trim());
}

#[test]
fn merge_base_of_unrelated_histories_is_none() {
    let repo = TestRepo::new();
    repo.git(&["switch", "-q", "--orphan", "other"]);
    repo.write("x.txt", "x\n");
    repo.git(&["add", "x.txt"]);
    repo.git(&["commit", "-q", "-m", "orphan"]);
    let none = review::merge_base(&repo.registry, &repo.path(), "main", "other", &repo.ws).unwrap();
    assert_eq!(none, None);
    let err = review::diff_summary(
        &repo.registry,
        &repo.path(),
        &GitDiffScope::Range {
            base: "main".into(),
            head: "other".into(),
        },
        &repo.ws,
    );
    assert!(err.is_err());
}

#[test]
fn revisions_that_look_like_options_are_rejected() {
    let repo = TestRepo::new();
    for bad in ["--output=/tmp/x", "-p", "a b", ""] {
        let result = review::diff_summary(
            &repo.registry,
            &repo.path(),
            &GitDiffScope::Commit { sha: bad.into() },
            &repo.ws,
        );
        assert!(result.is_err(), "{bad:?}");
    }
}

#[test]
fn file_diff_returns_structured_hunks_and_both_contents() {
    let repo = TestRepo::new();
    repo.write("src/lib.rs", &numbered(30, "line "));
    repo.commit_all("base");
    let changed = numbered(30, "line ")
        .replace("line 3\n", "LINE 3\n")
        .replace("line 25\n", "line 25\nadded\n");
    repo.write("src/lib.rs", &changed);

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "src/lib.rs");
    assert_eq!(diff.status, FileStatus::Modified);
    assert!(!diff.unchanged && !diff.truncated && !diff.binary);
    assert_eq!(diff.hunks.len(), 2);
    assert_eq!((diff.added, diff.removed), (2, 1));
    let first = &diff.hunks[0];
    assert_eq!(first.old_start, 1);
    assert!(first.lines.iter().any(|l| l.text == b"LINE 3"));
    assert!(!diff.fingerprint.is_empty());
    let contents = diff.contents.expect("contents");
    assert_eq!(contents.original, numbered(30, "line "));
    assert_eq!(contents.modified, changed);

    let again = file_diff(&repo, &GitDiffScope::Unstaged, "src/lib.rs");
    assert_eq!(again.fingerprint, diff.fingerprint);
    assert_eq!(again.hunks[0].id, diff.hunks[0].id);
}

#[test]
fn file_diff_marks_a_missing_trailing_newline() {
    let repo = TestRepo::new();
    repo.write("n.txt", "one\ntwo");
    repo.commit_all("no newline");
    repo.write("n.txt", "one\ntwo\n");
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "n.txt");
    let lines = &diff.hunks[0].lines;
    assert!(lines.iter().any(|l| l.no_newline), "{lines:?}");
}

#[test]
fn file_diff_keeps_carriage_returns_and_unicode_paths() {
    let repo = TestRepo::new();
    repo.write_bytes("dir with space/caf\u{e9}.txt", b"a\r\nb\r\nc\r\n");
    repo.commit_all("crlf");
    repo.write_bytes("dir with space/caf\u{e9}.txt", b"a\r\nB\r\nc\r\n");
    let diff = file_diff(
        &repo,
        &GitDiffScope::Unstaged,
        "dir with space/caf\u{e9}.txt",
    );
    let removed: Vec<_> = diff.hunks[0]
        .lines
        .iter()
        .filter(|l| l.old_line.is_some() && l.new_line.is_none())
        .collect();
    assert_eq!(removed[0].text, b"b\r");
}

#[test]
fn binary_files_report_no_hunks_and_no_contents() {
    let repo = TestRepo::new();
    repo.write_bytes("img.bin", &[0, 1, 2, 3, 4]);
    repo.commit_all("bin");
    repo.write_bytes("img.bin", &[0, 1, 2, 9, 4, 5]);
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "img.bin");
    assert!(diff.binary && diff.hunks.is_empty());
    assert_eq!(diff.contents_omitted, Some(ContentsOmitted::Binary));
    assert!(diff.contents.is_none());
}

#[test]
fn oversized_files_omit_contents_but_still_diff() {
    let repo = TestRepo::new();
    let big = "x".repeat(60) + "\n";
    let original = big.repeat(20_000);
    repo.write("big.txt", &original);
    repo.commit_all("big");
    repo.write("big.txt", &format!("changed\n{original}"));
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "big.txt");
    assert_eq!(diff.contents_omitted, Some(ContentsOmitted::TooLarge));
    assert!(diff.contents.is_none());
    assert_eq!(diff.hunks.len(), 1);
    assert_eq!(diff.added, 1);
}

#[test]
fn a_patch_over_the_cap_is_truncated_to_complete_hunks_with_exact_totals() {
    let repo = TestRepo::new();
    let line = "y".repeat(100) + "\n";
    let original: String = (0..40_000).map(|i| format!("{i}{line}")).collect();
    repo.write("huge.txt", &original);
    repo.commit_all("huge");
    let changed: String = (0..40_000).map(|i| format!("{i}z{line}")).collect();
    repo.write("huge.txt", &changed);

    let diff = review::diff_file(
        &repo.registry,
        &repo.path(),
        &GitDiffScope::Unstaged,
        "huge.txt",
        None,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(diff.truncated);
    assert_eq!(diff.contents_omitted, Some(ContentsOmitted::Disabled));
    assert_eq!(diff.added, 40_000);
    assert_eq!(diff.removed, 40_000);
    for hunk in &diff.hunks {
        let old = hunk.lines.iter().filter(|l| l.old_line.is_some()).count() as u32;
        assert_eq!(old, hunk.old_lines);
    }
    let shown: u32 = diff.hunks.iter().map(|h| h.added).sum();
    assert!(shown < 40_000);
}

#[test]
fn untracked_files_diff_as_a_single_added_hunk() {
    let repo = TestRepo::new();
    repo.write("notes/todo.md", "- one\n- two\n");
    let diff = file_diff(&repo, &GitDiffScope::Uncommitted, "notes/todo.md");
    assert_eq!(diff.status, FileStatus::Untracked);
    assert_eq!(diff.hunks.len(), 1);
    assert_eq!(diff.hunks[0].lines.len(), 2);
    assert_eq!(diff.contents.as_ref().unwrap().original, "");
    assert_eq!(diff.contents.unwrap().modified, "- one\n- two\n");
}

#[test]
fn renamed_files_diff_against_their_old_path() {
    let repo = TestRepo::new();
    repo.write("before.txt", &numbered(20, "r"));
    repo.commit_all("base");
    repo.git(&["mv", "before.txt", "after.txt"]);
    repo.write("after.txt", &numbered(20, "r").replace("r10\n", "R10\n"));
    repo.git(&["add", "after.txt"]);

    let result = review::diff_file(
        &repo.registry,
        &repo.path(),
        &GitDiffScope::Staged,
        "after.txt",
        Some("before.txt"),
        true,
        &repo.ws,
    )
    .unwrap();
    assert_eq!(result.status, FileStatus::Renamed);
    assert_eq!(result.old_path.as_deref(), Some("before.txt"));
    assert_eq!(result.hunks.len(), 1);
    assert_eq!(result.contents.unwrap().original, numbered(20, "r"));
}

#[test]
fn a_file_without_changes_is_reported_as_unchanged() {
    let repo = TestRepo::new();
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "README.md");
    assert!(diff.unchanged);
    assert!(diff.hunks.is_empty());
}

#[test]
fn file_diff_rejects_paths_outside_the_repository() {
    let repo = TestRepo::new();
    for bad in ["../outside", "/etc/passwd", "a/../../b", ":(glob)*"] {
        let result = review::diff_file(
            &repo.registry,
            &repo.path(),
            &GitDiffScope::Unstaged,
            bad,
            None,
            true,
            &repo.ws,
        );
        assert!(result.is_err(), "{bad}");
    }
}

#[test]
fn glob_characters_in_file_names_are_literal() {
    // (a literal file name, a sibling the same text would match as a glob).
    // `*` and `?` are not legal in Windows file names; `[...]` is legal there
    // and is a glob character to git too.
    let mut pairs = vec![("a[1].txt", "a1.txt")];
    if !cfg!(windows) {
        pairs.push(("b*.txt", "bb.txt"));
        pairs.push(("c?.txt", "cx.txt"));
    }
    let repo = TestRepo::new();
    for (literal, sibling) in &pairs {
        repo.write(literal, "literal\n");
        repo.write(sibling, "sibling\n");
    }
    repo.commit_all("globs");
    for (literal, sibling) in &pairs {
        repo.write(literal, "LITERAL\n");
        repo.write(sibling, "SIBLING\n");
    }

    for (literal, sibling) in &pairs {
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            literal,
            ApplyMode::Stage,
            ApplySelection::File,
        );
        assert!(outcome.applied, "{literal}: {:?}", outcome.refusal);
        assert_eq!(repo.staged(literal), "LITERAL\n");
        assert_eq!(
            repo.staged(sibling),
            "sibling\n",
            "{literal} must not match {sibling} as a wildcard"
        );
    }
}

#[test]
fn staging_a_subset_of_hunks_leaves_the_rest_unstaged() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    let changed = numbered(40, "l")
        .replace("l3\n", "L3\n")
        .replace("l20\n", "L20\n")
        .replace("l38\n", "L38\n");
    repo.write("f.txt", &changed);

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    assert_eq!(diff.hunks.len(), 3);
    let middle = diff.hunks[1].id.clone();
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "f.txt",
        ApplyMode::Stage,
        hunks(&[middle]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);

    assert_eq!(
        repo.staged("f.txt"),
        numbered(40, "l").replace("l20\n", "L20\n")
    );
    assert_eq!(repo.read("f.txt"), changed, "the worktree is untouched");
    let remaining = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    assert_eq!(remaining.hunks.len(), 2);
}

#[test]
fn unstaging_a_hunk_moves_only_it_back_to_the_worktree_side() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    let changed = numbered(40, "l")
        .replace("l3\n", "L3\n")
        .replace("l30\n", "L30\n");
    repo.write("f.txt", &changed);
    repo.git(&["add", "f.txt"]);

    let staged = file_diff(&repo, &GitDiffScope::Staged, "f.txt");
    assert_eq!(staged.hunks.len(), 2);
    let first = staged.hunks[0].id.clone();
    let outcome = apply(
        &repo,
        GitDiffScope::Staged,
        "f.txt",
        ApplyMode::Unstage,
        hunks(&[first]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(
        repo.staged("f.txt"),
        numbered(40, "l").replace("l30\n", "L30\n")
    );
    assert_eq!(repo.read("f.txt"), changed);
}

#[test]
fn reverting_a_hunk_restores_it_in_the_worktree_only() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    let changed = numbered(40, "l")
        .replace("l3\n", "L3\n")
        .replace("l30\n", "L30\nextra\n");
    repo.write("f.txt", &changed);

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    let second = diff.hunks[1].id.clone();
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "f.txt",
        ApplyMode::Revert,
        hunks(&[second]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(
        repo.read("f.txt"),
        numbered(40, "l").replace("l3\n", "L3\n")
    );
    assert_eq!(repo.staged("f.txt"), numbered(40, "l"));
}

#[test]
fn staging_individual_lines_inside_a_hunk() {
    let repo = TestRepo::new();
    repo.write("f.txt", "a\nb\nc\nd\ne\n");
    repo.commit_all("base");
    repo.write("f.txt", "a\nB\nC\nd\nE\ne\n");

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    assert_eq!(diff.hunks.len(), 1);
    let hunk = &diff.hunks[0];
    // Take only "-b" and "+B".
    let pick: Vec<u32> = hunk
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| {
            (l.text == b"b" && l.old_line.is_some()) || (l.text == b"B" && l.new_line.is_some())
        })
        .map(|(i, _)| i as u32)
        .collect();
    assert_eq!(pick.len(), 2);
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "f.txt",
        ApplyMode::Stage,
        ApplySelection::Hunks {
            items: vec![HunkSelection {
                id: hunk.id.clone(),
                lines: Some(pick),
            }],
        },
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(repo.staged("f.txt"), "a\nc\nB\nd\ne\n");
    assert_eq!(repo.read("f.txt"), "a\nB\nC\nd\nE\ne\n");
}

pub(super) fn lines_of(hunk: &crate::modules::git::diff::DiffHunk) -> Vec<u32> {
    hunk.lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.kind != crate::modules::git::diff::LineKind::Context)
        .map(|(i, _)| i as u32)
        .collect()
}

#[test]
fn staging_every_changed_line_one_at_a_time_reproduces_the_worktree() {
    let repo = TestRepo::new();
    repo.write("f.txt", "1\n2\n3\n4\n5\n6\n7\n8\n");
    repo.commit_all("base");
    let target = "1\nTWO\n3\n4\nfour and a half\n5\n7\n8\nnine\n";
    repo.write("f.txt", target);

    for _ in 0..20 {
        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
        if diff.hunks.is_empty() {
            break;
        }
        let hunk = &diff.hunks[0];
        let first_line = lines_of(hunk)[0];
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            "f.txt",
            ApplyMode::Stage,
            ApplySelection::Hunks {
                items: vec![HunkSelection {
                    id: hunk.id.clone(),
                    lines: Some(vec![first_line]),
                }],
            },
        );
        assert!(outcome.applied, "{:?}", outcome.refusal);
    }
    assert_eq!(repo.staged("f.txt"), target);
    assert!(file_diff(&repo, &GitDiffScope::Unstaged, "f.txt").unchanged);
}

#[test]
fn reverting_every_changed_line_one_at_a_time_restores_the_original() {
    let repo = TestRepo::new();
    let original = "1\n2\n3\n4\n5\n6\n7\n8\n";
    repo.write("f.txt", original);
    repo.commit_all("base");
    repo.write("f.txt", "1\nTWO\n3\n4\nfour and a half\n5\n7\n8\nnine\n");

    for _ in 0..20 {
        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
        if diff.hunks.is_empty() {
            break;
        }
        let hunk = &diff.hunks[0];
        let last_line = *lines_of(hunk).last().unwrap();
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            "f.txt",
            ApplyMode::Revert,
            ApplySelection::Hunks {
                items: vec![HunkSelection {
                    id: hunk.id.clone(),
                    lines: Some(vec![last_line]),
                }],
            },
        );
        assert!(outcome.applied, "{:?}", outcome.refusal);
    }
    assert_eq!(repo.read("f.txt"), original);
}

#[test]
fn unstaging_lines_one_at_a_time_returns_the_index_to_head() {
    let repo = TestRepo::new();
    let original = "a\nb\nc\nd\ne\n";
    repo.write("f.txt", original);
    repo.commit_all("base");
    repo.write("f.txt", "a\nB\nc\nx\ny\ne\n");
    repo.git(&["add", "f.txt"]);

    for _ in 0..20 {
        let diff = file_diff(&repo, &GitDiffScope::Staged, "f.txt");
        if diff.hunks.is_empty() {
            break;
        }
        let hunk = &diff.hunks[0];
        let pick = lines_of(hunk)[0];
        let outcome = apply(
            &repo,
            GitDiffScope::Staged,
            "f.txt",
            ApplyMode::Unstage,
            ApplySelection::Hunks {
                items: vec![HunkSelection {
                    id: hunk.id.clone(),
                    lines: Some(vec![pick]),
                }],
            },
        );
        assert!(outcome.applied, "{:?}", outcome.refusal);
    }
    assert_eq!(repo.staged("f.txt"), original);
}

#[test]
fn stale_hunk_ids_are_refused_without_touching_anything() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(20, "l"));
    repo.commit_all("base");
    repo.write("f.txt", &numbered(20, "l").replace("l5\n", "L5\n"));
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    let id = diff.hunks[0].id.clone();

    repo.write("f.txt", &numbered(20, "l").replace("l5\n", "different\n"));
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "f.txt",
        ApplyMode::Stage,
        hunks(std::slice::from_ref(&id)),
    );
    assert!(!outcome.applied);
    let refusal = outcome.refusal.unwrap();
    assert_eq!(refusal.code, RefusalCode::StaleHunks);
    assert_eq!(refusal.hunk_ids, vec![id]);
    assert_eq!(repo.staged("f.txt"), numbered(20, "l"));
}

#[test]
fn whole_file_actions_cover_new_deleted_and_binary_files() {
    let repo = TestRepo::new();
    repo.write("gone.txt", "bye\n");
    repo.write_bytes("img.bin", &[0, 1, 2]);
    repo.commit_all("base");
    std::fs::remove_file(repo.root.join("gone.txt")).unwrap();
    repo.write_bytes("img.bin", &[0, 9, 9, 9]);
    repo.write("new.txt", "fresh\n");

    for path in ["gone.txt", "img.bin", "new.txt"] {
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            path,
            ApplyMode::Stage,
            ApplySelection::File,
        );
        assert!(outcome.applied, "{path}: {:?}", outcome.refusal);
    }
    let staged = summary(&repo, &GitDiffScope::Staged);
    assert_eq!(find(&staged, "gone.txt").status, FileStatus::Deleted);
    assert_eq!(find(&staged, "new.txt").status, FileStatus::Added);
    assert!(find(&staged, "img.bin").binary);

    for path in ["gone.txt", "img.bin", "new.txt"] {
        let outcome = apply(
            &repo,
            GitDiffScope::Staged,
            path,
            ApplyMode::Unstage,
            ApplySelection::File,
        );
        assert!(outcome.applied, "{path}: {:?}", outcome.refusal);
    }
    assert!(summary(&repo, &GitDiffScope::Staged).files.is_empty());
}

#[test]
fn partial_selection_on_a_binary_or_new_file_is_refused() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(10, "l"));
    repo.commit_all("base");
    repo.write("brand-new.txt", "a\nb\nc\n");
    repo.git(&["add", "-N", "brand-new.txt"]);

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "brand-new.txt");
    let hunk = &diff.hunks[0];
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "brand-new.txt",
        ApplyMode::Stage,
        ApplySelection::Hunks {
            items: vec![HunkSelection {
                id: hunk.id.clone(),
                lines: Some(vec![0]),
            }],
        },
    );
    assert!(!outcome.applied);
    assert_eq!(outcome.refusal.unwrap().code, RefusalCode::WholeFileOnly);
}

#[test]
fn modes_are_checked_against_the_scope() {
    let repo = TestRepo::new();
    repo.write("f.txt", "a\n");
    repo.commit_all("base");
    repo.write("f.txt", "b\n");
    for (scope, mode) in [
        (GitDiffScope::Staged, ApplyMode::Stage),
        (GitDiffScope::Unstaged, ApplyMode::Unstage),
        (GitDiffScope::Staged, ApplyMode::Revert),
        (
            GitDiffScope::Range {
                base: "main".into(),
                head: "main".into(),
            },
            ApplyMode::Stage,
        ),
    ] {
        let outcome = apply(&repo, scope, "f.txt", mode, ApplySelection::File);
        assert_eq!(outcome.refusal.unwrap().code, RefusalCode::UnsupportedScope);
    }
    assert_eq!(repo.read("f.txt"), "b\n");
}

#[test]
fn reverting_in_the_uncommitted_scope_handles_added_untracked_and_modified_files() {
    let repo = TestRepo::new();
    repo.write("tracked.txt", "orig\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "edited\n");
    repo.git(&["add", "tracked.txt"]);
    repo.write("staged-new.txt", "n\n");
    repo.git(&["add", "staged-new.txt"]);
    repo.write("loose.txt", "l\n");

    for path in ["tracked.txt", "staged-new.txt", "loose.txt"] {
        let outcome = apply(
            &repo,
            GitDiffScope::Uncommitted,
            path,
            ApplyMode::Revert,
            ApplySelection::File,
        );
        assert!(outcome.applied, "{path}: {:?}", outcome.refusal);
    }
    assert_eq!(repo.read("tracked.txt"), "orig\n");
    assert!(!repo.exists("staged-new.txt"));
    assert!(!repo.exists("loose.txt"));
    assert!(summary(&repo, &GitDiffScope::Uncommitted).files.is_empty());
    assert_eq!(repo.git(&["status", "--porcelain"]).trim(), "");
}

#[test]
fn reverting_a_hunk_in_the_uncommitted_scope_updates_index_and_worktree() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    let changed = numbered(40, "l")
        .replace("l3\n", "L3\n")
        .replace("l30\n", "L30\n");
    repo.write("f.txt", &changed);
    repo.git(&["add", "f.txt"]);

    let diff = file_diff(&repo, &GitDiffScope::Uncommitted, "f.txt");
    assert_eq!(diff.hunks.len(), 2);
    let outcome = apply(
        &repo,
        GitDiffScope::Uncommitted,
        "f.txt",
        ApplyMode::Revert,
        hunks(&[diff.hunks[0].id.clone()]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    let expected = numbered(40, "l").replace("l30\n", "L30\n");
    assert_eq!(repo.read("f.txt"), expected);
    assert_eq!(repo.staged("f.txt"), expected);
}

#[test]
fn reverting_a_hunk_when_the_file_has_unstaged_edits_asks_for_separate_scopes() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    repo.write("f.txt", &numbered(40, "l").replace("l3\n", "L3\n"));
    repo.git(&["add", "f.txt"]);
    repo.write(
        "f.txt",
        &numbered(40, "l")
            .replace("l3\n", "L3\n")
            .replace("l30\n", "L30\n"),
    );
    let diff = file_diff(&repo, &GitDiffScope::Uncommitted, "f.txt");
    let outcome = apply(
        &repo,
        GitDiffScope::Uncommitted,
        "f.txt",
        ApplyMode::Revert,
        hunks(&[diff.hunks[0].id.clone()]),
    );
    assert_eq!(
        outcome.refusal.unwrap().code,
        RefusalCode::NeedsSeparateScopes
    );
}

#[test]
fn mode_only_changes_are_whole_file_operations() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let repo = TestRepo::new();
        repo.write("run.sh", "echo hi\n");
        repo.commit_all("script");
        let path = repo.root.join("run.sh");
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();

        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "run.sh");
        assert_eq!(diff.status, FileStatus::Modified);
        assert!(diff.hunks.is_empty());
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            "run.sh",
            ApplyMode::Stage,
            ApplySelection::File,
        );
        assert!(outcome.applied);
        assert!(repo
            .git(&["ls-files", "-s", "run.sh"])
            .starts_with("100755"));
    }
}

#[test]
fn checkpoint_scope_between_a_checkpoint_and_the_live_worktree_includes_untracked_files() {
    use crate::modules::git::checkpoint;
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp = checkpoint::create(&repo.registry, &repo.path(), "task-1", 1, &repo.ws).unwrap();

    repo.write("a.txt", "two\n");
    repo.write("created.txt", "x\ny\n");
    let scope = GitDiffScope::Checkpoint {
        from: CheckpointEndpoint::Ref {
            name: cp.info.ref_name.clone(),
        },
        to: CheckpointEndpoint::Worktree { tree: None },
    };
    let result = summary(&repo, &scope);
    assert_eq!(find(&result, "a.txt").status, FileStatus::Modified);
    assert_eq!(find(&result, "created.txt").status, FileStatus::Added);
    assert_eq!(find(&result, "created.txt").added, 2);
    assert!(matches!(result.to, DiffSide::Worktree { tree: Some(_) }));

    let file = file_diff(&repo, &scope, "created.txt");
    assert_eq!(file.contents.unwrap().modified, "x\ny\n");

    let both_live = review::diff_summary(
        &repo.registry,
        &repo.path(),
        &GitDiffScope::Checkpoint {
            from: CheckpointEndpoint::Worktree { tree: None },
            to: CheckpointEndpoint::Worktree { tree: None },
        },
        &repo.ws,
    );
    assert!(both_live.is_err());
}

#[test]
fn checkpoint_scope_between_two_checkpoints() {
    use crate::modules::git::checkpoint;
    let repo = TestRepo::new();
    let first = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("turn2.txt", "made in turn 2\n");
    let second = checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();
    let scope = GitDiffScope::Checkpoint {
        from: CheckpointEndpoint::Ref {
            name: first.info.ref_name,
        },
        to: CheckpointEndpoint::Ref {
            name: second.info.ref_name,
        },
    };
    let result = summary(&repo, &scope);
    assert_eq!(result.files.len(), 1);
    assert_eq!(find(&result, "turn2.txt").status, FileStatus::Added);
}
