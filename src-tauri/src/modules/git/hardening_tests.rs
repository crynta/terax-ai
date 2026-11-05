//! Regression tests for the review findings on the first version of the review
//! backend: data safety, ownership of checkpoints, worktree removal, caps and
//! environment hygiene, all against real temporary repositories.

use std::path::{Path, PathBuf};

use crate::modules::git::checkpoint::{self, RestoreRefusal};
use crate::modules::git::errors::GitError;
use crate::modules::git::review::{
    self, ApplyMode, ApplySelection, CheckpointEndpoint, GitDiffScope, RefusalCode,
};
use crate::modules::git::review_tests::{apply, file_diff, numbered, summary};
use crate::modules::git::testutil::{scratch, TestRepo};
use crate::modules::git::worktree::{self, RemoveBlocker, WorktreeAddRequest, WorktreeBranch};
use crate::modules::workspace::WorkspaceEnv;

fn add_worktree(repo: &TestRepo, base: &Path, branch: &str) -> worktree::WorktreeAdded {
    worktree::add(
        &repo.registry,
        &repo.path(),
        &WorktreeAddRequest {
            path: None,
            task_slug: Some(branch.to_string()),
            branch: WorktreeBranch::NewBranch {
                name: branch.to_string(),
            },
            base: None,
            include: Vec::new(),
        },
        base,
        &repo.ws,
    )
    .unwrap()
}

// ------------------------------------------------- 1: directories are not files

#[test]
fn a_directory_path_is_never_treated_as_an_untracked_file() {
    let repo = TestRepo::new();
    repo.write("src/tracked.rs", "fn main() {}\n");
    repo.commit_all("tracked");
    repo.write("src/new_one.rs", "fresh work\n");
    repo.write("src/deep/new_two.rs", "more fresh work\n");
    repo.write("only-untracked/a.txt", "a\n");
    repo.write("only-untracked/b.txt", "b\n");

    for (scope, mode) in [
        (GitDiffScope::Unstaged, ApplyMode::Revert),
        (GitDiffScope::Uncommitted, ApplyMode::Revert),
        (GitDiffScope::Unstaged, ApplyMode::Stage),
    ] {
        for dir in ["src", "only-untracked", "src/deep"] {
            let outcome = apply(&repo, scope.clone(), dir, mode, ApplySelection::File);
            assert!(!outcome.applied, "{dir} {mode:?}");
            assert_eq!(outcome.refusal.unwrap().code, RefusalCode::Unchanged);
        }
    }
    for kept in [
        "src/new_one.rs",
        "src/deep/new_two.rs",
        "only-untracked/a.txt",
        "only-untracked/b.txt",
    ] {
        assert!(repo.exists(kept), "{kept} must survive");
    }
    assert_eq!(repo.read("src/new_one.rs"), "fresh work\n");

    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "src");
    assert!(diff.unchanged, "a directory has no diff of its own");

    let file = apply(
        &repo,
        GitDiffScope::Unstaged,
        "src/new_one.rs",
        ApplyMode::Revert,
        ApplySelection::File,
    );
    assert!(file.applied, "an exact untracked file is still reverted");
    assert!(!repo.exists("src/new_one.rs"));
    assert!(repo.exists("src/deep/new_two.rs"));
}

// -------------------------------------------- 2: forced restore is reversible

#[test]
fn a_forced_restore_leaves_a_safety_ref_that_restores_the_overwritten_work() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    repo.write("a.txt", "the user's unsaved-in-any-checkpoint edit\n");
    repo.write("scratch.txt", "also only on disk\n");
    let report = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(report.restored);
    assert_eq!(repo.read("a.txt"), "one\n");
    assert!(!repo.exists("scratch.txt"));

    let safety = report
        .safety
        .expect("a forced restore returns its safety ref");
    assert!(safety
        .ref_name
        .starts_with("refs/terax/checkpoints/t/prerestore-"));
    assert_eq!(
        repo.git(&["rev-parse", &safety.ref_name]).trim(),
        safety.commit
    );
    assert_eq!(
        repo.git(&["show", &format!("{}:a.txt", safety.commit)]),
        "the user's unsaved-in-any-checkpoint edit\n"
    );
    assert_eq!(
        repo.git(&["show", &format!("{}:scratch.txt", safety.commit)]),
        "also only on disk\n"
    );

    // Restoring the safety ref undoes the restore.
    let undo = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &safety.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(undo.restored, "{undo:?}");
    assert_eq!(
        repo.read("a.txt"),
        "the user's unsaved-in-any-checkpoint edit\n"
    );
    assert_eq!(repo.read("scratch.txt"), "also only on disk\n");
}

