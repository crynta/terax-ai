//! Regression tests for the review-thread fixes: which remote a first push
//! uses and how the upstream is resolved, the per-worktree lock, test-helper
//! hygiene, Unix path spelling, fail-closed worktree removal and authorization
//! of a task listed from inside itself.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use crate::modules::git::branch;
use crate::modules::git::checkpoint;
use crate::modules::git::operations;
use crate::modules::git::plumbing;
use crate::modules::git::review::{ApplyMode, ApplySelection, GitDiffScope, HunkSelection};
use crate::modules::git::review_tests::{apply, file_diff, numbered};
use crate::modules::git::testutil::{authorized, git_command, git_in, scratch, TestRepo};
use crate::modules::git::worktree::{
    self, RemoveBlocker, RemoveLimits, WorktreeAddRequest, WorktreeBranch,
};

fn add_bare(repo: &TestRepo, name: &str) -> (tempfile::TempDir, PathBuf) {
    let (keep, remote) = scratch();
    git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
    repo.git(&["remote", "add", name, &remote.to_string_lossy()]);
    (keep, remote)
}

fn has_branch(remote: &Path, name: &str) -> bool {
    git_command(
        remote,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ],
    )
    .output()
    .unwrap()
    .status
    .success()
}

fn start_topic(repo: &TestRepo) {
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.write("t.txt", "t\n");
    repo.commit_all("topic work");
}

fn push_first(
    repo: &TestRepo,
) -> crate::modules::git::errors::Result<crate::modules::git::types::GitPushResult> {
    operations::push(&repo.registry, &repo.path(), true, &repo.ws)
}

fn info(repo: &TestRepo) -> branch::UpstreamInfo {
    branch::upstream_info(&repo.registry, &repo.path(), &repo.ws).unwrap()
}

// ----------------------------------------------- the remote of a first push

#[test]
fn the_first_push_goes_to_the_repositorys_push_default_not_to_origin() {
    let repo = TestRepo::new();
    let (_o, origin) = add_bare(&repo, "origin");
    let (_f, fork) = add_bare(&repo, "fork");
    start_topic(&repo);
    repo.git(&["config", "remote.pushDefault", "fork"]);

    assert_eq!(info(&repo).suggested_remote.as_deref(), Some("fork"));
    let pushed = push_first(&repo).unwrap();
    assert_eq!(pushed.remote.as_deref(), Some("fork"));
    assert!(has_branch(&fork, "topic"));
    assert!(!has_branch(&origin, "topic"), "origin never saw the branch");
    assert_eq!(info(&repo).upstream.as_deref(), Some("fork/topic"));
}

#[test]
fn a_branchs_own_push_remote_beats_the_repository_default() {
    let repo = TestRepo::new();
    let (_o, origin) = add_bare(&repo, "origin");
    let (_f, fork) = add_bare(&repo, "fork");
    start_topic(&repo);
    repo.git(&["config", "remote.pushDefault", "fork"]);
    repo.git(&["config", "branch.topic.pushRemote", "origin"]);

    assert_eq!(info(&repo).suggested_remote.as_deref(), Some("origin"));
    assert_eq!(push_first(&repo).unwrap().remote.as_deref(), Some("origin"));
    assert!(has_branch(&origin, "topic") && !has_branch(&fork, "topic"));
}

#[test]
fn a_configured_push_remote_that_does_not_exist_publishes_nothing() {
    let repo = TestRepo::new();
    let (_o, origin) = add_bare(&repo, "origin");
    start_topic(&repo);
    repo.git(&["config", "branch.topic.pushRemote", "nowhere"]);

    let before = info(&repo);
    assert!(before.has_remotes);
    assert_eq!(before.suggested_remote, None, "no guessing past a setting");
    assert!(push_first(&repo).is_err());
    assert!(!has_branch(&origin, "topic"));
}

#[test]
fn without_any_push_setting_origin_is_still_the_choice() {
    let repo = TestRepo::new();
    let (_o, origin) = add_bare(&repo, "origin");
    let (_f, fork) = add_bare(&repo, "fork");
    start_topic(&repo);
    assert_eq!(push_first(&repo).unwrap().remote.as_deref(), Some("origin"));
    assert!(has_branch(&origin, "topic") && !has_branch(&fork, "topic"));
}

