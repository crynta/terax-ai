use std::path::Path;
use std::time::Duration;

use super::project_config::{self, Ports};
use super::task_state::{Store, TaskStatus};
use super::task_worktree::{self as tasks, TaskBase, TaskCreateRequest};
use super::testutil::{git_in, scratch, TestRepo};

fn create(repo: &TestRepo, home: &Path, name: &str) -> tasks::TaskCreated {
    tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: name.into(),
            base: None,
        },
        &repo.ws,
        home,
    )
    .unwrap()
}

fn assert_shared_outcome(created: &tasks::TaskCreated, entry: &str) -> bool {
    let relative = entry.trim_end_matches('/');
    let path = Path::new(&created.task.path).join(relative);
    if created
        .skipped
        .iter()
        .any(|s| s.path == entry && s.reason == "symlink-privilege-required")
    {
        #[cfg(not(windows))]
        {
            panic!("only Windows can report missing symlink privilege");
        }
        #[cfg(windows)]
        {
            assert!(!created.shared.iter().any(|p| p == entry));
            assert!(!created.task.shared_links.contains_key(relative));
            assert_eq!(
                std::fs::symlink_metadata(path).unwrap_err().kind(),
                std::io::ErrorKind::NotFound
            );
            assert_eq!(created.task.status, TaskStatus::Active);
            false
        }
    } else {
        assert!(created.shared.iter().any(|p| p == entry));
        assert!(created.task.shared_links.contains_key(relative));
        assert!(std::fs::symlink_metadata(path)
            .unwrap()
            .file_type()
            .is_symlink());
        true
    }
}

#[test]
fn config_defaults_unknown_keys_types_and_lines() {
    let config =
        project_config::parse("version = 999\nunknown = true\n[ports]\nbase = 4000\n").unwrap();
    assert_eq!(config.ports.base, 4000);
    assert_eq!(config.ports.per_task, 10);
    assert_eq!(config.worktree.branch_prefix, "terax/");
    assert_eq!(config.layout.default.cards, ["agent", "review | preview"]);
    assert_eq!(config.scripts.setup, "pnpm install");
    let json = serde_json::to_value(&config).unwrap();
    assert_eq!(json["ports"]["perTask"], 10);
    assert_eq!(json["scripts"]["runMode"], "concurrent");
    for text in [
        "[ports]\nbase = 'oops'",
        "[scripts]\nrun_mode = 'serial'",
        "[ports]\nper_task = 0",
        "[ports]\nbase = 65530",
        "[worktree]\ninclude = ['../secret']",
        "[worktree]\nshared = ['.git/config']",
        "[worktree]\ndir = '/tmp/{project}/../{task}'",
        "[worktree]\ndir = '/tmp/{task}/{project}'",
        "[worktree]\ndir = '/tmp/{unknown}/{task}'",
        "[worktree]\nbranch_prefix = '--bad'",
        "[[actions]]\nname = 'Test'",
        "[ports\nbase = 3",
    ] {
        let err = project_config::parse(text).unwrap_err().to_string();
        assert!(err.contains("line"), "{text}: {err}");
    }
    let config = project_config::parse("[scripts]\nsetup = ''\nrun_mode = 'exclusive'\n[layout.default]\ncards = ['review']\n[[actions]]\nname = 'Test'\nrun = 'pnpm test'\nfuture = true").unwrap();
    assert_eq!(config.actions[0].run, "pnpm test");
    assert!(config.scripts.setup.is_empty());
}

#[test]
fn reads_worktreeinclude_and_rejects_escapes() {
    let repo = TestRepo::new();
    let defaults = project_config::read(&repo.registry, &repo.path(), &repo.ws).unwrap();
    assert_eq!(defaults.worktree.include, [".env", ".env.local"]);
    repo.write(".worktreeinclude", "# comment\n.env\nlocal.json\n\n");
    assert_eq!(
        project_config::read(&repo.registry, &repo.path(), &repo.ws)
            .unwrap()
            .worktree
            .include,
        [".env", ".env.local", "local.json"]
    );
    repo.write(".worktreeinclude", "# comment\n../secret");
    assert!(project_config::read(&repo.registry, &repo.path(), &repo.ws)
        .unwrap_err()
        .to_string()
        .contains("line 2"));
}