#[test]
fn a_clean_restore_needs_no_safety_ref_but_one_that_drops_work_has_one() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    let clean = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(clean.restored);
    assert!(clean.safety.is_none(), "turn 2 already holds that state");

    // The worktree now holds exactly what the restore wrote: restoring again is
    // a clean no-op. An edit after it is what gets refused, with no safety ref.
    let again = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(again.restored && again.safety.is_none());
    repo.write("a.txt", "an edit after the restore\n");
    let refused = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert_eq!(refused.refusal, Some(RestoreRefusal::ChangedSinceLatest));
    assert!(refused.safety.is_none());
}

#[test]
fn a_refused_restore_writes_nothing() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "edited\n");
    let refs_before = repo.git(&["for-each-ref", "refs/terax"]);
    let refused = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(!refused.restored && refused.safety.is_none());
    assert_eq!(repo.git(&["for-each-ref", "refs/terax"]), refs_before);
}

#[test]
fn prune_removes_safety_refs_too() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "edit\n");
    checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(repo
        .git(&["for-each-ref", "refs/terax"])
        .contains("prerestore-"));
    let pruned = checkpoint::prune(&repo.registry, &repo.path(), "t", &repo.ws).unwrap();
    assert_eq!(pruned, 2);
    assert_eq!(repo.git(&["for-each-ref", "refs/terax"]).trim(), "");
}

// ------------------------------------ 5: a checkpoint belongs to its worktree

#[test]
fn a_checkpoint_of_another_worktree_cannot_be_listed_restored_or_pruned() {
    let repo = TestRepo::new();
    repo.write("a.txt", "main worktree\n");
    repo.commit_all("base");
    let (_keep, base) = scratch();
    let other = add_worktree(&repo, &base, "other");
    let other_path = other.path.clone();
    std::fs::write(Path::new(&other_path).join("a.txt"), "task worktree\n").unwrap();

    let theirs = checkpoint::create(&repo.registry, &other_path, "shared-id", 1, &repo.ws).unwrap();
    let mine = checkpoint::create(&repo.registry, &repo.path(), "shared-id", 2, &repo.ws).unwrap();

    let listed = checkpoint::list(&repo.registry, &repo.path(), "shared-id", &repo.ws).unwrap();
    assert_eq!(listed.iter().map(|c| c.turn).collect::<Vec<_>>(), vec![2]);
    let listed_there =
        checkpoint::list(&repo.registry, &other_path, "shared-id", &repo.ws).unwrap();
    assert_eq!(
        listed_there.iter().map(|c| c.turn).collect::<Vec<_>>(),
        vec![1]
    );

    repo.write("a.txt", "work in progress\n");
    let err = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &theirs.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap_err();
    assert!(err.to_string().contains("no such checkpoint"), "{err}");
    assert_eq!(
        repo.read("a.txt"),
        "work in progress\n",
        "nothing was touched"
    );

    assert_eq!(
        checkpoint::prune(&repo.registry, &repo.path(), "shared-id", &repo.ws).unwrap(),
        1
    );
    assert_eq!(
        repo.git(&["rev-parse", &theirs.info.ref_name]).trim(),
        theirs.info.commit,
        "the other worktree's checkpoint survives"
    );
    assert!(repo
        .git(&["for-each-ref", &mine.info.ref_name])
        .trim()
        .is_empty());
}

