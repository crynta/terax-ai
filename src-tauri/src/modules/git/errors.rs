use std::fmt::{Display, Formatter};
use std::path::PathBuf;

#[derive(Debug)]
pub enum GitError {
    NotInstalled,
    TooOld {
        found: String,
        required: &'static str,
    },
    NotADirectory(String),
    PathOutsideWorkspace(PathBuf),
    InvalidPath(String),
    FileTooLarge {
        path: PathBuf,
        size: u64,
        max: u64,
    },
    SymlinkRejected(PathBuf),
    NoUpstream,
    AuthRequired(String),
    HostKeyUnverified,
    TimedOut(&'static str),
    EmptyCommitMessage,
    CommandFailed {
        context: &'static str,
        detail: String,
    },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_builds_command_failed() {
        let err = GitError::command("git status", "fatal: not a repo");
        match &err {
            GitError::CommandFailed { context, detail } => {
                assert_eq!(*context, "git status");
                assert_eq!(detail, "fatal: not a repo");
            }
            other => panic!("expected CommandFailed, got {other:?}"),
        }
        assert_eq!(err.to_string(), "git status: fatal: not a repo");
    }

    #[test]
    fn command_failed_without_detail_omits_the_colon() {
        let err = GitError::command("git status", "");
        assert_eq!(err.to_string(), "git status");
    }

    #[test]
    fn too_old_names_found_and_required_versions() {
        let msg = GitError::TooOld {
            found: "2.20.0".into(),
            required: "2.23",
        }
        .to_string();
        assert!(msg.contains("2.20.0"));
        assert!(msg.contains("2.23"));
    }

    #[test]
    fn file_too_large_reports_size_max_and_path() {
        let msg = GitError::FileTooLarge {
            path: PathBuf::from("/repo/big.bin"),
            size: 999,
            max: 100,
        }
        .to_string();
        assert!(msg.contains("999"));
        assert!(msg.contains("100"));
        assert!(msg.contains("big.bin"));
    }

    #[test]
    fn timed_out_includes_the_operation() {
        assert_eq!(
            GitError::TimedOut("git fetch").to_string(),
            "git fetch timed out"
        );
    }

    #[test]
    fn empty_commit_message_is_fixed() {
        assert_eq!(
            GitError::EmptyCommitMessage.to_string(),
            "commit message cannot be empty"
        );
    }

    #[test]
    fn converts_into_string_via_display() {
        let s: String = GitError::NoUpstream.into();
        assert_eq!(s, GitError::NoUpstream.to_string());
    }
}
