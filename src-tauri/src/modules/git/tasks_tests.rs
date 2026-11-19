//! Integration tests for worktrees, checkpoints and branch operations against
//! real temporary repositories.

use std::path::{Path, PathBuf};

use crate::modules::git::branch;
use crate::modules::git::checkpoint::{self, RestoreRefusal};
use crate::modules::git::errors::GitError;
use crate::modules::git::operations;
use crate::modules::git::testutil::{authorized, git_in, scratch, TestRepo};
use crate::modules::git::worktree::{self, RemoveBlocker, WorktreeAddRequest, WorktreeBranch};

fn add_request(branch: WorktreeBranch, task: &str) -> WorktreeAddRequest {
    WorktreeAddRequest {
        path: None,
        task_slug: Some(task.to_string()),
        branch,
        base: None,
        include: Vec::new(),
    }
}

fn add_worktree(
    repo: &TestRepo,
    base_dir: &Path,
    request: &WorktreeAddRequest,
) -> crate::modules::git::errors::Result<worktree::WorktreeAdded> {
    worktree::add(&repo.registry, &repo.path(), request, base_dir, &repo.ws)
}

// ------------------------------------------------------------ worktrees

#[test]
fn a_new_worktree_gets_a_collision_safe_default_location_and_is_authorized() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let request = add_request(
        WorktreeBranch::NewBranch {
            name: "task/one".into(),
        },
        "Fix the Login Bug!",
    );
    let first = add_worktree(&repo, &base, &request).unwrap();
    let path = PathBuf::from(&first.path);
    assert!(path.starts_with(&base));
    assert!(path.ends_with("fix-the-login-bug"));
    assert!(path.join("README.md").is_file());
    assert_eq!(first.branch.as_deref(), Some("task/one"));
    assert!(!first.detached);
    assert!(authorized(&repo.registry, &path));
    assert!(authorized(&repo.registry, &path.join("sub/dir")));

    let second = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "task/two".into(),
            },
            "Fix the Login Bug!",
        ),
    )
    .unwrap();
    assert_ne!(first.path, second.path);
    assert!(second.path.ends_with("fix-the-login-bug-2"));
    assert_eq!(
        Path::new(&first.path).parent(),
        Path::new(&second.path).parent(),
        "same project folder"
    );

    let listed = worktree::list(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(listed.len(), 3);
    assert!(listed[0].is_main);
    assert!(listed
        .iter()
        .any(|e| e.branch.as_deref() == Some("task/two")));
}

#[test]
fn worktree_modes_new_existing_and_detached() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    repo.git(&["branch", "existing"]);
    let head = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    let existing = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::ExistingBranch {
                name: "existing".into(),
            },
            "a",
        ),
    )
    .unwrap();
    assert_eq!(existing.branch.as_deref(), Some("existing"));

    let busy = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::ExistingBranch {
                name: "existing".into(),
            },
            "b",
        ),
    );
    assert!(busy.is_err(), "a branch can be checked out only once");

    let detached = add_worktree(&repo, &base, &add_request(WorktreeBranch::Detach, "c")).unwrap();
    assert!(detached.detached);
    assert_eq!(detached.branch, None);
    assert_eq!(detached.head, head);

    repo.write("later.txt", "x\n");
    let later = repo.commit_all("later");
    let based = add_worktree(
        &repo,
        &base,
        &WorktreeAddRequest {
            base: Some(head.clone()),
            ..add_request(
                WorktreeBranch::NewBranch {
                    name: "from-old".into(),
                },
                "d",
            )
        },
    )
    .unwrap();
    assert_eq!(based.head, head);
    assert_ne!(based.head, later);
    assert!(!Path::new(&based.path).join("later.txt").exists());
}

