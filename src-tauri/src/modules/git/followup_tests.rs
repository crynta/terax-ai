//! Regression tests for the second review round: user diff and discovery
//! config, checkpoint identity and baselines, and worktree removal of files
//! `include` copied in.

use std::path::{Path, PathBuf};

use crate::modules::git::checkpoint::{self, RestoreRefusal};
use crate::modules::git::process::run_git;
use crate::modules::git::review::{ApplyMode, ApplySelection, GitDiffScope, HunkSelection};
use crate::modules::git::review_tests::{apply, file_diff, numbered};
use crate::modules::git::testutil::{scratch, TestRepo};
use crate::modules::git::worktree::{self, RemoveBlocker, WorktreeAddRequest, WorktreeBranch};
use crate::modules::workspace::WorkspaceEnv;

fn one(id: &str) -> ApplySelection {
    ApplySelection::Hunks {
        items: vec![HunkSelection {
            id: id.to_string(),
            lines: None,
        }],
    }
}

// ------------------------------------- 1: the user's diff prefix configuration

#[test]
fn diff_prefix_settings_of_the_user_never_change_what_the_header_parser_sees() {
    let settings: [&[(&str, &str)]; 4] = [
        &[("diff.mnemonicPrefix", "true")],
        &[("diff.noprefix", "true")],
        &[("diff.mnemonicPrefix", "true"), ("diff.noprefix", "true")],
        &[("diff.srcPrefix", "SRC/"), ("diff.dstPrefix", "DST/")],
    ];
    for config in settings {
        let repo = TestRepo::new();
        for (key, value) in config {
            repo.git(&["config", key, value]);
        }
        // `b/x.txt` lives under a directory that is itself named like a prefix.
        for path in ["b/x.txt", "a/y.txt", "src/lib.rs"] {
            repo.write(path, &numbered(40, "l"));
        }
        repo.commit_all("base");
        for path in ["b/x.txt", "a/y.txt", "src/lib.rs"] {
            repo.write(
                path,
                &numbered(40, "l")
                    .replace("l3\n", "L3\n")
                    .replace("l30\n", "L30\n"),
            );
        }

        for path in ["b/x.txt", "a/y.txt", "src/lib.rs"] {
            for scope in [GitDiffScope::Unstaged, GitDiffScope::Uncommitted] {
                let diff = file_diff(&repo, &scope, path);
                assert_eq!(diff.hunks.len(), 2, "{config:?} {path} {scope:?}");
            }

            let diff = file_diff(&repo, &GitDiffScope::Unstaged, path);
            let staged = apply(
                &repo,
                GitDiffScope::Unstaged,
                path,
                ApplyMode::Stage,
                one(&diff.hunks[1].id),
            );
            assert!(staged.applied, "{config:?} {path}: {:?}", staged.refusal);
            assert_eq!(
                repo.staged(path),
                numbered(40, "l").replace("l30\n", "L30\n")
            );

            let in_index = file_diff(&repo, &GitDiffScope::Staged, path);
            assert_eq!(in_index.hunks.len(), 1, "{config:?} {path} staged");
            let unstaged = apply(
                &repo,
                GitDiffScope::Staged,
                path,
                ApplyMode::Unstage,
                one(&in_index.hunks[0].id),
            );
            assert!(
                unstaged.applied,
                "{config:?} {path}: {:?}",
                unstaged.refusal
            );
            assert_eq!(repo.staged(path), numbered(40, "l"));

            let again = file_diff(&repo, &GitDiffScope::Unstaged, path);
            let reverted = apply(
                &repo,
                GitDiffScope::Unstaged,
                path,
                ApplyMode::Revert,
                one(&again.hunks[0].id),
            );
            assert!(
                reverted.applied,
                "{config:?} {path}: {:?}",
                reverted.refusal
            );
        }
    }
}

// ------------------------------------------- 2: a user's discovery ceiling stays

