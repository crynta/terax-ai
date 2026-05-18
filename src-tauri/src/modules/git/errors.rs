use std::fmt::{Display, Formatter};
use std::path::PathBuf;

#[derive(Debug)]
pub enum GitError {
    NotInstalled,
    TooOld { found: String, required: &'static str },
    NotADirectory(String),
    PathOutsideWorkspace(PathBuf),
    InvalidPath(String),
    FileTooLarge { path: PathBuf, size: u64, max: u64 },
    SymlinkRejected(PathBuf),
    NoUpstream,
    AuthRequired(String),
    HostKeyUnverified,
    TimedOut(&'static str),
    EmptyCommitMessage,
    CommandFailed { context: &'static str, detail: String },
    Spawn(String),
    Io(std::io::Error),
}

impl GitError {
    pub fn command(context: &'static str, detail: impl Into<String>) -> Self {
        GitError::CommandFailed {
            context,
            detail: detail.into(),
        }
    }
}

impl Display for GitError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::NotInstalled => write!(
                f,
                "git is not available on PATH. Install Git and retry."
            ),
            GitError::TooOld { found, required } => write!(
                f,
                "git {found} is too old; Terax needs git {required} or newer.",
            ),
            GitError::NotADirectory(p) => write!(f, "not a directory: {p}"),
            GitError::PathOutsideWorkspace(p) => write!(
                f,
                "path is outside the authorized workspace: {}",
                p.display()
            ),
            GitError::InvalidPath(p) => write!(f, "invalid path: {p}"),
            GitError::FileTooLarge { path, size, max } => write!(
                f,
                "file too large to diff ({size} bytes, max {max}): {}",
                path.display()
            ),
            GitError::SymlinkRejected(p) => {
                write!(f, "refusing to follow symlink: {}", p.display())
            }
            GitError::NoUpstream => write!(
                f,
                "no upstream configured. Run `git push -u <remote> <branch>` in the terminal first."
            ),
            GitError::AuthRequired(detail) => write!(
                f,
                "authentication required: {detail}. Configure a credential helper or SSH key."
            ),
            GitError::HostKeyUnverified => write!(
                f,
                "host key verification failed. Run the command once in the terminal to trust the host."
            ),
            GitError::TimedOut(op) => write!(f, "{op} timed out"),
            GitError::EmptyCommitMessage => write!(f, "commit message cannot be empty"),
            GitError::CommandFailed { context, detail } => {
                if detail.is_empty() {
                    write!(f, "{context}")
                } else {
                    write!(f, "{context}: {detail}")
                }
            }
            GitError::Spawn(err) => write!(f, "failed to spawn git: {err}"),
            GitError::Io(err) => write!(f, "io error: {err}"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<std::io::Error> for GitError {
    fn from(value: std::io::Error) -> Self {
        GitError::Io(value)
    }
}

impl From<GitError> for String {
    fn from(value: GitError) -> Self {
        value.to_string()
    }
}

pub type Result<T> = std::result::Result<T, GitError>;