#[test]
fn lifecycle_preserves_dirty_work_and_reallocates_ports() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(
        ".gitignore",
        ".env\n.env.local\nlocal.json\nnode_modules/\n",
    );
    repo.write(".terax/project.toml", "[worktree]\ninclude = ['.env', 'README.md', 'scratch.txt']\nshared = ['node_modules/.cache/']\n[scripts]\nsetup = 'echo setup'\narchive = 'echo archive'\n");
    repo.write(".worktreeinclude", "local.json\n");
    repo.commit_all("configuration");
    repo.write(".env", "SECRET=value\n");
    repo.write("local.json", "{}\n");
    repo.write("scratch.txt", "not ignored\n");
    repo.write("node_modules/.cache/item", "shared cache\n");
    let first = create(&repo, &home, "Fix Login!");
    let path = Path::new(&first.task.path);
    assert_eq!(first.task.branch, "terax/fix-login");
    assert_eq!(first.setup_script, "echo setup");
    assert_eq!(first.copied, [".env", "local.json"]);
    assert!(!path.join("scratch.txt").exists());
    assert_eq!(
        std::fs::read_to_string(path.join(".env")).unwrap(),
        "SECRET=value\n"
    );
    if assert_shared_outcome(&first, "node_modules/.cache/") {
        assert_eq!(
            std::fs::read_to_string(path.join("node_modules/.cache/item")).unwrap(),
            "shared cache\n"
        );
    }
    assert_eq!(first.env["TERAX_PORT_9"], "3009");
    assert!(!first.env["TERAX_WORKSPACE_PATH"].starts_with("\\\\?\\"));
    let second = create(&repo, &home, "Fix Login!");
    assert_ne!(first.task.path, second.task.path);
    assert_ne!(first.task.branch, second.task.branch);
    assert_eq!(second.task.port, 3010);
    let reloaded = tasks::list(&repo.registry, &repo.path(), &repo.ws, &home).unwrap();
    assert_eq!(reloaded[0].port, first.task.port);
    std::fs::write(path.join("README.md"), "committed work\n").unwrap();
    git_in(path, &["add", "README.md"]);
    git_in(path, &["commit", "-qm", "task commit"]);
    std::fs::write(path.join("README.md"), "dirty work\n").unwrap();
    std::fs::write(path.join("new.txt"), "untracked work\n").unwrap();
    let index = git_in(path, &["show", ":README.md"]);
    let prepared = tasks::prepare_archive(
        &repo.registry,
        &repo.path(),
        &first.task.id,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(prepared.archive_script, "echo archive");
    assert!(path.exists());
    assert_eq!(git_in(path, &["show", ":README.md"]), index);
    let refused = tasks::archive(
        &repo.registry,
        &repo.path(),
        &first.task.id,
        false,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(!refused.removal.removed);
    assert!(refused.removal.dirty_total > 0);
    assert!(refused.removal.unmerged_commits > 0);
    let archived = tasks::archive(
        &repo.registry,
        &repo.path(),
        &first.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(archived.removal.removed);
    assert!(!path.exists());
    assert_eq!(
        repo.git(&["show", &format!("{}:new.txt", archived.snapshot.reference)]),
        "untracked work\n"
    );
    assert_eq!(archived.task.status, TaskStatus::Archived);
    assert_eq!(
        Store::open(&home)
            .unwrap()
            .allocate(&Ports::default(), None)
            .unwrap(),
        3000
    );
    let third = create(&repo, &home, "another");
    assert_eq!(third.task.port, 3000);
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &first.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(restored.task.port, 3020);
    let restored_path = Path::new(&restored.task.path);
    assert_eq!(
        std::fs::read_to_string(restored_path.join("README.md")).unwrap(),
        "dirty work\n"
    );
    assert_eq!(
        std::fs::read_to_string(restored_path.join("new.txt")).unwrap(),
        "untracked work\n"
    );
    assert_eq!(
        git_in(restored_path, &["show", "HEAD:README.md"]),
        "committed work\n"
    );
    assert!(git_in(restored_path, &["status", "--porcelain"]).contains("?? new.txt"));
    assert!(
        tasks::disk_usage(
            &repo.registry,
            &repo.path(),
            &first.task.id,
            &repo.ws,
            &home
        )
        .unwrap()
        .bytes
            > 0
    );
}

#[test]
fn clean_archive_always_snapshots_and_restore_keeps_free_ports() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "clean");
    let archive = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        false,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(archive.removal.removed);
    assert!(!archive.snapshot.reference.is_empty());
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        Some(&archive.snapshot.reference),
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(restored.task.port, task.task.port);
}