#[test]
fn a_users_ceiling_directory_still_bounds_repository_discovery() {
    let (_keep, base) = scratch();
    crate::modules::git::testutil::git_in(&base, &["init", "-q", "-b", "main"]);
    let sub = base.join("sub");
    std::fs::create_dir_all(&sub).unwrap();
    let discover = || {
        run_git(
            &WorkspaceEnv::Local,
            Some(&sub.to_string_lossy()),
            ["rev-parse", "--show-toplevel"],
            10,
        )
        .unwrap()
    };
    assert_eq!(
        discover().exit_code,
        Some(0),
        "without a ceiling the parent repo is found"
    );

    // Each test is its own process under nextest; under `cargo test` a ceiling
    // that names this scratch directory cannot affect any other test's repo.
    std::env::set_var("GIT_CEILING_DIRECTORIES", &base);
    let bounded = discover();
    std::env::remove_var("GIT_CEILING_DIRECTORIES");
    assert_ne!(
        bounded.exit_code,
        Some(0),
        "the ceiling must reach git: {}",
        String::from_utf8_lossy(&bounded.stdout)
    );
}

// -------------------------------------- 3: the hooks directory is a real one

#[test]
fn checkpoints_use_an_empty_real_directory_as_their_hooks_path() {
    let repo = TestRepo::new();
    checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    let hooks = repo.root.join(".git/terax-no-hooks");
    assert!(hooks.is_dir());
    assert_eq!(
        std::fs::read_dir(&hooks).unwrap().count(),
        0,
        "it stays empty"
    );
}

// ------------------------------------------ 4: the worktree id is not a path

#[test]
fn renaming_the_repository_directory_does_not_orphan_its_checkpoints() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    let id = std::fs::read_to_string(repo.root.join(".git/terax-worktree-id")).unwrap();
    assert_eq!(id.trim().len(), 32);
    assert!(id.trim().bytes().all(|b| b.is_ascii_hexdigit()));

    let original = repo.root.clone();
    let moved = original.with_file_name(format!(
        "{}-renamed",
        original.file_name().unwrap().to_string_lossy()
    ));
    std::fs::rename(&original, &moved).unwrap();
    repo.registry.authorize(&moved).unwrap();
    let moved_path = moved.to_string_lossy().into_owned();

    let listed = checkpoint::list(&repo.registry, &moved_path, "t", &repo.ws).unwrap();
    assert_eq!(
        listed.iter().map(|c| c.turn).collect::<Vec<_>>(),
        vec![1, 2]
    );
    let report = checkpoint::restore(
        &repo.registry,
        &moved_path,
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(report.restored, "{report:?}");
    assert_eq!(
        std::fs::read_to_string(moved.join("a.txt")).unwrap(),
        "one\n"
    );
    checkpoint::create(&repo.registry, &moved_path, "t", 3, &repo.ws).unwrap();
    assert_eq!(
        std::fs::read_to_string(moved.join(".git/terax-worktree-id")).unwrap(),
        id,
        "the id moved with the git directory"
    );

    std::fs::rename(&moved, &original).unwrap();
}

#[test]
fn every_worktree_gets_its_own_random_id_and_listing_writes_nothing() {
    let a = TestRepo::new();
    let b = TestRepo::new();
    assert!(
        checkpoint::list(&a.registry, &a.path(), "t", &a.ws)
            .unwrap()
            .is_empty(),
        "no checkpoints yet"
    );
    assert!(
        !a.root.join(".git/terax-worktree-id").exists(),
        "reading creates no id"
    );
    checkpoint::create(&a.registry, &a.path(), "t", 1, &a.ws).unwrap();
    checkpoint::create(&b.registry, &b.path(), "t", 1, &b.ws).unwrap();
    let id = |r: &TestRepo| std::fs::read_to_string(r.root.join(".git/terax-worktree-id")).unwrap();
    assert_ne!(id(&a), id(&b));
    checkpoint::create(&a.registry, &a.path(), "t", 2, &a.ws).unwrap();
    assert_eq!(id(&a).trim().len(), 32);
}