#[test]
fn invalid_requests_create_nothing() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    for name in ["-x", "a..b", "a b", "x.lock", "@{u}", "", "main"] {
        let result = add_worktree(
            &repo,
            &base,
            &add_request(WorktreeBranch::NewBranch { name: name.into() }, "t"),
        );
        assert!(result.is_err(), "{name:?}");
    }
    let outside = add_worktree(
        &repo,
        &base,
        &WorktreeAddRequest {
            include: vec!["../secrets".into()],
            ..add_request(WorktreeBranch::NewBranch { name: "ok".into() }, "t")
        },
    );
    assert!(matches!(outside, Err(GitError::InvalidPath(_))));
    let bad_base = add_worktree(
        &repo,
        &base,
        &WorktreeAddRequest {
            base: Some("--output=x".into()),
            ..add_request(WorktreeBranch::NewBranch { name: "ok2".into() }, "t")
        },
    );
    assert!(bad_base.is_err());
    assert_eq!(
        std::fs::read_dir(&base).unwrap().count(),
        0,
        "no directory was claimed"
    );
    assert!(!repo.git(&["branch", "--list", "ok"]).contains("ok"));
}

#[test]
fn explicit_locations_must_be_authorized_and_outside_the_repository() {
    let repo = TestRepo::new();
    let (_keep, elsewhere) = scratch();
    let target = elsewhere.join("wt");
    let request = WorktreeAddRequest {
        path: Some(target.to_string_lossy().into_owned()),
        ..add_request(WorktreeBranch::NewBranch { name: "x".into() }, "t")
    };
    assert!(
        matches!(
            add_worktree(&repo, &elsewhere, &request),
            Err(GitError::PathOutsideWorkspace(_))
        ),
        "an unauthorized location is refused"
    );

    repo.registry.authorize(&elsewhere).unwrap();
    let added = add_worktree(&repo, &elsewhere, &request).unwrap();
    assert_eq!(PathBuf::from(&added.path), target);

    let inside = WorktreeAddRequest {
        path: Some(
            repo.root
                .join("nested-worktree")
                .to_string_lossy()
                .into_owned(),
        ),
        ..add_request(WorktreeBranch::NewBranch { name: "y".into() }, "t")
    };
    assert!(matches!(
        add_worktree(&repo, &elsewhere, &inside),
        Err(GitError::InvalidPath(_))
    ));
    let relative = WorktreeAddRequest {
        path: Some("relative/place".into()),
        ..add_request(WorktreeBranch::NewBranch { name: "z".into() }, "t")
    };
    assert!(add_worktree(&repo, &elsewhere, &relative).is_err());
}

#[test]
fn ignored_files_are_copied_into_the_new_worktree() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    repo.write(".gitignore", ".env\n.env.*\n");
    repo.commit_all("ignore env");
    repo.write(".env", "SECRET=1\n");
    repo.write("apps/web/.env.local", "WEB=1\n");
    repo.write("untouched.txt", "not requested\n");

    let added = add_worktree(
        &repo,
        &base,
        &WorktreeAddRequest {
            include: vec![".env".into(), "apps/*/.env.local".into(), "nope.txt".into()],
            ..add_request(WorktreeBranch::NewBranch { name: "env".into() }, "env")
        },
    )
    .unwrap();
    let path = PathBuf::from(&added.path);
    assert_eq!(
        std::fs::read_to_string(path.join(".env")).unwrap(),
        "SECRET=1\n"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("apps/web/.env.local")).unwrap(),
        "WEB=1\n"
    );
    assert!(!path.join("untouched.txt").exists());
    assert_eq!(added.copied, vec![".env", "apps/web/.env.local"]);
    assert!(!added.include_truncated);
    assert_eq!(git_in(&path, &["status", "--porcelain"]).trim(), "");
}

#[test]
fn worktrees_of_a_repository_without_commits_are_refused() {
    let repo = TestRepo::unborn();
    let (_keep, base) = scratch();
    let result = add_worktree(
        &repo,
        &base,
        &add_request(WorktreeBranch::NewBranch { name: "x".into() }, "t"),
    );
    assert!(result.is_err());
}