#[test]
fn ports_are_global_and_task_ownership_is_checked() {
    let a = TestRepo::new();
    let b = TestRepo::new();
    let (_home, home) = scratch();
    let one = create(&a, &home, "one");
    let two = create(&b, &home, "two");
    assert_ne!(one.task.port, two.task.port);
    assert!(tasks::archive(&b.registry, &b.path(), &one.task.id, true, &b.ws, &home).is_err());
}

#[test]
fn branch_and_fetched_origin_bases() {
    let repo = TestRepo::new();
    let remote = TestRepo::new();
    let (_home, home) = scratch();
    repo.git(&["branch", "starting"]);
    repo.git(&["remote", "add", "origin", &remote.path()]);
    remote.write("remote.txt", "remote\n");
    let remote_head = remote.commit_all("remote change");
    let from_remote = tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: "remote".into(),
            base: Some(TaskBase::Origin {
                branch: "main".into(),
            }),
        },
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(
        git_in(Path::new(&from_remote.task.path), &["rev-parse", "HEAD"]).trim(),
        remote_head
    );
    let from_branch = tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: "branch".into(),
            base: Some(TaskBase::Branch {
                name: "starting".into(),
            }),
        },
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(!Path::new(&from_branch.task.path)
        .join("remote.txt")
        .exists());
}

#[cfg(unix)]
#[test]
fn symlink_escapes_are_rejected_and_usage_does_not_follow_links() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let (_outside, outside) = scratch();
    std::fs::write(outside.join("huge"), vec![0u8; 100_000]).unwrap();
    std::os::unix::fs::symlink(&outside, repo.root.join("escape")).unwrap();
    repo.write(
        ".terax/project.toml",
        "[worktree]\nshared = ['escape/huge']",
    );
    assert!(tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: "escape".into(),
            base: None
        },
        &repo.ws,
        &home
    )
    .is_err());
    let usage = tasks::measure(&repo.root, 100_000, Duration::from_secs(1));
    assert!(usage.bytes < 100_000);
    assert!(tasks::measure(&repo.root, 1, Duration::from_secs(1)).truncated);
    std::fs::remove_file(repo.root.join(".terax/project.toml")).unwrap();
    std::os::unix::fs::symlink(outside.join("huge"), repo.root.join(".terax/project.toml"))
        .unwrap();
    assert!(project_config::read(&repo.registry, &repo.path(), &repo.ws).is_err());
    let config = project_config::WorktreeConfig {
        dir: format!("{}/{{project}}/{{task}}", home.display()),
        ..Default::default()
    };
    let project = super::refs::slugify(&repo.root.file_name().unwrap().to_string_lossy(), 40);
    std::os::unix::fs::symlink(&outside, home.join(project)).unwrap();
    assert!(project_config::location(
        &config,
        &std::fs::canonicalize(&repo.root).unwrap(),
        &home,
        "task"
    )
    .is_err());
}

#[test]
fn archive_resnapshots_after_script_and_restores_selected_ref() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "snapshots");
    let path = Path::new(&task.task.path);
    std::fs::write(path.join("README.md"), "before script\n").unwrap();
    let before =
        tasks::prepare_archive(&repo.registry, &repo.path(), &task.task.id, &repo.ws, &home)
            .unwrap();
    std::fs::remove_file(path.join("README.md")).unwrap();
    std::fs::write(path.join("binary"), [0, 255, 0, 128]).unwrap();
    let after = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_ne!(before.snapshot.reference, after.snapshot.reference);
    assert!(tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        Some("HEAD"),
        &repo.ws,
        &home
    )
    .is_err());
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(!Path::new(&restored.task.path).join("README.md").exists());
    assert_eq!(
        std::fs::read(Path::new(&restored.task.path).join("binary")).unwrap(),
        [0, 255, 0, 128]
    );
    tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    let earlier = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        Some(&before.snapshot.reference),
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(Path::new(&earlier.task.path).join("README.md")).unwrap(),
        "before script\n"
    );
    assert!(!Path::new(&earlier.task.path).join("binary").exists());
}