// -------------------------------- 6: files `include` copied in are not data loss

fn add_with_include(repo: &TestRepo, base: &Path, name: &str, include: &[&str]) -> PathBuf {
    let added = worktree::add(
        &repo.registry,
        &repo.path(),
        &WorktreeAddRequest {
            path: None,
            task_slug: Some(name.to_string()),
            branch: WorktreeBranch::NewBranch {
                name: name.to_string(),
            },
            base: None,
            include: include.iter().map(|s| s.to_string()).collect(),
        },
        base,
        &repo.ws,
    )
    .unwrap();
    PathBuf::from(added.path)
}

fn remove(repo: &TestRepo, path: &Path, force: bool) -> worktree::WorktreeRemoveReport {
    worktree::remove(
        &repo.registry,
        &repo.path(),
        &path.to_string_lossy(),
        force,
        &repo.ws,
    )
    .unwrap()
}

#[test]
fn unchanged_include_copies_do_not_block_removal_but_edited_or_extra_files_do() {
    let repo = TestRepo::new();
    repo.write(".gitignore", ".env\nsecrets/\n*.sqlite\n");
    repo.commit_all("ignores");
    repo.write(".env", "TOKEN=1\n");
    repo.write("secrets/a.key", "key a\n");
    repo.write("secrets/deep/b.key", "key b\n");
    let (_keep, base) = scratch();

    // Everything copied in and left alone: nothing is lost by removing it.
    let pristine = add_with_include(&repo, &base, "pristine", &[".env", "secrets/**"]);
    assert!(pristine.join(".env").is_file() && pristine.join("secrets/deep/b.key").is_file());
    let report = remove(&repo, &pristine, false);
    assert!(report.removed, "{report:?}");
    assert!(report.blockers.is_empty());
    assert_eq!(report.ignored_identical, 2, "{report:?}");
    assert_eq!(report.ignored_total, 0);

    // An edited copy is the user's work.
    let edited = add_with_include(&repo, &base, "edited", &[".env", "secrets/**"]);
    std::fs::write(edited.join(".env"), "TOKEN=changed\n").unwrap();
    let blocked = remove(&repo, &edited, false);
    assert!(!blocked.removed);
    assert_eq!(blocked.blockers, vec![RemoveBlocker::Ignored]);
    assert_eq!(blocked.ignored_files, vec![".env"]);
    assert_eq!(
        blocked.ignored_identical, 1,
        "the untouched secrets/ still match"
    );
    assert_eq!(
        std::fs::read_to_string(edited.join(".env")).unwrap(),
        "TOKEN=changed\n"
    );

    // A new file inside a copied directory makes the directory differ.
    let extended = add_with_include(&repo, &base, "extended", &[".env", "secrets/**"]);
    std::fs::write(extended.join("secrets/local-only.key"), "mine\n").unwrap();
    let blocked = remove(&repo, &extended, false);
    assert_eq!(blocked.blockers, vec![RemoveBlocker::Ignored]);
    assert_eq!(blocked.ignored_files, vec!["secrets/"]);

    // Data that exists only here (no main copy at all) is never "identical".
    let own = add_with_include(&repo, &base, "own", &[]);
    std::fs::write(own.join("local.sqlite"), "rows").unwrap();
    let blocked = remove(&repo, &own, false);
    assert_eq!(blocked.blockers, vec![RemoveBlocker::Ignored]);
    assert_eq!(blocked.ignored_files, vec!["local.sqlite"]);
    assert_eq!(blocked.ignored_identical, 0);

    // A changed main copy no longer matches either: when in doubt it is data.
    let stale = add_with_include(&repo, &base, "stale", &[".env"]);
    repo.write(".env", "TOKEN=rotated\n");
    let blocked = remove(&repo, &stale, false);
    assert_eq!(blocked.blockers, vec![RemoveBlocker::Ignored]);

    assert!(remove(&repo, &stale, true).removed);
}

