use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum GitError {
    GitNotInstalled,

    RepoNotFound(String),

    CommandTimedOut,

    SpawnFailed(String),

    CommandFailed(String),

    Io(std::io::Error),
}

#[allow(dead_code)]
pub type Result<T> = std::result::Result<T, GitError>;

impl Display for GitError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::GitNotInstalled => write!(f, "git is not available"),
            GitError::RepoNotFound(path) => write!(f, "path is not a directory: {path}"),
            GitError::CommandTimedOut => write!(f, "git command timed out"),
            GitError::SpawnFailed(err) => write!(f, "failed to spawn git process: {err}"),
            GitError::CommandFailed(err) => write!(f, "{err}"),
            GitError::Io(err) => write!(f, "Input/Output error: {err}"),
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