#[test]
fn a_reused_task_id_cannot_overwrite_another_worktrees_checkpoint() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let other = add_worktree(&repo, &base, "other");
    let theirs = checkpoint::create(&repo.registry, &other.path, "same", 1, &repo.ws).unwrap();
    let clash = checkpoint::create(&repo.registry, &repo.path(), "same", 1, &repo.ws);
    assert!(clash.is_err());
    assert_eq!(
        repo.git(&["rev-parse", &theirs.info.ref_name]).trim(),
        theirs.info.commit
    );
    checkpoint::create(&repo.registry, &repo.path(), "same", 2, &repo.ws).unwrap();
}

// ---------------------------------------- 3 and 4: removing worktrees safely

#[test]
fn ignored_user_data_blocks_removal_but_dependency_caches_do_not() {
    let repo = TestRepo::new();
    repo.write(".gitignore", ".env\n*.sqlite\nnode_modules/\ntarget/\n");
    repo.commit_all("ignores");
    let (_keep, base) = scratch();

    let caches = add_worktree(&repo, &base, "caches");
    let caches_path = PathBuf::from(&caches.path);
    std::fs::create_dir_all(caches_path.join("node_modules/pkg")).unwrap();
    std::fs::write(caches_path.join("node_modules/pkg/index.js"), "x").unwrap();
    std::fs::create_dir_all(caches_path.join("target")).unwrap();
    std::fs::write(caches_path.join("target/out.o"), "x").unwrap();
    let report =
        worktree::remove(&repo.registry, &repo.path(), &caches.path, false, &repo.ws).unwrap();
    assert!(report.removed, "{report:?}");
    assert!(report.ignored_regenerable >= 2);

    let data = add_worktree(&repo, &base, "data");
    let data_path = PathBuf::from(&data.path);
    std::fs::write(data_path.join(".env"), "SECRET=1\n").unwrap();
    std::fs::write(data_path.join("local.sqlite"), "rows").unwrap();
    std::fs::create_dir_all(data_path.join("node_modules")).unwrap();
    let blocked =
        worktree::remove(&repo.registry, &repo.path(), &data.path, false, &repo.ws).unwrap();
    assert!(!blocked.removed);
    assert_eq!(blocked.blockers, vec![RemoveBlocker::Ignored]);
    assert_eq!(blocked.ignored_total, 2);
    let mut sample = blocked.ignored_files.clone();
    sample.sort();
    assert_eq!(sample, vec![".env", "local.sqlite"]);
    assert_eq!(
        blocked.dirty_total + blocked.untracked_count,
        0,
        "status sees nothing"
    );
    assert_eq!(
        std::fs::read_to_string(data_path.join(".env")).unwrap(),
        "SECRET=1\n"
    );

    let forced =
        worktree::remove(&repo.registry, &repo.path(), &data.path, true, &repo.ws).unwrap();
    assert!(forced.removed);
    assert!(!data_path.exists());
}

#[test]
fn removing_one_missing_worktree_leaves_every_other_stale_entry_alone() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let first = add_worktree(&repo, &base, "first");
    let second = add_worktree(&repo, &base, "second");
    std::fs::remove_dir_all(&first.path).unwrap();
    std::fs::remove_dir_all(&second.path).unwrap(); // say, an unmounted volume

    let report =
        worktree::remove(&repo.registry, &repo.path(), &first.path, false, &repo.ws).unwrap();
    assert!(report.removed, "{report:?}");

    let listed = worktree::list(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert!(
        listed.iter().any(|e| e.path == second.path && e.prunable),
        "the other stale worktree is still registered: {listed:?}"
    );
    assert!(!listed.iter().any(|e| e.path == first.path));
}

// ------------------------------------------------------------ 14: WSL

#[test]
fn worktree_creation_and_removal_are_refused_in_wsl_workspaces() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let wsl = WorkspaceEnv::Wsl {
        distro: "Ubuntu".into(),
    };
    let added = worktree::add(
        &repo.registry,
        &repo.path(),
        &WorktreeAddRequest {
            path: None,
            task_slug: Some("x".into()),
            branch: WorktreeBranch::NewBranch { name: "x".into() },
            base: None,
            include: Vec::new(),
        },
        &base,
        &wsl,
    );
    assert!(matches!(added, Err(GitError::Unsupported(_))));
    assert_eq!(std::fs::read_dir(&base).unwrap().count(), 0);
    assert!(repo.git(&["branch", "--list", "x"]).trim().is_empty());

    let removed = worktree::remove(&repo.registry, &repo.path(), &repo.path(), true, &wsl);
    assert!(matches!(removed, Err(GitError::Unsupported(_))));
}