#[test]
fn removing_reports_dirty_and_unmerged_work_instead_of_deleting_it() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "task".into(),
            },
            "task",
        ),
    )
    .unwrap();
    let path = PathBuf::from(&added.path);

    std::fs::write(path.join("README.md"), "# edited\n").unwrap();
    std::fs::write(path.join("scratch.txt"), "untracked\n").unwrap();
    git_in(&path, &["add", "README.md"]);
    git_in(&path, &["commit", "-q", "-m", "work in the task"]);
    std::fs::write(path.join("README.md"), "# edited again\n").unwrap();

    let blocked =
        worktree::remove(&repo.registry, &repo.path(), &added.path, false, &repo.ws).unwrap();
    assert!(!blocked.removed);
    assert!(blocked.blockers.contains(&RemoveBlocker::Dirty));
    assert!(blocked.blockers.contains(&RemoveBlocker::Unmerged));
    assert_eq!(blocked.dirty_total, 1);
    assert_eq!(blocked.dirty_files[0].path, "README.md");
    assert_eq!(blocked.untracked_count, 1);
    assert_eq!(blocked.unmerged_commits, 1);
    assert!(path.is_dir(), "nothing was deleted");
    assert!(authorized(&repo.registry, &path));

    let forced =
        worktree::remove(&repo.registry, &repo.path(), &added.path, true, &repo.ws).unwrap();
    assert!(forced.removed);
    assert!(!path.exists());
    assert!(!authorized(&repo.registry, &path), "the grant is revoked");
    assert!(
        repo.git(&["branch", "--list", "task"]).contains("task"),
        "the branch and its commit survive"
    );
}

#[test]
fn a_clean_merged_worktree_is_removed_without_force() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "clean".into(),
            },
            "clean",
        ),
    )
    .unwrap();
    let report =
        worktree::remove(&repo.registry, &repo.path(), &added.path, false, &repo.ws).unwrap();
    assert!(report.removed, "{report:?}");
    assert!(report.blockers.is_empty());
    assert!(!Path::new(&added.path).exists());
}

#[test]
fn pushed_commits_do_not_count_as_unmerged() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let (_remote_keep, remote_dir) = scratch();
    git_in(&remote_dir, &["init", "-q", "--bare", "-b", "main"]);
    repo.git(&["remote", "add", "origin", &remote_dir.to_string_lossy()]);
    repo.git(&["push", "-q", "origin", "main"]);

    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "pushed".into(),
            },
            "p",
        ),
    )
    .unwrap();
    let path = PathBuf::from(&added.path);
    std::fs::write(path.join("work.txt"), "w\n").unwrap();
    git_in(&path, &["add", "work.txt"]);
    git_in(&path, &["commit", "-q", "-m", "work"]);
    let before =
        worktree::remove(&repo.registry, &repo.path(), &added.path, false, &repo.ws).unwrap();
    assert!(!before.removed);
    assert_eq!(before.unmerged_commits, 1);

    git_in(&path, &["push", "-q", "origin", "pushed"]);
    let after =
        worktree::remove(&repo.registry, &repo.path(), &added.path, false, &repo.ws).unwrap();
    assert!(after.removed, "{after:?}");
}

#[test]
fn locked_and_main_worktrees_are_never_removed() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "locked".into(),
            },
            "l",
        ),
    )
    .unwrap();
    repo.git(&["worktree", "lock", "--reason", "in use", &added.path]);
    let report =
        worktree::remove(&repo.registry, &repo.path(), &added.path, true, &repo.ws).unwrap();
    assert!(!report.removed);
    assert_eq!(report.blockers, vec![RemoveBlocker::Locked]);
    assert_eq!(report.lock_reason.as_deref(), Some("in use"));
    assert!(Path::new(&added.path).is_dir());

    assert!(worktree::remove(&repo.registry, &repo.path(), &repo.path(), true, &repo.ws).is_err());
    assert!(worktree::remove(
        &repo.registry,
        &repo.path(),
        "/tmp/not-a-worktree",
        true,
        &repo.ws
    )
    .is_err());
}

#[test]
fn prune_forgets_deleted_worktrees_and_revokes_their_grant() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "gone".into(),
            },
            "g",
        ),
    )
    .unwrap();
    let path = PathBuf::from(&added.path);
    std::fs::remove_dir_all(&path).unwrap();

    let listed = worktree::list(&repo.registry, &repo.path(), &repo.ws).unwrap();
    let entry = listed
        .iter()
        .find(|e| e.branch.as_deref() == Some("gone"))
        .unwrap();
    assert!(entry.prunable && !entry.exists);

    let report = worktree::prune(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(report.pruned.len(), 1);
    assert!(!authorized(&repo.registry, &path));
    assert_eq!(
        worktree::list(&repo.registry, &repo.path(), &repo.ws)
            .unwrap()
            .len(),
        1
    );
    assert!(worktree::prune(&repo.registry, &repo.path(), &repo.ws)
        .unwrap()
        .pruned
        .is_empty());
}

