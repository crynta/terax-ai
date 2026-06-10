#![allow(dead_code)]

pub mod env_guard;

use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use terax_lib::modules::fs::to_canon;
use terax_lib::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub struct GitRepoFixture {
    pub registry: WorkspaceRegistry,
    pub workspace: WorkspaceEnv,
    pub repo_path: PathBuf,
    _tmp: TempDir,
}

impl GitRepoFixture {
    pub fn new() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let canonical = std::fs::canonicalize(tmp.path()).expect("canonicalize");
        let registry = WorkspaceRegistry::default();
        registry.authorize(&canonical).expect("authorize");

        run_git_in(&canonical, &["init", "-q"]);
        run_git_in(&canonical, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_git_in(&canonical, &["config", "user.email", "test@terax.local"]);
        run_git_in(&canonical, &["config", "user.name", "Terax Test"]);
        run_git_in(&canonical, &["config", "commit.gpgsign", "false"]);
        run_git_in(&canonical, &["config", "core.autocrlf", "false"]);

        Self {
            registry,
            workspace: WorkspaceEnv::Local,
            repo_path: canonical,
            _tmp: tmp,
        }
    }

    pub fn repo_str(&self) -> String {
        to_canon(&self.repo_path)
    }

    pub fn run_git(&self, args: &[&str]) {
        run_git_in(&self.repo_path, args);
    }

    pub fn write_file(&self, rel: &str, content: &str) {
        let p = self.repo_path.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir parents");
        }
        std::fs::write(&p, content).expect("write file");
    }
}

fn run_git_in(cwd: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git on PATH");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub struct FsFixture {
    pub root: PathBuf,
    _tmp: TempDir,
}

impl FsFixture {
    pub fn new() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let root = std::fs::canonicalize(tmp.path()).expect("canonicalize");
        Self { root, _tmp: tmp }
    }

    pub fn root_str(&self) -> String {
        to_canon(&self.root)
    }

    pub fn write(&self, rel: &str, content: &str) {
        let p = self.root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir parents");
        }
        std::fs::write(&p, content).expect("write file");
    }

    pub fn mkdir(&self, rel: &str) {
        std::fs::create_dir_all(self.root.join(rel)).expect("mkdir");
    }
}