// ------------------------------------------- 6: renames and section choice

#[test]
fn reverting_a_staged_rename_restores_the_old_path_and_removes_the_new_one() {
    let repo = TestRepo::new();
    repo.write("old.txt", &numbered(20, "line "));
    repo.commit_all("base");
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.write(
        "new.txt",
        &numbered(20, "line ").replace("line 5\n", "LINE 5\n"),
    );

    let result = review::apply_hunks(
        &repo.registry,
        &repo.path(),
        &review::ApplyHunksRequest {
            scope: GitDiffScope::Uncommitted,
            path: "new.txt".into(),
            old_path: Some("old.txt".into()),
            mode: ApplyMode::Revert,
            selection: ApplySelection::File,
        },
        &repo.ws,
    )
    .unwrap();
    assert!(result.applied, "{:?}", result.refusal);
    assert_eq!(repo.read("old.txt"), numbered(20, "line "));
    assert!(!repo.exists("new.txt"));
    assert_eq!(repo.git(&["status", "--porcelain"]).trim(), "");
}

#[test]
fn a_rename_revert_that_cannot_complete_changes_nothing() {
    let repo = TestRepo::new();
    repo.write("old.txt", "contents\n");
    repo.commit_all("base");
    repo.git(&["mv", "old.txt", "new.txt"]);
    // Something unrelated now sits where the old file used to be.
    repo.write("old.txt", "someone else's file\n");

    let outcome = review::apply_hunks(
        &repo.registry,
        &repo.path(),
        &review::ApplyHunksRequest {
            scope: GitDiffScope::Uncommitted,
            path: "new.txt".into(),
            old_path: Some("old.txt".into()),
            mode: ApplyMode::Revert,
            selection: ApplySelection::File,
        },
        &repo.ws,
    );
    assert!(outcome.is_err(), "refused up front: {outcome:?}");
    assert_eq!(repo.read("old.txt"), "someone else's file\n");
    assert_eq!(
        repo.read("new.txt"),
        "contents\n",
        "the renamed file was not removed"
    );
    assert!(repo.git(&["ls-files"]).contains("new.txt"));
}

#[test]
fn a_rename_revert_whose_second_step_fails_rolls_the_first_back() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let repo = TestRepo::new();
        repo.write("top/old.txt", "contents\n");
        repo.write("locked/keep.txt", "keep\n");
        repo.commit_all("base");
        repo.git(&["mv", "top/old.txt", "locked/new.txt"]);
        let status_before = repo.git(&["status", "--porcelain"]);

        // The new file cannot be unlinked: its directory is read-only.
        let locked = repo.root.join("locked");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let can_still_unlink = {
            let probe = locked.join("probe");
            let ok = std::fs::write(&probe, "x").is_ok();
            let _ = std::fs::remove_file(&probe);
            ok
        };
        if can_still_unlink {
            // Running as root: permissions cannot make the removal fail.
            std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }

        let outcome = review::apply_hunks(
            &repo.registry,
            &repo.path(),
            &review::ApplyHunksRequest {
                scope: GitDiffScope::Uncommitted,
                path: "locked/new.txt".into(),
                old_path: Some("top/old.txt".into()),
                mode: ApplyMode::Revert,
                selection: ApplySelection::File,
            },
            &repo.ws,
        );
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(outcome.is_err(), "the removal failed: {outcome:?}");
        assert!(
            !repo.exists("top/old.txt"),
            "the restored old file was rolled back"
        );
        assert_eq!(repo.read("locked/new.txt"), "contents\n");
        assert_eq!(repo.git(&["status", "--porcelain"]), status_before);
    }
}

// ---------------------------------------------------- 10: the line cap