#[test]
fn listing_reauthorizes_existing_worktrees_but_only_with_a_backlink() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let added = add_worktree(
        &repo,
        &base,
        &add_request(
            WorktreeBranch::NewBranch {
                name: "back".into(),
            },
            "b",
        ),
    )
    .unwrap();
    let path = PathBuf::from(&added.path);
    repo.registry.revoke_derived(&path);
    assert!(!authorized(&repo.registry, &path));
    worktree::list(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert!(
        authorized(&repo.registry, &path),
        "restored after a restart"
    );

    // A worktree whose .git file does not point back into this repository's
    // administrative area is not trusted, whatever git lists.
    repo.registry.revoke_derived(&path);
    std::fs::write(path.join(".git"), "gitdir: /somewhere/else\n").unwrap();
    worktree::list(&repo.registry, &repo.path(), &repo.ws).ok();
    assert!(!authorized(&repo.registry, &path));
}

// ---------------------------------------------------------- checkpoints

fn index_bytes(repo: &TestRepo) -> Vec<u8> {
    std::fs::read(repo.root.join(".git/index")).unwrap_or_default()
}

fn checkpoint_tree_files(repo: &TestRepo, tree: &str) -> Vec<String> {
    repo.git(&[
        "-c",
        "core.quotepath=false",
        "ls-tree",
        "-r",
        "--name-only",
        tree,
    ])
    .lines()
    .map(str::to_string)
    .collect()
}

#[test]
fn creating_a_checkpoint_never_touches_the_index_head_branches_or_files() {
    let repo = TestRepo::new();
    repo.write(".gitignore", "*.log\n");
    repo.write("tracked.txt", "v1\n");
    repo.commit_all("base");
    repo.write("tracked.txt", "v2\n");
    repo.git(&["add", "tracked.txt"]);
    repo.write("tracked.txt", "v3\n");
    repo.write("untracked dir/new \u{e9}.txt", "n\n");
    repo.write("debug.log", "ignored\n");

    let head = repo.git(&["rev-parse", "HEAD"]);
    let status = repo.git(&["status", "--porcelain=v2", "--branch"]);
    let index = index_bytes(&repo);
    let branches = repo.git(&["for-each-ref", "refs/heads"]);
    let tracked = repo.read("tracked.txt");

    let created = checkpoint::create(&repo.registry, &repo.path(), "task-1", 1, &repo.ws).unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["status", "--porcelain=v2", "--branch"]), status);
    assert_eq!(
        index_bytes(&repo),
        index,
        "the real index is byte-identical"
    );
    assert_eq!(repo.git(&["for-each-ref", "refs/heads"]), branches);
    assert_eq!(repo.read("tracked.txt"), tracked);
    let leftovers: Vec<_> = std::fs::read_dir(repo.root.join(".git"))
        .unwrap()
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("terax-snapshot")
        })
        .collect();
    assert!(leftovers.is_empty(), "temporary indexes are cleaned up");

    assert_eq!(created.info.ref_name, "refs/terax/checkpoints/task-1/1");
    assert_eq!(created.info.parent.as_deref(), Some(head.trim()));
    assert!(created.consistent);
    assert!(created.warnings.is_empty(), "{:?}", created.warnings);
    assert!(!created.limits.atomic);
    assert_eq!(
        repo.git(&["rev-parse", "refs/terax/checkpoints/task-1/1"])
            .trim(),
        created.info.commit
    );
    let files = checkpoint_tree_files(&repo, &created.info.tree);
    assert!(files.contains(&"tracked.txt".to_string()));
    assert!(files.contains(&"untracked dir/new \u{e9}.txt".to_string()));
    assert!(
        !files.contains(&"debug.log".to_string()),
        "ignored files are excluded"
    );
    assert_eq!(
        repo.git(&["show", &format!("{}:tracked.txt", created.info.commit)]),
        "v3\n"
    );
}