#[test]
fn include_and_shared_never_replace_checked_out_files() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(".env", "tracked base\n");
    repo.write("cache/file", "tracked cache\n");
    repo.commit_all("tracked destination");
    repo.git(&["branch", "with-files"]);
    repo.git(&["rm", "-r", ".env", "cache"]);
    repo.write(".gitignore", ".env\ncache/\n");
    repo.write(".terax/project.toml", "[worktree]\nshared = ['cache']\n");
    repo.commit_all("ignore files");
    repo.write(".env", "local source\n");
    repo.write("cache/file", "local cache\n");
    let task = tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: "existing".into(),
            base: Some(TaskBase::Branch {
                name: "with-files".into(),
            }),
        },
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(Path::new(&task.task.path).join(".env")).unwrap(),
        "tracked base\n"
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&task.task.path).join("cache/file")).unwrap(),
        "tracked cache\n"
    );
    assert_eq!(task.skipped.len(), 2);
}

#[cfg(unix)]
#[test]
fn task_creation_does_not_execute_checkout_hooks() {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(
        ".git/hooks/post-checkout",
        "#!/bin/sh\nprintf ran > hook-ran\n",
    );
    std::fs::set_permissions(
        repo.root.join(".git/hooks/post-checkout"),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let task = create(&repo, &home, "no-hooks");
    assert!(!repo.root.join("hook-ran").exists());
    assert!(!Path::new(&task.task.path).join("hook-ran").exists());
}

#[test]
fn invalid_config_and_corrupt_state_fail_before_worktree_creation() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    for config in [
        "[worktree]\ninclude = ['file:stream']",
        "[worktree]\ninclude = ['[invalid']",
        "[worktree]\nshared = ['.git./config']",
        "[worktree]\ndir = '~/tasks/{task}:stream'",
    ] {
        assert!(project_config::parse(config).is_err());
    }
    std::fs::create_dir(home.join(".terax")).unwrap();
    std::fs::write(home.join(".terax/task-worktrees.json"), "not json").unwrap();
    assert!(tasks::create(
        &repo.registry,
        &repo.path(),
        &TaskCreateRequest {
            name: "bad".into(),
            base: None
        },
        &repo.ws,
        &home
    )
    .is_err());
    assert!(!home.join(".terax/worktrees").exists());
    assert!(!repo.git(&["branch", "--list", "terax/*"]).contains("bad"));
}

#[test]
fn concurrent_creation_serializes_port_and_name_claims() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let barrier = std::sync::Barrier::new(2);
    let (a, b) = std::thread::scope(|scope| {
        let one = scope.spawn(|| {
            barrier.wait();
            create(&repo, &home, "same")
        });
        let two = scope.spawn(|| {
            barrier.wait();
            create(&repo, &home, "same")
        });
        (one.join().unwrap(), two.join().unwrap())
    });
    assert_ne!(a.task.path, b.task.path);
    assert_ne!(a.task.branch, b.task.branch);
    assert_ne!(a.task.port, b.task.port);
}

#[test]
fn assume_unchanged_edits_are_refused_then_captured_without_changing_the_index() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "index flags");
    let path = Path::new(&task.task.path);
    git_in(path, &["update-index", "--assume-unchanged", "README.md"]);
    std::fs::write(path.join("README.md"), "hidden edit that must survive\n").unwrap();
    assert!(git_in(path, &["status", "--porcelain"]).is_empty());
    let refused = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        false,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(!refused.removal.removed);
    assert!(refused
        .removal
        .blockers
        .contains(&super::worktree::RemoveBlocker::Dirty));
    assert!(git_in(path, &["ls-files", "-v", "README.md"]).starts_with('h'));
    let archive = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(
        repo.git(&["show", &format!("{}:README.md", archive.snapshot.reference)]),
        "hidden edit that must survive\n"
    );
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(Path::new(&restored.task.path).join("README.md")).unwrap(),
        "hidden edit that must survive\n"
    );
}

