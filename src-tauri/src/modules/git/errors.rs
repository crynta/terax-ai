use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git is not available on PATH. Install Git and retry.")]
    NotInstalled,
    #[error("git {found} is too old; Terax needs git {required} or newer.")]
    TooOld {
        found: String,
        required: &'static str,
    },
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("path is outside the authorized workspace: {}", .0.display())]
    PathOutsideWorkspace(PathBuf),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("file too large to diff ({size} bytes, max {max}): {}", path.display())]
    FileTooLarge { path: PathBuf, size: u64, max: u64 },
    #[error("refusing to follow symlink: {}", .0.display())]
    SymlinkRejected(PathBuf),
    #[error("no upstream configured. Run `git push -u <remote> <branch>` in the terminal first.")]
    NoUpstream,
    #[error("authentication required: {0}. Configure a credential helper or SSH key.")]
    AuthRequired(String),
    #[error(
        "host key verification failed. Run the command once in the terminal to trust the host."
    )]
    HostKeyUnverified,
    #[error("{0} timed out")]
    TimedOut(&'static str),
    #[error("commit message cannot be empty")]
    EmptyCommitMessage,
    #[error("{context}: {detail}")]
    CommandFailed {
        context: &'static str,
        detail: String,
    },
    #[error("failed to spawn git: {0}")]
    Spawn(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl GitError {
    pub fn command(context: &'static str, detail: impl Into<String>) -> Self {
        GitError::CommandFailed {
            context,
            detail: detail.into(),
        }
    }
}

impl From<GitError> for String {
    fn from(value: GitError) -> Self {
        value.to_string()
    }
}

pub type Result<T> = std::result::Result<T, GitError>;