#[test]
fn a_rewritten_file_is_capped_in_lines_not_just_in_bytes() {
    let repo = TestRepo::new();
    let before: String = (0..60_000).map(|i| format!("{}\n", i % 7)).collect();
    let after: String = (0..60_000)
        .map(|i| format!("{}\n", (i + 1) % 7 + 10))
        .collect();
    repo.write("rewritten.txt", &before);
    repo.commit_all("base");
    repo.write("rewritten.txt", &after);

    let diff = review::diff_file(
        &repo.registry,
        &repo.path(),
        &GitDiffScope::Unstaged,
        "rewritten.txt",
        None,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(diff.truncated, "the 120k diff lines exceed the cap");
    let sent: usize = diff.hunks.iter().map(|h| h.lines.len()).sum();
    assert!(sent <= 20_000, "{sent} lines");
    assert_eq!(diff.added, 60_000, "totals still describe the whole change");
    let json = serde_json::to_string(&diff).unwrap();
    assert!(
        json.len() < 4 * 1024 * 1024,
        "{} bytes over IPC",
        json.len()
    );

    let refused = apply(
        &repo,
        GitDiffScope::Unstaged,
        "rewritten.txt",
        ApplyMode::Stage,
        ApplySelection::Hunks {
            items: vec![review::HunkSelection {
                id: diff.hunks[0].id.clone(),
                lines: None,
            }],
        },
    );
    assert_eq!(refused.refusal.unwrap().code, RefusalCode::WholeFileOnly);
}

// ------------------------------------------- 13: checkpoint plumbing config

#[test]
fn checkpoints_survive_a_strict_safecrlf_config_and_mixed_line_endings() {
    let repo = TestRepo::new();
    repo.git(&["config", "core.autocrlf", "true"]);
    repo.git(&["config", "core.safecrlf", "true"]);
    repo.write_bytes("mixed.txt", b"dos line\r\nunix line\n");
    let created = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    assert!(created.consistent);
    assert!(repo
        .git(&["ls-tree", "-r", "--name-only", &created.info.tree])
        .contains("mixed.txt"));
}

#[test]
fn plumbing_config_disables_the_fsmonitor_hooks_and_strict_crlf() {
    let config: Vec<String> = checkpoint::plumbing_config(Path::new("/a repo/.git/terax-no-hooks"))
        .into_iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert!(config.contains(&"core.fsmonitor=false".to_string()));
    assert!(config.contains(&"core.safecrlf=false".to_string()));
    assert!(
        config.contains(&"core.hooksPath=/a repo/.git/terax-no-hooks".to_string()),
        "the hooks directory is one argument, spaces and all: {config:?}"
    );
    assert!(
        !config.iter().any(|a| a.contains("/dev/null") || a == "NUL"),
        "no device name: a real empty directory resolves the same everywhere"
    );
}

#[test]
fn a_hook_of_the_users_never_runs_during_a_checkpoint() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let repo = TestRepo::new();
        let (_keep, outside) = scratch();
        let marker = outside.join("hook-ran");
        let hooks = repo.root.join(".git/hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        for name in [
            "pre-commit",
            "post-checkout",
            "reference-transaction",
            "post-index-change",
        ] {
            let hook = hooks.join(name);
            std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        repo.write("a.txt", "a\n");
        let created = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
        repo.write("a.txt", "b\n");
        checkpoint::restore(
            &repo.registry,
            &repo.path(),
            &created.info.ref_name,
            true,
            &repo.ws,
        )
        .unwrap();
        assert!(!marker.exists(), "no hook may run for checkpoint plumbing");
    }
}

#[test]
fn a_pinned_worktree_snapshot_is_reused_not_taken_again() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    repo.write("new.txt", "n\n");

    let live = GitDiffScope::Checkpoint {
        from: CheckpointEndpoint::Ref {
            name: cp.info.ref_name.clone(),
        },
        to: CheckpointEndpoint::Worktree { tree: None },
    };
    let first = summary(&repo, &live);
    let review::DiffSide::Worktree { tree: Some(pinned) } = first.to.clone() else {
        panic!("a checkpoint-to-worktree summary reports its snapshot");
    };
    assert_eq!(first.files.len(), 2);

    // The worktree moves on; the pinned scope still describes the snapshot.
    repo.write("a.txt", "three\n");
    repo.write("later.txt", "l\n");
    let frozen = GitDiffScope::Checkpoint {
        from: CheckpointEndpoint::Ref {
            name: cp.info.ref_name,
        },
        to: CheckpointEndpoint::Worktree { tree: Some(pinned) },
    };
    let again = summary(&repo, &frozen);
    assert_eq!(again.files, first.files);
    let file = file_diff(&repo, &frozen, "a.txt");
    assert_eq!(file.contents.unwrap().modified, "two\n");
    assert!(file_diff(&repo, &frozen, "later.txt").unchanged);

    // Without a pin a fresh snapshot sees the new state.
    let fresh = summary(&repo, &live);
    assert_eq!(fresh.files.len(), 3);
}