#[test]
fn skip_worktree_entries_refuse_archive_even_with_force() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "sparse");
    let path = Path::new(&task.task.path);
    git_in(path, &["update-index", "--skip-worktree", "README.md"]);
    let error = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap_err();
    assert!(error.to_string().contains("skip-worktree"));
    assert!(path.exists());
    assert!(git_in(path, &["ls-files", "-v", "README.md"]).starts_with('S'));
}

#[test]
fn initialized_submodules_refuse_archive_even_with_force() {
    let repo = TestRepo::new();
    let child = TestRepo::new();
    let (_home, home) = scratch();
    repo.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        &child.path(),
        "child",
    ]);
    repo.commit_all("submodule");
    let task = create(&repo, &home, "submodule");
    let path = Path::new(&task.task.path);
    git_in(
        path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "update",
            "--init",
        ],
    );
    std::fs::write(path.join("child/scratch"), "uncaptured data").unwrap();
    let error = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap_err();
    assert!(error.to_string().contains("submodule child"));
    assert_eq!(
        std::fs::read_to_string(path.join("child/scratch")).unwrap(),
        "uncaptured data"
    );
}

#[test]
fn restore_recovers_an_archive_interrupted_after_removal() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    for status in [TaskStatus::Active, TaskStatus::Archiving] {
        let task = create(&repo, &home, "interrupted");
        std::fs::write(
            Path::new(&task.task.path).join("README.md"),
            "saved before removal\n",
        )
        .unwrap();
        let prepared =
            tasks::prepare_archive(&repo.registry, &repo.path(), &task.task.id, &repo.ws, &home)
                .unwrap();
        let mut record = prepared.task;
        record.status = status;
        Store::open(&home).unwrap().put(record).unwrap();
        assert!(
            super::worktree::remove(
                &repo.registry,
                &repo.path(),
                &task.task.path,
                true,
                &repo.ws
            )
            .unwrap()
            .removed
        );
        let restored = tasks::restore(
            &repo.registry,
            &repo.path(),
            &task.task.id,
            None,
            &repo.ws,
            &home,
        )
        .unwrap();
        assert_eq!(restored.task.port, task.task.port);
        assert_eq!(restored.task.status, TaskStatus::Active);
        assert_eq!(
            std::fs::read_to_string(Path::new(&restored.task.path).join("README.md")).unwrap(),
            "saved before removal\n"
        );
    }
}

#[test]
fn branch_slugs_accept_file_names_and_dot_runs() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    assert_eq!(
        create(&repo, &home, "Update Cargo.lock").task.branch,
        "terax/update-cargo-lock"
    );
    assert_eq!(
        create(&repo, &home, "Fix foo..bar").task.branch,
        "terax/fix-foo-bar"
    );
}

#[test]
fn operation_locks_do_not_block_metadata_or_other_repositories() {
    let a = TestRepo::new();
    let b = TestRepo::new();
    let (_home, home) = scratch();
    let first = create(&a, &home, "one");
    let repo = super::plumbing::open_worktree(&a.registry, &a.path(), &a.ws).unwrap();
    let _operation = super::task_state::lock_operation(&repo).unwrap();
    assert_eq!(
        tasks::list(&a.registry, &a.path(), &a.ws, &home)
            .unwrap()
            .len(),
        1
    );
    assert!(
        tasks::disk_usage(&a.registry, &a.path(), &first.task.id, &a.ws, &home)
            .unwrap()
            .bytes
            > 0
    );
    assert_ne!(create(&b, &home, "two").task.port, first.task.port);
}

#[test]
fn only_windows_link_privilege_errors_are_skippable() {
    let denied = std::io::Error::from_raw_os_error(1314);
    assert!(tasks::link_privilege_missing(&denied, true));
    assert!(!tasks::link_privilege_missing(&denied, false));
    assert!(!tasks::link_privilege_missing(
        &std::io::Error::from_raw_os_error(5),
        true
    ));
}