#[test]
fn checkpoints_work_on_an_unborn_branch() {
    let repo = TestRepo::unborn();
    repo.write("first.txt", "1\n");
    let created = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    assert_eq!(created.info.parent, None);
    assert_eq!(
        checkpoint_tree_files(&repo, &created.info.tree),
        vec!["first.txt"]
    );
}

#[test]
fn checkpoint_list_is_ordered_by_turn_and_prune_removes_only_that_task() {
    let repo = TestRepo::new();
    for turn in [3u32, 1, 10, 2] {
        checkpoint::create(&repo.registry, &repo.path(), "alpha", turn, &repo.ws).unwrap();
    }
    checkpoint::create(&repo.registry, &repo.path(), "beta", 1, &repo.ws).unwrap();
    let listed = checkpoint::list(&repo.registry, &repo.path(), "alpha", &repo.ws).unwrap();
    assert_eq!(
        listed.iter().map(|c| c.turn).collect::<Vec<_>>(),
        vec![1, 2, 3, 10]
    );
    assert!(listed.iter().all(|c| c.task_id == "alpha"));

    assert_eq!(
        checkpoint::prune(&repo.registry, &repo.path(), "alpha", &repo.ws).unwrap(),
        4
    );
    assert!(
        checkpoint::list(&repo.registry, &repo.path(), "alpha", &repo.ws)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        checkpoint::list(&repo.registry, &repo.path(), "beta", &repo.ws)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        checkpoint::prune(&repo.registry, &repo.path(), "alpha", &repo.ws).unwrap(),
        0
    );
}

#[test]
fn recreating_a_turn_replaces_its_checkpoint() {
    let repo = TestRepo::new();
    let first = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("more.txt", "m\n");
    let second = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    assert_ne!(first.info.commit, second.info.commit);
    let listed = checkpoint::list(&repo.registry, &repo.path(), "t", &repo.ws).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].commit, second.info.commit);
}

#[test]
fn task_ids_and_refs_are_validated() {
    let repo = TestRepo::new();
    for bad in ["", "../x", "a/b", "-x", "a b", "x.lock"] {
        assert!(
            checkpoint::create(&repo.registry, &repo.path(), bad, 1, &repo.ws).is_err(),
            "{bad:?}"
        );
        assert!(
            checkpoint::list(&repo.registry, &repo.path(), bad, &repo.ws).is_err(),
            "{bad:?}"
        );
        assert!(
            checkpoint::prune(&repo.registry, &repo.path(), bad, &repo.ws).is_err(),
            "{bad:?}"
        );
    }
    for bad in [
        "refs/heads/main",
        "main",
        "HEAD",
        "refs/terax/checkpoints/x",
        "refs/terax/checkpoints/../1",
    ] {
        assert!(
            checkpoint::restore(&repo.registry, &repo.path(), bad, true, &repo.ws).is_err(),
            "{bad:?}"
        );
    }
}

#[test]
fn restore_puts_back_tracked_and_untracked_state_and_spares_ignored_files() {
    let repo = TestRepo::new();
    repo.write(".gitignore", "*.log\nbuild/\n");
    repo.write("a.txt", "a original\n");
    repo.write("b.txt", "b original\n");
    repo.write("src/deep/c.txt", "c original\n");
    repo.commit_all("base");
    repo.write("scratch notes.txt", "before turn 1\n");
    let head_before = repo.git(&["rev-parse", "HEAD"]);

    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "task", 1, &repo.ws).unwrap();

    // Turn 1: the agent edits, deletes, creates (including a new directory) and
    // stages; it also writes ignored files.
    repo.write("a.txt", "a changed\n");
    std::fs::remove_file(repo.root.join("b.txt")).unwrap();
    std::fs::remove_file(repo.root.join("scratch notes.txt")).unwrap();
    repo.write("new/dir/file.txt", "created by the agent\n");
    repo.write("src/deep/extra.txt", "extra\n");
    repo.write("debug.log", "ignored output\n");
    repo.write("build/out.o", "ignored build output\n");
    repo.git(&["add", "new/dir/file.txt", "a.txt"]);
    let cp2 = checkpoint::create(&repo.registry, &repo.path(), "task", 2, &repo.ws).unwrap();
    assert_ne!(cp1.info.tree, cp2.info.tree);

    let report = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(report.restored, "{report:?}");
    assert_eq!(report.written, 3);
    assert_eq!(report.removed, 2);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert!(report.index_synced);
    assert!(!report.head_moved);
    assert!(!report.atomic);

    assert_eq!(repo.read("a.txt"), "a original\n");
    assert_eq!(repo.read("b.txt"), "b original\n");
    assert_eq!(repo.read("scratch notes.txt"), "before turn 1\n");
    assert!(
        !repo.exists("new"),
        "empty directories created by the agent are removed"
    );
    assert!(!repo.exists("src/deep/extra.txt"));
    assert!(repo.exists("src/deep/c.txt"));
    assert_eq!(
        repo.read("debug.log"),
        "ignored output\n",
        "ignored files are never touched"
    );
    assert_eq!(repo.read("build/out.o"), "ignored build output\n");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head_before);
    assert_eq!(
        repo.git(&["-c", "core.quotepath=false", "status", "--porcelain", "-z"])
            .trim_end_matches('\0'),
        "?? scratch notes.txt",
        "tracked files are clean again and the index no longer holds the agent's staging"
    );
}

