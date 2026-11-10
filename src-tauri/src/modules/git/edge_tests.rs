//! Edge cases for the review backend: submodules, symlinks, budgets, encodings
//! and concurrent writers, all against real repositories.

use crate::modules::git::checkpoint;
use crate::modules::git::diff::FileStatus;
use crate::modules::git::review::{
    ApplyMode, ApplySelection, ContentsOmitted, GitDiffScope, HunkSelection, RefusalCode,
};
use crate::modules::git::review_tests::{
    apply, file_diff, find, hunks, lines_of, numbered, summary,
};
use crate::modules::git::testutil::{git_in, TestRepo};

fn advance_submodule(repo: &TestRepo) {
    let inner = repo.root.join("vendor/lib");
    git_in(&inner, &["config", "user.name", "T"]);
    git_in(&inner, &["config", "user.email", "t@example.com"]);
    std::fs::write(inner.join("more.txt"), "more\n").unwrap();
    git_in(&inner, &["add", "more.txt"]);
    git_in(&inner, &["commit", "-q", "-m", "advance"]);
}

#[test]
fn submodules_are_flagged_and_only_actionable_as_a_whole() {
    let sub = TestRepo::new();
    sub.write("lib.txt", "lib\n");
    sub.commit_all("lib");
    let repo = TestRepo::new();
    repo.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        &sub.path(),
        "vendor/lib",
    ]);
    repo.commit_all("add submodule");
    advance_submodule(&repo);

    let result = summary(&repo, &GitDiffScope::Unstaged);
    assert!(find(&result, "vendor/lib").submodule);
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "vendor/lib");
    assert!(diff.submodule);
    assert_eq!(diff.contents_omitted, Some(ContentsOmitted::Submodule));
    assert!(diff.hunks.is_empty());

    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "vendor/lib",
        ApplyMode::Stage,
        ApplySelection::File,
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert!(find(&summary(&repo, &GitDiffScope::Staged), "vendor/lib").submodule);
}

#[test]
fn symlinks_diff_as_their_target_text() {
    #[cfg(unix)]
    {
        let repo = TestRepo::new();
        repo.write("target-a", "a\n");
        std::os::unix::fs::symlink("target-a", repo.root.join("link")).unwrap();
        repo.commit_all("link");
        std::fs::remove_file(repo.root.join("link")).unwrap();
        std::os::unix::fs::symlink("target-b", repo.root.join("link")).unwrap();

        let result = summary(&repo, &GitDiffScope::Unstaged);
        assert!(find(&result, "link").symlink);
        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "link");
        assert!(diff.symlink);
        assert_eq!(diff.hunks.len(), 1);
        let contents = diff.contents.unwrap();
        assert_eq!(
            (contents.original.as_str(), contents.modified.as_str()),
            ("target-a", "target-b")
        );
        let outcome = apply(
            &repo,
            GitDiffScope::Unstaged,
            "link",
            ApplyMode::Revert,
            ApplySelection::File,
        );
        assert!(outcome.applied);
        assert_eq!(
            std::fs::read_link(repo.root.join("link"))
                .unwrap()
                .to_string_lossy(),
            "target-a"
        );
    }
}