#[cfg(unix)]
#[test]
fn includes_beyond_symlinks_are_skipped_without_losing_other_files() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(".gitignore", ".env\nactual/\n");
    repo.write(
        ".terax/project.toml",
        "[worktree]\ninclude = ['linked/.env', '.env']\nshared = []\n",
    );
    repo.commit_all("configuration");
    repo.write(".env", "copy this\n");
    repo.write("actual/.env", "do not follow\n");
    std::os::unix::fs::symlink(repo.root.join("actual"), repo.root.join("linked")).unwrap();
    let task = create(&repo, &home, "include links");
    assert_eq!(task.copied, [".env"]);
    assert!(task
        .skipped
        .iter()
        .any(|s| s.path == "linked/.env" && s.reason == "symlink"));
    assert!(!Path::new(&task.task.path).join("linked").exists());
}

#[test]
fn clean_shared_directory_links_do_not_require_force_and_are_recreated() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(".gitignore", "node_modules/\n");
    repo.write(
        ".terax/project.toml",
        "[worktree]\nshared = ['node_modules']\n",
    );
    repo.commit_all("shared dependencies");
    repo.write("node_modules/cache", "keep source\n");
    let task = create(&repo, &home, "clean shared");
    let linked = assert_shared_outcome(&task, "node_modules");
    let prepared =
        tasks::prepare_archive(&repo.registry, &repo.path(), &task.task.id, &repo.ws, &home)
            .unwrap();
    assert!(prepared.removal.blockers.is_empty());
    assert!(!repo
        .git(&["ls-tree", "--name-only", &prepared.snapshot.reference])
        .lines()
        .any(|line| line == "node_modules"));
    repo.git(&["worktree", "lock", &task.task.path]);
    let locked = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(!locked.removal.removed);
    assert_eq!(assert_shared_outcome(&task, "node_modules"), linked);
    assert!(locked.shared_restore_failures.is_empty());
    repo.git(&["worktree", "unlock", &task.task.path]);
    let archived = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        false,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(archived.removal.removed);
    assert_eq!(repo.read("node_modules/cache"), "keep source\n");
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_eq!(restored.task.branch, task.task.branch);
    assert_shared_outcome(&restored, "node_modules");
    assert!(
        tasks::archive(
            &repo.registry,
            &repo.path(),
            &task.task.id,
            false,
            &repo.ws,
            &home
        )
        .unwrap()
        .removal
        .removed
    );
}

#[test]
fn skipped_user_files_remain_unmanaged_across_restore() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write("shared.txt", "tracked content\n");
    repo.write(
        ".terax/project.toml",
        "[worktree]\nshared = ['shared.txt']\n",
    );
    repo.commit_all("tracked shared path");
    let task = create(&repo, &home, "user file");
    assert!(task.task.shared_links.is_empty());
    std::fs::write(Path::new(&task.task.path).join("shared.txt"), "user edit\n").unwrap();
    assert!(
        !tasks::archive(
            &repo.registry,
            &repo.path(),
            &task.task.id,
            false,
            &repo.ws,
            &home
        )
        .unwrap()
        .removal
        .removed
    );
    tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap();
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert!(restored.task.shared_links.is_empty());
    assert_eq!(
        std::fs::read_to_string(Path::new(&restored.task.path).join("shared.txt")).unwrap(),
        "user edit\n"
    );
}

#[test]
fn changed_task_branches_are_preserved_when_restoring() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "branch preservation");
    tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        false,
        &repo.ws,
        &home,
    )
    .unwrap();
    repo.write("later", "another commit\n");
    let later = repo.commit_all("later");
    repo.git(&[
        "update-ref",
        &format!("refs/heads/{}", task.task.branch),
        &later,
    ]);
    let restored = tasks::restore(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        None,
        &repo.ws,
        &home,
    )
    .unwrap();
    assert_ne!(restored.task.branch, task.task.branch);
    assert_eq!(repo.git(&["rev-parse", &task.task.branch]).trim(), later);
    assert!(!Path::new(&restored.task.path).join("later").exists());
}