#[test]
fn restore_refuses_when_files_changed_since_the_latest_checkpoint_unless_forced() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    let _cp2 = checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    repo.write("a.txt", "the user edited this after turn 2\n");
    repo.write("user-note.txt", "mine\n");
    let refused = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(!refused.restored);
    assert_eq!(refused.refusal, Some(RestoreRefusal::ChangedSinceLatest));
    assert_eq!(refused.dirty_total, 2);
    let mut dirty: Vec<_> = refused.dirty.iter().map(|d| d.path.as_str()).collect();
    dirty.sort();
    assert_eq!(dirty, vec!["a.txt", "user-note.txt"]);
    assert_eq!(
        refused.latest_ref.as_deref(),
        Some("refs/terax/checkpoints/t/2")
    );
    assert_eq!(
        repo.read("a.txt"),
        "the user edited this after turn 2\n",
        "nothing was changed"
    );
    assert!(repo.exists("user-note.txt"));

    let forced = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        true,
        &repo.ws,
    )
    .unwrap();
    assert!(forced.restored);
    assert_eq!(repo.read("a.txt"), "one\n");
    assert!(!repo.exists("user-note.txt"));
}

#[test]
fn restore_reports_that_head_moved_and_keeps_commits() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let cp = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");
    let agent_commit = repo.commit_all("agent commit");
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    let report = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(report.restored);
    assert!(report.head_moved);
    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]).trim(), agent_commit);
}

#[test]
fn restore_never_follows_a_symlink_out_of_the_worktree() {
    #[cfg(unix)]
    {
        let repo = TestRepo::new();
        repo.write("src/keep.txt", "k\n");
        repo.commit_all("base");
        let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
        repo.write("src/created.txt", "agent file\n");
        let _cp2 = checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

        // After the last checkpoint `src` becomes a symlink to a directory
        // outside the worktree that holds a file with the same name.
        let (_keep, outside) = scratch();
        std::fs::write(outside.join("created.txt"), "precious\n").unwrap();
        std::fs::remove_dir_all(repo.root.join("src")).unwrap();
        std::os::unix::fs::symlink(&outside, repo.root.join("src")).unwrap();

        let report = checkpoint::restore(
            &repo.registry,
            &repo.path(),
            &cp1.info.ref_name,
            true,
            &repo.ws,
        )
        .unwrap();
        assert!(report.restored);
        assert_eq!(
            std::fs::read_to_string(outside.join("created.txt")).unwrap(),
            "precious\n",
            "the file behind the symlink is untouched"
        );
    }
}