#[test]
fn a_pinned_tree_must_be_an_existing_tree_id() {
    let repo = TestRepo::new();
    let head = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    for bad in [
        "--output=/tmp/x".to_string(),
        "HEAD".to_string(),
        "main".to_string(),
        "0123456789012345678901234567890123456789".to_string(),
        head,
    ] {
        let scope = GitDiffScope::Checkpoint {
            from: CheckpointEndpoint::Ref {
                name: "HEAD".into(),
            },
            to: CheckpointEndpoint::Worktree {
                tree: Some(bad.clone()),
            },
        };
        let result = review::diff_summary(&repo.registry, &repo.path(), &scope, &repo.ws);
        assert!(result.is_err(), "{bad}");
    }
}

#[test]
fn the_worktree_endpoint_still_deserializes_from_the_old_wire_shape() {
    let scope: GitDiffScope = serde_json::from_str(
        r#"{"kind":"checkpoint","from":{"kind":"ref","name":"refs/terax/checkpoints/t/1"},"to":{"kind":"worktree"}}"#,
    )
    .unwrap();
    assert_eq!(
        scope,
        GitDiffScope::Checkpoint {
            from: CheckpointEndpoint::Ref {
                name: "refs/terax/checkpoints/t/1".into()
            },
            to: CheckpointEndpoint::Worktree { tree: None },
        }
    );
    let pinned: CheckpointEndpoint =
        serde_json::from_str(r#"{"kind":"worktree","tree":"abc"}"#).unwrap();
    assert_eq!(
        pinned,
        CheckpointEndpoint::Worktree {
            tree: Some("abc".into())
        }
    );
}

// ------------------------------------------------- 15: include-copy hardening

#[test]
fn include_copy_never_creates_directories_outside_the_worktree() {
    #[cfg(unix)]
    {
        let (_keep_src, src) = scratch();
        let (_keep_dst, dst) = scratch();
        let (_keep_out, outside) = scratch();
        std::fs::create_dir_all(src.join("cfg/nested/deeper")).unwrap();
        std::fs::write(src.join("cfg/nested/deeper/secret.env"), "S=1\n").unwrap();
        // The new worktree has `cfg` as a symlink out of the tree.
        std::os::unix::fs::symlink(&outside, dst.join("cfg")).unwrap();

        let report =
            worktree::copy_included(&src, &dst, &["cfg/nested/deeper/secret.env".to_string()]);
        assert!(report.copied.is_empty());
        assert_eq!(report.skipped[0].reason, "outside-worktree");
        assert_eq!(
            std::fs::read_dir(&outside).unwrap().count(),
            0,
            "nothing was created through the symlink"
        );
    }
}

#[test]
fn include_copy_creates_files_with_their_final_mode() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let (_keep_src, src) = scratch();
        let (_keep_dst, dst) = scratch();
        for (name, mode) in [(".env", 0o600), ("run.sh", 0o750), ("plain.txt", 0o644)] {
            std::fs::write(src.join(name), "x\n").unwrap();
            std::fs::set_permissions(src.join(name), std::fs::Permissions::from_mode(mode))
                .unwrap();
        }
        let report = worktree::copy_included(
            &src,
            &dst,
            &[".env".into(), "run.sh".into(), "plain.txt".into()],
        );
        assert_eq!(report.copied.len(), 3, "{report:?}");
        for (name, mode) in [(".env", 0o600), ("run.sh", 0o750), ("plain.txt", 0o644)] {
            let actual = std::fs::metadata(dst.join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(actual, mode, "{name}");
        }
    }
}