#[test]
fn a_tracked_symlink_is_diffed_as_itself_not_as_its_target() {
    #[cfg(unix)]
    {
        let repo = TestRepo::new();
        repo.write("AGENTS.md", "rules\n");
        std::os::unix::fs::symlink("AGENTS.md", repo.root.join("CLAUDE.md")).unwrap();
        repo.commit_all("alias");
        repo.write("AGENTS.md", "rules, edited\n");
        std::fs::remove_file(repo.root.join("CLAUDE.md")).unwrap();
        std::os::unix::fs::symlink("OTHER.md", repo.root.join("CLAUDE.md")).unwrap();
        repo.write("OTHER.md", "other\n");

        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "CLAUDE.md");
        assert_eq!(diff.path, "CLAUDE.md");
        assert!(diff.symlink);
        let contents = diff.contents.unwrap();
        assert_eq!(
            (contents.original.as_str(), contents.modified.as_str()),
            ("AGENTS.md", "OTHER.md")
        );

        // A link that points outside the repository is still just a link.
        let (_keep, outside) = {
            let dir = tempfile::tempdir().unwrap();
            let path = std::fs::canonicalize(dir.path()).unwrap();
            (dir, path)
        };
        std::fs::write(outside.join("secret"), "do not read\n").unwrap();
        std::fs::remove_file(repo.root.join("CLAUDE.md")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret"), repo.root.join("CLAUDE.md")).unwrap();
        let diff = file_diff(&repo, &GitDiffScope::Unstaged, "CLAUDE.md");
        assert!(diff.symlink);
        assert!(!diff.contents.unwrap().modified.contains("do not read"));
    }
}

#[test]
fn untracked_line_counts_stop_at_their_budget_and_say_so() {
    let repo = TestRepo::new();
    for i in 0..320 {
        repo.write(&format!("many/f{i:03}.txt"), "a\nb\n");
    }
    let result = summary(&repo, &GitDiffScope::Uncommitted);
    assert_eq!(result.files.len(), 320);
    let counted: Vec<_> = result.files.iter().filter(|f| !f.approximate).collect();
    assert_eq!(counted.len(), 300);
    assert!(counted.iter().all(|f| f.added == 2));
    assert!(result
        .files
        .iter()
        .filter(|f| f.approximate)
        .all(|f| f.added == 0));
    assert!(!result.untracked_truncated);
}

#[test]
fn the_untracked_listing_is_capped_and_flagged() {
    let repo = TestRepo::new();
    for i in 0..2100 {
        repo.write(&format!("gen/f{i:04}"), "x\n");
    }
    let result = summary(&repo, &GitDiffScope::Unstaged);
    assert!(result.untracked_truncated);
    assert_eq!(result.files.len(), 2000);
}

#[test]
fn scopes_work_on_a_detached_head() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    repo.commit_all("second");
    repo.git(&["checkout", "-q", "--detach", "HEAD~1"]);
    repo.write("a.txt", "detached edit\n");
    let result = summary(&repo, &GitDiffScope::Uncommitted);
    assert_eq!(find(&result, "a.txt").status, FileStatus::Untracked);
    repo.git(&["add", "a.txt"]);
    assert_eq!(
        find(&summary(&repo, &GitDiffScope::Staged), "a.txt").status,
        FileStatus::Added
    );
}

#[test]
fn hunks_in_paths_with_spaces_and_unicode_can_be_staged() {
    let repo = TestRepo::new();
    let path = "dir with space/caf\u{e9} \u{4f60}\u{597d}.txt";
    repo.write(path, &numbered(30, "l"));
    repo.commit_all("base");
    repo.write(
        path,
        &numbered(30, "l")
            .replace("l5\n", "L5\n")
            .replace("l25\n", "L25\n"),
    );
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, path);
    assert_eq!(diff.hunks.len(), 2);
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        path,
        ApplyMode::Stage,
        hunks(&[diff.hunks[1].id.clone()]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(
        repo.staged(path),
        numbered(30, "l").replace("l25\n", "L25\n")
    );
}

#[test]
fn crlf_files_stage_hunks_without_corrupting_line_endings() {
    let repo = TestRepo::new();
    let base: String = (1..=30).map(|i| format!("l{i}\r\n")).collect();
    repo.write_bytes("win.txt", base.as_bytes());
    repo.commit_all("crlf");
    let edited = base
        .replace("l5\r\n", "L5\r\n")
        .replace("l25\r\n", "L25\r\n");
    repo.write_bytes("win.txt", edited.as_bytes());
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "win.txt");
    assert_eq!(diff.hunks.len(), 2);
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "win.txt",
        ApplyMode::Stage,
        hunks(&[diff.hunks[0].id.clone()]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(repo.staged("win.txt"), base.replace("l5\r\n", "L5\r\n"));
}