#[test]
fn restoring_on_an_unborn_branch_removes_what_the_agent_added() {
    let repo = TestRepo::unborn();
    repo.write("seed.txt", "seed\n");
    let cp1 = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("seed.txt", "changed\n");
    repo.write("added.txt", "added\n");
    repo.git(&["add", "added.txt"]);
    checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws).unwrap();

    let report = checkpoint::restore(
        &repo.registry,
        &repo.path(),
        &cp1.info.ref_name,
        false,
        &repo.ws,
    )
    .unwrap();
    assert!(report.restored, "{report:?}");
    assert_eq!(repo.read("seed.txt"), "seed\n");
    assert!(!repo.exists("added.txt"));
    assert_eq!(
        repo.git(&["ls-files"]).trim(),
        "",
        "the staged addition is gone from the index"
    );
}

#[test]
fn checkpoint_creation_is_fast_on_a_wide_repository() {
    let repo = TestRepo::new();
    for dir in 0..40 {
        for file in 0..50 {
            repo.write(
                &format!("pkg{dir}/file{file}.txt"),
                &format!("{dir}-{file}\n"),
            );
        }
    }
    repo.commit_all("wide");
    repo.write("pkg3/file7.txt", "changed\n");
    let started = std::time::Instant::now();
    let created = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    assert!(created.consistent);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(20),
        "took {:?}",
        started.elapsed()
    );
    assert_eq!(
        repo.git(&["status", "--porcelain"]).trim(),
        "M pkg3/file7.txt"
    );
}

// ------------------------------------------------------------- branches

#[test]
fn branches_can_be_created_from_a_base_and_renamed() {
    let repo = TestRepo::new();
    let first = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    repo.write("a.txt", "a\n");
    repo.commit_all("second");

    let created = branch::create(
        &repo.registry,
        &repo.path(),
        "feature/x",
        Some(&first),
        &repo.ws,
    )
    .unwrap();
    assert_eq!(created.commit, first);
    assert_eq!(repo.git(&["rev-parse", "feature/x"]).trim(), first);
    assert_eq!(
        repo.git(&["branch", "--show-current"]).trim(),
        "main",
        "no checkout"
    );

    assert!(branch::create(&repo.registry, &repo.path(), "feature/x", None, &repo.ws).is_err());
    branch::create(&repo.registry, &repo.path(), "from-head", None, &repo.ws).unwrap();

    branch::rename(
        &repo.registry,
        &repo.path(),
        "feature/x",
        "feature/y",
        &repo.ws,
    )
    .unwrap();
    assert!(repo
        .git(&["branch", "--list", "feature/y"])
        .contains("feature/y"));
    assert!(!repo
        .git(&["branch", "--list", "feature/x"])
        .contains("feature/x"));
    assert!(branch::rename(&repo.registry, &repo.path(), "missing", "z", &repo.ws).is_err());
    assert!(branch::rename(&repo.registry, &repo.path(), "feature/y", "main", &repo.ws).is_err());
}

#[test]
fn branch_names_are_validated_with_git_check_ref_format() {
    let repo = TestRepo::new();
    for bad in [
        "",
        "-x",
        "--force",
        "a..b",
        "a b",
        "a~1",
        "a^",
        "a:b",
        "a?",
        "a*",
        "a[",
        "a\\b",
        "/a",
        "a/",
        "a//b",
        "a.lock",
        ".hidden",
        "a/.hidden",
        "@",
        "a@{b}",
        "a\nb",
        "HEAD.",
        "x/y.lock/z",
    ] {
        assert!(
            branch::create(&repo.registry, &repo.path(), bad, None, &repo.ws).is_err(),
            "{bad:?} must be rejected"
        );
        assert!(
            branch::rename(&repo.registry, &repo.path(), "main", bad, &repo.ws).is_err(),
            "{bad:?} must be rejected as a rename target"
        );
    }
    assert!(branch::create(
        &repo.registry,
        &repo.path(),
        "ok/with-dash_and.dot",
        None,
        &repo.ws
    )
    .is_ok());
    assert!(branch::create(&repo.registry, &repo.path(), "caf\u{e9}", None, &repo.ws).is_ok());
}

#[test]
fn creating_a_branch_in_an_empty_repository_is_an_error() {
    let repo = TestRepo::unborn();
    assert!(branch::create(&repo.registry, &repo.path(), "x", None, &repo.ws).is_err());
}

fn with_remote(repo: &TestRepo) -> (tempfile::TempDir, PathBuf) {
    let (keep, remote) = scratch();
    git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
    repo.git(&["remote", "add", "origin", &remote.to_string_lossy()]);
    (keep, remote)
}