#[test]
fn identical_copies_never_hide_dirty_or_unmerged_work() {
    let repo = TestRepo::new();
    repo.write(".gitignore", ".env\n");
    repo.commit_all("ignores");
    repo.write(".env", "TOKEN=1\n");
    let (_keep, base) = scratch();
    let path = add_with_include(&repo, &base, "busy", &[".env"]);
    std::fs::write(path.join("README.md"), "# edited in the task\n").unwrap();
    let report = remove(&repo, &path, false);
    assert!(!report.removed);
    assert_eq!(report.blockers, vec![RemoveBlocker::Dirty]);
    assert_eq!(report.ignored_identical, 1);
}

// ------------------------------------- 7: restoring forward is not a change

#[test]
fn restoring_forward_after_restoring_back_is_not_refused() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    repo.write("only-in-two.txt", "2\n");
    let cp2 = checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    let back = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(back.restored && back.safety.is_none(), "{back:?}");
    assert_eq!(repo.read("a.txt"), "one\n");

    let forward = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp2.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(forward.restored, "restoring forward must work: {forward:?}");
    assert!(forward.safety.is_none(), "turn 1's state is held by turn 1");
    assert_eq!(repo.read("a.txt"), "two\n");
    assert!(repo.exists("only-in-two.txt"));

    // And back and forth again.
    assert!(
        checkpoint::restore(
            &repo.registry,
            &repo.path(),
            &cp1.info.ref_name,
            false,
            &repo.ws
        )
        .unwrap()
        .restored
    );
}

#[test]
fn edits_after_a_restore_are_still_protected_and_measured_against_it() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    let cp2 = checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();
    checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();

    repo.write("a.txt", "edited after the restore\n");
    let refused = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp2.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert_eq!(refused.refusal, Some(RestoreRefusal::ChangedSinceLatest));
    assert_eq!(
        refused.baseline_ref.as_deref(),
        Some(cp1.info.ref_name.as_str())
    );
    assert_eq!(
        refused.latest_ref.as_deref(),
        Some(cp2.info.ref_name.as_str())
    );
    assert_eq!(
        refused
            .dirty
            .iter()
            .map(|d| d.path.as_str())
            .collect::<Vec<_>>(),
        vec!["a.txt"]
    );
    assert_eq!(repo.read("a.txt"), "edited after the restore\n");

    let forced = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp2.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(forced.restored && forced.safety.is_some());
}

#[test]
fn a_new_checkpoint_replaces_the_restore_as_the_baseline() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();
    checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();

    // The agent works on from the restored state; its turn is checkpointed.
    repo.write("a.txt", "three\n");
    let cp3 = checkpoint::create(&repo.registry, &repo.path(), "t", 3, &repo.ws).unwrap();
    let back = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(
        back.restored,
        "the tree equals the newest checkpoint: {back:?}"
    );
    assert_eq!(
        back.baseline_ref.as_deref(),
        Some(cp3.info.ref_name.as_str())
    );

    // Pruning forgets the marker with the checkpoints.
    checkpoint::prune(&repo.registry, &repo.path(), "t", &repo.ws).unwrap();
    assert!(!repo.root.join(".git/terax-last-restore").exists());
}

#[test]
fn the_last_restore_marker_of_another_task_is_ignored() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let a1 = checkpoint::create(&repo.registry, &repo.path(), "task-a", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    let b1 = checkpoint::create(&repo.registry, &repo.path(), "task-b", 1, &repo.ws).unwrap();
    // Forced: the worktree (holding task-b's state) differs from task-a's latest.
    let first = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &a1.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(first.restored);
    assert_eq!(repo.read("a.txt"), "one\n");
    let report = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &b1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert_eq!(
        report.baseline_ref.as_deref(),
        Some(b1.info.ref_name.as_str()),
        "task-b is measured against its own latest checkpoint"
    );
    assert_eq!(report.refusal, Some(RestoreRefusal::ChangedSinceLatest));
}
