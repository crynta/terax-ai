//! Real temporary repositories for the integration tests. The process-wide git
//! environment is pinned once so a developer's global config (signing, diff
//! settings, templates) can never change a result.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Once;

use crate::modules::git::utils::plain_path;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

static ENV: Once = Once::new();

fn pin_environment() {
    ENV.call_once(|| {
        let empty =
            std::env::temp_dir().join(format!("terax-test-gitconfig-{}", std::process::id()));
        std::fs::write(&empty, "").expect("write empty git config");
        std::env::set_var("GIT_CONFIG_GLOBAL", &empty);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("GIT_AUTHOR_NAME", "Test");
        std::env::set_var("GIT_AUTHOR_EMAIL", "test@example.com");
        std::env::set_var("GIT_COMMITTER_NAME", "Test");
        std::env::set_var("GIT_COMMITTER_EMAIL", "test@example.com");
    });
}

pub struct TestRepo {
    _dir: tempfile::TempDir,
    /// Canonical and, on Windows, without the `\\?\` prefix: a path git is given
    /// as a location (clone URL, remote, worktree) must not be verbatim.
    pub root: PathBuf,
    pub registry: WorkspaceRegistry,
    pub ws: WorkspaceEnv,
}

/// The canonical form of `path` as git prints and accepts it.
pub fn canonical_plain(path: &Path) -> PathBuf {
    plain_path(&std::fs::canonicalize(path).expect("canonicalize"))
}

/// A scratch directory outside any repository, canonical and git-safe (see
/// `TestRepo::root`).
pub fn scratch() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = canonical_plain(dir.path());
    (dir, path)
}

/// Whether the registry covers `path`. The registry holds canonical paths, as
/// every product caller canonicalizes first; a test path spelled differently
/// (forward slashes, 8.3 names) must be canonicalized the same way.
pub fn authorized(registry: &WorkspaceRegistry, path: &Path) -> bool {
    // The deepest existing ancestor is canonicalized and the rest re-attached,
    // so a path that does not exist yet is judged like one that does.
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cursor = path;
    let mut canonical = loop {
        if let Ok(found) = std::fs::canonicalize(cursor) {
            break found;
        }
        match (cursor.file_name(), cursor.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                cursor = parent;
            }
            _ => return registry.is_authorized(path),
        }
    };
    for name in tail.iter().rev() {
        canonical.push(name);
    }
    registry.is_authorized(&canonical)
}

/// `git <args>` in `dir`, with the repository-location variables a hook or a
/// shell may have exported removed (the same set the product strips): without
/// that, a test run from a git hook would init, stage and commit its fixtures in
/// the developer's real repository.
pub fn git_command(dir: &Path, args: &[&str]) -> Command {
    pin_environment();
    let mut command = Command::new("git");
    command.args(args).current_dir(dir);
    for name in crate::modules::git::process::inherited_git_env_to_strip(
        std::env::vars_os().map(|(key, _)| key),
    ) {
        command.env_remove(name);
    }
    command
}

pub fn git_in(dir: &Path, args: &[&str]) -> String {
    let output = git_command(dir, args).output().expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

impl TestRepo {
    /// An initialized repository on `main` with no commits.
    pub fn unborn() -> Self {
        pin_environment();
        let dir = tempfile::tempdir().expect("tempdir");
        let root = canonical_plain(dir.path());
        git_in(&root, &["init", "-q", "-b", "main"]);
        git_in(&root, &["config", "commit.gpgsign", "false"]);
        git_in(&root, &["config", "core.autocrlf", "false"]);
        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).expect("authorize");
        Self {
            _dir: dir,
            root,
            registry,
            ws: WorkspaceEnv::Local,
        }
    }

    /// A repository with one commit containing `README.md`.
    pub fn new() -> Self {
        let repo = Self::unborn();
        repo.write("README.md", "# demo\n");
        repo.commit_all("initial");
        repo
    }

    pub fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    pub fn git(&self, args: &[&str]) -> String {
        git_in(&self.root, args)
    }

    pub fn write(&self, rel: &str, content: &str) {
        self.write_bytes(rel, content.as_bytes());
    }

    pub fn write_bytes(&self, rel: &str, content: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create dirs");
        }
        std::fs::write(path, content).expect("write file");
    }

    pub fn read(&self, rel: &str) -> String {
        String::from_utf8_lossy(&std::fs::read(self.root.join(rel)).expect("read file"))
            .into_owned()
    }

    pub fn exists(&self, rel: &str) -> bool {
        std::fs::symlink_metadata(self.root.join(rel)).is_ok()
    }

    pub fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }

    /// Contents of `path` in the index.
    pub fn staged(&self, rel: &str) -> String {
        self.git(&["show", &format!(":{rel}")])
    }
}