#[test]
fn a_tag_named_like_the_branch_does_not_break_the_first_push() {
    let repo = TestRepo::new();
    let (_o, origin) = add_bare(&repo, "origin");
    start_topic(&repo);
    repo.git(&["tag", "topic"]);
    assert_eq!(info(&repo).branch.as_deref(), Some("topic"));

    let pushed = push_first(&repo).unwrap();
    assert!(pushed.pushed);
    assert_eq!(pushed.branch.as_deref(), Some("topic"));
    assert!(has_branch(&origin, "topic"));
    assert_eq!(
        git_in(&origin, &["rev-parse", "refs/heads/topic"]).trim(),
        repo.git(&["rev-parse", "HEAD"]).trim()
    );
    assert_eq!(info(&repo).upstream.as_deref(), Some("origin/topic"));
}

// ------------------------------------ the upstream through a custom refspec

#[test]
fn the_upstream_is_the_ref_the_fetch_refspec_maps_not_origin_slash_branch() {
    let repo = TestRepo::new();
    let (_o, _origin) = add_bare(&repo, "origin");
    repo.git(&[
        "config",
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/company/*",
    ]);
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["fetch", "-q", "origin"]);
    repo.git(&["config", "branch.main.remote", "origin"]);
    repo.git(&["config", "branch.main.merge", "refs/heads/main"]);

    let tracked = info(&repo);
    assert_eq!(tracked.upstream.as_deref(), Some("company/main"));
    assert_eq!(tracked.remote.as_deref(), Some("origin"));
    assert_eq!(tracked.remote_branch.as_deref(), Some("main"));
    assert!(!tracked.gone);
    assert_eq!((tracked.ahead, tracked.behind), (0, 0));

    repo.write("more.txt", "more\n");
    repo.commit_all("ahead");
    let ahead = info(&repo);
    assert!(!ahead.gone);
    assert_eq!((ahead.ahead, ahead.behind), (1, 0));

    repo.git(&["update-ref", "-d", "refs/remotes/company/main"]);
    let gone = info(&repo);
    assert!(gone.gone);
    assert_eq!(gone.upstream.as_deref(), Some("company/main"));
}

// ------------------------- one lock per worktree for every read-then-write op

/// Runs `op` on another thread while this one holds the worktree's lock: it must
/// not finish until the lock is released, and must finish promptly after.
fn runs_only_after_the_lock_is_released<T: Send>(
    repo: &TestRepo,
    op: impl FnOnce() -> T + Send,
) -> T {
    let resolved = plumbing::open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
    let lock = plumbing::lock_for_repo(&resolved);
    let guard = lock.lock().unwrap();
    std::thread::scope(|scope| {
        let (done, finished) = mpsc::channel();
        let handle = scope.spawn(move || {
            let out = op();
            let _ = done.send(());
            out
        });
        assert!(
            finished.recv_timeout(Duration::from_millis(400)).is_err(),
            "the operation ran while the worktree's lock was held"
        );
        drop(guard);
        finished
            .recv_timeout(Duration::from_secs(120))
            .expect("the operation never resumed");
        handle.join().unwrap()
    })
}

#[test]
fn hunk_apply_waits_for_the_lock_checkpoints_hold() {
    let repo = TestRepo::new();
    repo.write("f.txt", &numbered(40, "l"));
    repo.commit_all("base");
    repo.write("f.txt", &numbered(40, "l").replace("l3\n", "L3\n"));
    let diff = file_diff(&repo, &GitDiffScope::Unstaged, "f.txt");
    let id = diff.hunks[0].id.clone();

    let outcome = runs_only_after_the_lock_is_released(&repo, || {
        apply(
            &repo,
            GitDiffScope::Unstaged,
            "f.txt",
            ApplyMode::Stage,
            ApplySelection::Hunks {
                items: vec![HunkSelection { id, lines: None }],
            },
        )
    });
    assert!(outcome.applied, "{:?}", outcome.refusal);
}

#[test]
fn checkpoint_create_restore_and_prune_wait_for_the_same_lock() {
    let repo = TestRepo::new();
    repo.write("a.txt", "one\n");
    repo.commit_all("base");
    let first = checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).unwrap();
    repo.write("a.txt", "two\n");

    let created = runs_only_after_the_lock_is_released(&repo, || {
        checkpoint::create(&repo.registry, &repo.path(), "t", 2, &repo.ws)
    });
    assert_eq!(created.unwrap().info.turn, 2);

    let restored = runs_only_after_the_lock_is_released(&repo, || {
        checkpoint::restore(
            &repo.registry,
            &repo.path(),
            &first.info.ref_name,
            false,
            &repo.ws,
        )
    });
    assert!(restored.unwrap().restored);
    assert_eq!(repo.read("a.txt"), "one\n");

    let pruned = runs_only_after_the_lock_is_released(&repo, || {
        checkpoint::prune(&repo.registry, &repo.path(), "t", &repo.ws)
    });
    assert!(pruned.unwrap() >= 2);
}

#[test]
fn the_lock_is_the_worktrees_not_the_repositorys() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let task = add_task(&repo, &base, "own-lock");
    let main = plumbing::open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
    let linked =
        plumbing::open_worktree(&repo.registry, &task.to_string_lossy(), &repo.ws).unwrap();
    let main_lock = plumbing::lock_for_repo(&main);
    let _held = main_lock.lock().unwrap();
    let other = plumbing::lock_for_repo(&linked);
    assert!(
        other.try_lock().is_ok(),
        "a task's operations do not queue behind the main checkout's"
    );
}

// ------------------------------------------------------ test-helper hygiene

#[test]
fn test_git_commands_drop_the_variables_that_redirect_git() {
    let dir = tempfile::tempdir().unwrap();
    let command = git_command(dir.path(), &["status"]);
    let removed: Vec<String> = command
        .get_envs()
        .filter(|(_, value)| value.is_none())
        .map(|(name, _)| name.to_string_lossy().into_owned())
        .collect();
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
        "GIT_PREFIX",
    ] {
        assert!(removed.iter().any(|r| r == name), "{name} is inherited");
    }
    assert!(
        !removed.iter().any(|r| r == "GIT_CONFIG_GLOBAL"),
        "the pinned test configuration stays"
    );
}

// ---------------------------------------------- Unix file names with a backslash

#[cfg(unix)]
#[test]
fn a_backslash_in_a_file_name_is_not_a_separator_on_unix() {
    let repo = TestRepo::new();
    repo.write("a\\b.txt", "backslash\n");
    repo.write("a/b.txt", "slash\n");
    repo.write("d/e\\f.txt", "nested backslash\n");
    repo.commit_all("both spellings");
    let resolved = plumbing::open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(
        plumbing::relative_spec(&resolved, "a\\b.txt").unwrap(),
        "a\\b.txt"
    );
    assert_eq!(
        plumbing::relative_spec(&resolved, "a/b.txt").unwrap(),
        "a/b.txt"
    );
    assert_eq!(
        plumbing::relative_spec(&resolved, "d/e\\f.txt").unwrap(),
        "d/e\\f.txt"
    );

    repo.write("a\\b.txt", "BACKSLASH\n");
    repo.write("a/b.txt", "SLASH\n");
    let outcome = apply(
        &repo,
        GitDiffScope::Unstaged,
        "a\\b.txt",
        ApplyMode::Revert,
        ApplySelection::File,
    );
    assert!(outcome.applied, "{:?}", outcome.refusal);
    assert_eq!(repo.read("a\\b.txt"), "backslash\n");
    assert_eq!(
        repo.read("a/b.txt"),
        "SLASH\n",
        "the other file's edits survive"
    );
}

// -------------------------------------------- the real index's age on a copy

fn set_mtime(path: &Path, when: SystemTime) {
    std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(when)
        .unwrap();
}

#[cfg(unix)]
#[test]
fn a_read_only_real_index_still_hands_its_age_to_the_private_copy() {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::new();
    let long_ago = SystemTime::now() - Duration::from_secs(7200);
    let real = repo.root.join(".git/index");
    set_mtime(&real, long_ago);
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o444)).unwrap();

    let resolved = plumbing::open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
    let seeded = checkpoint::seeded_index_mtime_for_tests(&resolved).unwrap();
    let apart = seeded
        .duration_since(long_ago)
        .unwrap_or_else(|e| e.duration());
    assert!(
        apart < Duration::from_secs(2),
        "the copy was stamped {apart:?} away from the original's mtime"
    );
    assert!(checkpoint::create(&repo.registry, &repo.path(), "t", 1, &repo.ws).is_ok());
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o644)).unwrap();
}

// ------------------------------------- worktree removal fails closed, not open

fn add_task(repo: &TestRepo, base: &Path, name: &str) -> PathBuf {
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
            include: Vec::new(),
        },
        base,
        &repo.ws,
    )
    .unwrap();
    PathBuf::from(added.path)
}

#[test]
fn removal_is_refused_when_the_ignored_files_check_could_not_finish() {
    let repo = TestRepo::new();
    repo.write(".gitignore", ".env\n");
    repo.commit_all("ignores");
    let (_keep, base) = scratch();
    let task = add_task(&repo, &base, "capped");
    std::fs::write(task.join(".env"), "TOKEN=1\n").unwrap();
    let path = task.to_string_lossy().into_owned();

    // The same worktree under the real limits: an ordinary, explained refusal.
    let normal = worktree::remove(&repo.registry, &repo.path(), &path, false, &repo.ws).unwrap();
    assert!(!normal.removed);
    assert_eq!(normal.blockers, vec![RemoveBlocker::Ignored]);
    assert!(normal.inconclusive.is_empty());

    // A listing cut short proves nothing about what is left unlisted.
    let tiny = RemoveLimits {
        ignored_listing_bytes: 2,
    };
    let capped =
        worktree::remove_with_limits(&repo.registry, &repo.path(), &path, false, &repo.ws, tiny)
            .unwrap();
    assert!(!capped.removed);
    assert!(
        capped.blockers.contains(&RemoveBlocker::Inconclusive),
        "{:?}",
        capped.blockers
    );
    assert_eq!(capped.inconclusive, vec!["ignored-files".to_string()]);
    assert!(task.join(".env").exists(), "nothing was deleted");

    // `force` is the caller's way past it.
    let forced =
        worktree::remove_with_limits(&repo.registry, &repo.path(), &path, true, &repo.ws, tiny)
            .unwrap();
    assert!(forced.removed, "{forced:?}");
    assert!(!task.exists());
}

#[test]
fn a_clean_worktree_with_nothing_ignored_is_removed_under_any_limit() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let task = add_task(&repo, &base, "clean");
    let report = worktree::remove_with_limits(
        &repo.registry,
        &repo.path(),
        &task.to_string_lossy(),
        false,
        &repo.ws,
        RemoveLimits {
            ignored_listing_bytes: 1,
        },
    )
    .unwrap();
    assert!(report.removed, "{report:?}");
    assert!(report.inconclusive.is_empty());
}

// ------------------- a task listed from inside itself keeps its authorization

#[test]
fn listing_worktrees_from_inside_a_task_keeps_that_task_authorized() {
    let repo = TestRepo::new();
    let (_keep, base) = scratch();
    let task = add_task(&repo, &base, "inside");
    assert!(authorized(&repo.registry, &task));

    let entries = worktree::list(&repo.registry, &task.to_string_lossy(), &repo.ws).unwrap();
    assert!(entries.len() >= 2);
    assert!(
        authorized(&repo.registry, &task),
        "listing re-derived the task from itself and orphaned its grant"
    );
    assert!(plumbing::open_worktree(&repo.registry, &task.to_string_lossy(), &repo.ws).is_ok());

    assert!(repo.registry.revoke_derived(&task));
    assert!(!authorized(&repo.registry, &task));
}