#[test]
fn upstream_info_reports_tracking_counts_and_the_remote_url() {
    let repo = TestRepo::new();
    let (_keep, remote) = with_remote(&repo);

    let none = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(none.branch.as_deref(), Some("main"));
    assert_eq!(none.upstream, None);
    assert!(none.has_remotes);
    assert_eq!(none.suggested_remote.as_deref(), Some("origin"));

    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.write("a.txt", "a\n");
    repo.commit_all("ahead");
    let tracked = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(tracked.upstream.as_deref(), Some("origin/main"));
    assert_eq!(tracked.remote.as_deref(), Some("origin"));
    assert_eq!(tracked.remote_branch.as_deref(), Some("main"));
    assert_eq!(
        tracked.remote_url.as_deref(),
        Some(remote.to_string_lossy().as_ref())
    );
    assert_eq!((tracked.ahead, tracked.behind), (1, 0));
    assert!(!tracked.gone);

    // Someone else pushes; after a fetch we are behind as well.
    let (_other_keep, other) = scratch();
    git_in(&other, &["clone", "-q", &remote.to_string_lossy(), "clone"]);
    let clone = other.join("clone");
    git_in(&clone, &["config", "user.name", "T"]);
    git_in(&clone, &["config", "user.email", "t@example.com"]);
    std::fs::write(clone.join("theirs.txt"), "t\n").unwrap();
    git_in(&clone, &["add", "theirs.txt"]);
    git_in(&clone, &["commit", "-q", "-m", "theirs"]);
    git_in(&clone, &["push", "-q", "origin", "main"]);
    repo.git(&["fetch", "-q"]);
    let diverged = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!((diverged.ahead, diverged.behind), (1, 1));

    git_in(&remote, &["config", "receive.denyDeleteCurrent", "ignore"]);
    repo.git(&["push", "-q", "origin", "--delete", "main"]);
    repo.git(&["fetch", "-q", "--prune"]);
    let gone = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert!(gone.gone);
    assert_eq!(gone.upstream.as_deref(), Some("origin/main"));
}

#[test]
fn upstream_info_on_a_detached_head() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "--detach"]);
    let info = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert!(info.detached);
    assert_eq!(info.branch, None);
    assert_eq!(info.upstream, None);
}

#[test]
fn push_sets_the_upstream_only_when_asked() {
    let repo = TestRepo::new();
    let (_keep, remote) = with_remote(&repo);
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.write("t.txt", "t\n");
    repo.commit_all("topic work");

    let refused = operations::push(&repo.registry, &repo.path(), false, &repo.ws);
    assert!(matches!(refused, Err(GitError::NoUpstream)));

    let pushed = operations::push(&repo.registry, &repo.path(), true, &repo.ws).unwrap();
    assert!(pushed.pushed);
    assert_eq!(pushed.remote.as_deref(), Some("origin"));
    assert_eq!(pushed.branch.as_deref(), Some("topic"));
    let info = branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(info.upstream.as_deref(), Some("origin/topic"));
    assert_eq!(
        git_in(&remote, &["rev-parse", "topic"]).trim(),
        repo.git(&["rev-parse", "HEAD"]).trim()
    );

    // With an upstream, the flag changes nothing.
    repo.write("t2.txt", "t2\n");
    repo.commit_all("more");
    assert!(
        operations::push(&repo.registry, &repo.path(), true, &repo.ws)
            .unwrap()
            .pushed
    );
    assert_eq!(
        git_in(&remote, &["rev-parse", "topic"]).trim(),
        repo.git(&["rev-parse", "HEAD"]).trim()
    );
}

#[test]
fn push_with_set_upstream_needs_a_branch_and_a_remote() {
    let repo = TestRepo::new();
    assert!(
        operations::push(&repo.registry, &repo.path(), true, &repo.ws).is_err(),
        "no remote"
    );
    let (_keep, _remote) = with_remote(&repo);
    repo.git(&["checkout", "-q", "--detach"]);
    assert!(
        operations::push(&repo.registry, &repo.path(), true, &repo.ws).is_err(),
        "detached"
    );
}