#[test]
fn non_utf8_files_stage_hunks_byte_exactly() {
    let repo = TestRepo::new();
    let mut base: Vec<u8> = Vec::new();
    for i in 1..=30 {
        base.extend_from_slice(format!("line {i} caf").as_bytes());
        base.push(0xe9);
        base.push(b'\n');
    }
    repo.write_bytes("latin1.txt", &base);
    repo.commit_all("latin1");
    let mut edited = base.clone();
    let needle = b"line 5 caf\xe9\n".to_vec();
    let at = edited
        .windows(needle.len())
        .position(|w| w == needle.as_slice())
        .unwrap();
    edited.splice(
        at..at + needle.len(),
        b"line FIVE caf\xe9\n".iter().copied(),
    );
    repo.write_bytes("latin1.txt", &edited);
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "latin1.txt");
    assert_eq!(diff.hunks.len(), 1);
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "latin1.txt",
        ApplyMode::Stage,
        hunks(&[diff.hunks[0].id.clone()]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    let staged = crate::modules::git::testutil::git_command(&repo.root, &["show", ":latin1.txt"])
        .output()
        .unwrap()
        .stdout;
    assert_eq!(staged, edited);
}

#[test]
fn staging_an_end_of_file_newline_change_works_as_a_whole_hunk() {
    let repo = TestRepo::new();
    repo.write("eof.txt", "a\nb\nc");
    repo.commit_all("no newline");
    repo.write("eof.txt", "a\nb\nc\n");
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "eof.txt");
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "eof.txt",
        ApplyMode::Stage,
        hunks(&[diff.hunks[0].id.clone()]),
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(repo.staged("eof.txt"), "a\nb\nc\n");
}

#[test]
fn partial_lines_in_an_end_of_file_hunk_are_refused() {
    let repo = TestRepo::new();
    repo.write("eof.txt", "a\nb\nc");
    repo.commit_all("no newline");
    repo.write("eof.txt", "a\nb\nC\nd\n");
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "eof.txt");
    let hunk = &diff.hunks[0];
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "eof.txt",
        ApplyMode::Stage,
        ApplySelection::Hunks {
            items: vec![HunkSelection {
                id: hunk.id.clone(),
                lines: Some(vec![lines_of(hunk)[0]]),
            }],
        },
    );
    assert_eq!(outcome.refusal.unwrap().code, RefusalCode::WholeFileOnly);
    assert_eq!(repo.staged("eof.txt"), "a\nb\nc");
}

#[test]
fn checkpoints_taken_while_an_agent_writes_stay_valid_and_report_their_consistency() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let repo = TestRepo::new();
    for i in 0..200 {
        repo.write(&format!("src/f{i}.txt"), &format!("{i}\n"));
    }
    repo.commit_all("base");

    let root = repo.root.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let writer = std::thread::spawn(move || {
        let mut n = 0u32;
        while !flag.load(Ordering::Relaxed) {
            let _ = std::fs::write(root.join(format!("src/f{}.txt", n % 200)), format!("{n}\n"));
            let _ = std::fs::write(root.join(format!("churn{}.txt", n % 7)), "x\n");
            let _ = std::fs::remove_file(root.join(format!("churn{}.txt", (n + 3) % 7)));
            n += 1;
        }
    });
    let mut results = Vec::new();
    for turn in 1..=5 {
        results.push(
            checkpoint::create(&repo.registry, &repo.path(), "busy", turn, &repo.ws).unwrap(),
        );
    }
    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();

    for created in &results {
        assert!((1..=3).contains(&created.passes));
        if !created.consistent {
            assert!(created.warnings.contains(&"concurrent-writes".to_string()));
        }
        repo.git(&["cat-file", "-e", &created.info.commit]);
        repo.git(&["ls-tree", &created.info.tree]);
    }
    let listed = checkpoint::list(&repo.registry, &repo.path(), "busy", &repo.ws).unwrap();
    assert_eq!(listed.len(), 5);
}