#[test]
fn nested_untracked_repositories_refuse_forced_archive() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    let task = create(&repo, &home, "nested repo");
    let nested = Path::new(&task.task.path).join("nested");
    std::fs::create_dir(&nested).unwrap();
    git_in(&nested, &["init", "-q"]);
    std::fs::write(nested.join("private"), "private history\n").unwrap();
    git_in(&nested, &["add", "."]);
    git_in(&nested, &["commit", "-qm", "nested commit"]);
    let error = tasks::archive(
        &repo.registry,
        &repo.path(),
        &task.task.id,
        true,
        &repo.ws,
        &home,
    )
    .unwrap_err();
    assert!(error.to_string().contains("submodule nested"));
    assert_eq!(
        std::fs::read_to_string(nested.join("private")).unwrap(),
        "private history\n"
    );
    assert!(nested.join(".git").is_dir());
}

#[cfg(unix)]
#[test]
fn archive_restores_later_links_and_reports_partial_failure_state() {
    let repo = TestRepo::new();
    let (_home, home) = scratch();
    repo.write(".gitignore", "first/\nsecond/\n");
    repo.write(
        ".terax/project.toml",
        "[worktree]\nshared = ['first/cache', 'second/cache']\n",
    );
    repo.commit_all("shared directories");
    repo.write("first/cache/file", "first\n");
    repo.write("second/cache/file", "second\n");
    let created = create(&repo, &home, "restoration errors");
    let prepared = tasks::prepare_archive(
        &repo.registry,
        &repo.path(),
        &created.task.id,
        &repo.ws,
        &home,
    )
    .unwrap();
    let snapshot = prepared.snapshot;
    let mut task = prepared.task;
    task.status = TaskStatus::Archiving;
    Store::open(&home).unwrap().put(task.clone()).unwrap();
    let mut refusal = prepared.removal;
    refusal
        .blockers
        .push(super::worktree::RemoveBlocker::Locked);
    let attempt = tasks::remove_with_shared(
        &task,
        &["first/cache".into(), "second/cache".into()],
        || {
            std::fs::remove_dir(Path::new(&task.path).join("first")).unwrap();
            std::fs::write(
                Path::new(&task.path).join("first"),
                "concurrent replacement",
            )
            .unwrap();
            Ok(refusal)
        },
    );
    let opened = super::plumbing::open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
    let outcome = tasks::complete_archive(
        &repo.registry,
        &opened,
        task,
        snapshot.clone(),
        attempt,
        &home,
    )
    .unwrap();
    assert_eq!(outcome.shared_restore_failures.len(), 1);
    assert_eq!(outcome.shared_restore_failures[0].path, "first/cache");
    assert!(outcome
        .removal
        .blockers
        .contains(&super::worktree::RemoveBlocker::Locked));
    assert!(
        std::fs::symlink_metadata(Path::new(&outcome.task.path).join("second/cache"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(outcome.task.status, TaskStatus::Active);
    assert_eq!(
        tasks::list(&repo.registry, &repo.path(), &repo.ws, &home).unwrap()[0].status,
        TaskStatus::Active
    );

    let mut task = outcome.task;
    task.status = TaskStatus::Archiving;
    Store::open(&home).unwrap().put(task.clone()).unwrap();
    let failure = || {
        (
            Err(super::errors::GitError::command(
                "git remove",
                "original failure",
            )),
            vec![super::checkpoint::Skipped {
                path: "first/cache".into(),
                reason: "restore failure".into(),
            }],
        )
    };
    let error = tasks::complete_archive(
        &repo.registry,
        &opened,
        task.clone(),
        snapshot.clone(),
        failure(),
        &home,
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("original failure"));
    assert!(error.contains("restore failure"));
    assert_eq!(
        tasks::list(&repo.registry, &repo.path(), &repo.ws, &home).unwrap()[0].status,
        TaskStatus::Archiving
    );
    assert!(
        super::worktree::remove(&repo.registry, &repo.path(), &task.path, true, &repo.ws)
            .unwrap()
            .removed
    );
    assert!(
        tasks::complete_archive(&repo.registry, &opened, task, snapshot, failure(), &home).is_err()
    );
    assert_eq!(
        tasks::list(&repo.registry, &repo.path(), &repo.ws, &home).unwrap()[0].status,
        TaskStatus::Archived
    );
    assert_eq!(
        Store::open(&home)
            .unwrap()
            .allocate(&Ports::default(), None)
            .unwrap(),
        3000
    );
}
