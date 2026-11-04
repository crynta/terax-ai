//! Branch creation and renaming, upstream tracking information and the remote
//! a push should target.

use serde::Serialize;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::plumbing::{
    branch_exists, check_branch_name, head_commit_opt, open_worktree, os_args, resolve_commit, run,
    run_ok, stdout_text,
};
use crate::modules::git::refs;
use crate::modules::git::utils::ResolvedGitDirectory;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreated {
    pub name: String,
    pub commit: String,
}

pub fn create(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    base: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<BranchCreated> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    check_branch_name(&repo, name)?;
    if branch_exists(&repo, name)? {
        return Err(GitError::command(
            "git branch",
            format!("branch {name} already exists"),
        ));
    }
    let start = match base.filter(|b| !b.is_empty()) {
        Some(base) => resolve_commit(&repo, base)?,
        None => head_commit_opt(&repo)?
            .ok_or_else(|| GitError::command("git branch", "the repository has no commits yet"))?,
    };
    run_ok(
        &repo,
        os_args(["branch", "--no-track", name, start.as_str()]),
        "git branch failed",
    )?;
    Ok(BranchCreated {
        name: name.to_string(),
        commit: start,
    })
}

pub fn rename(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    old: &str,
    new: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    check_branch_name(&repo, old)?;
    check_branch_name(&repo, new)?;
    if !branch_exists(&repo, old)? {
        return Err(GitError::command(
            "git branch -m",
            format!("branch {old} does not exist"),
        ));
    }
    if old != new && branch_exists(&repo, new)? {
        return Err(GitError::command(
            "git branch -m",
            format!("branch {new} already exists"),
        ));
    }
    run_ok(
        &repo,
        os_args(["branch", "-m", old, new]),
        "git branch -m failed",
    )?;
    Ok(())
}

/// `ahead\tbehind` from `git rev-list --left-right --count A...B`.
pub fn parse_left_right_count(text: &str) -> Option<(u32, u32)> {
    let mut parts = text.split_whitespace();
    let ahead = parts.next()?.parse().ok()?;
    let behind = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((ahead, behind))
}

/// Tracking ref and display name for a branch's configured upstream. A remote
/// of `.` means the upstream is another local branch.
pub fn upstream_refs(remote: &str, merge: &str) -> Option<(String, String)> {
    let branch = merge.strip_prefix("refs/heads/")?;
    if branch.is_empty() {
        return None;
    }
    if remote == "." {
        Some((format!("refs/heads/{branch}"), branch.to_string()))
    } else {
        Some((
            format!("refs/remotes/{remote}/{branch}"),
            format!("{remote}/{branch}"),
        ))
    }
}

/// The remote a first push should go to: `origin` when it exists, otherwise the
/// only remote, otherwise none.
pub fn pick_remote(remotes: &[String]) -> Option<String> {
    if remotes.iter().any(|r| r == "origin") {
        return Some("origin".to_string());
    }
    match remotes {
        [only] => Some(only.clone()),
        _ => None,
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamInfo {
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub remote: Option<String>,
    pub remote_branch: Option<String>,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// An upstream is configured but its remote-tracking ref no longer exists.
    pub gone: bool,
    pub has_remotes: bool,
    /// Where `git_push` with `setUpstream` would push a branch without one.
    pub suggested_remote: Option<String>,
}

fn config_value(repo: &ResolvedGitDirectory, key: &str) -> Result<Option<String>> {
    let output = run(repo, os_args(["config", "--get", key]))?;
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let value = stdout_text(&output);
    Ok((!value.is_empty()).then_some(value))
}

pub fn list_remotes(repo: &ResolvedGitDirectory) -> Result<Vec<String>> {
    let output = run_ok(repo, os_args(["remote"]), "git remote failed")?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|r| refs::is_plausible_ref_name(r))
        .map(str::to_string)
        .collect())
}

pub fn current_branch(repo: &ResolvedGitDirectory) -> Result<Option<String>> {
    let output = run(repo, os_args(["symbolic-ref", "-q", "--short", "HEAD"]))?;
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let name = stdout_text(&output);
    Ok((!name.is_empty()).then_some(name))
}

pub fn upstream_info(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<UpstreamInfo> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let remotes = list_remotes(&repo)?;
    let mut info = UpstreamInfo {
        branch: None,
        detached: false,
        upstream: None,
        remote: None,
        remote_branch: None,
        remote_url: None,
        ahead: 0,
        behind: 0,
        gone: false,
        has_remotes: !remotes.is_empty(),
        suggested_remote: pick_remote(&remotes),
    };
    let Some(branch) = current_branch(&repo)? else {
        info.detached = true;
        return Ok(info);
    };
    info.branch = Some(branch.clone());

    let remote = config_value(&repo, &format!("branch.{branch}.remote"))?;
    let merge = config_value(&repo, &format!("branch.{branch}.merge"))?;
    let (Some(remote), Some(merge)) = (remote, merge) else {
        return Ok(info);
    };
    let Some((tracking_ref, display)) = upstream_refs(&remote, &merge) else {
        return Ok(info);
    };
    info.upstream = Some(display);
    info.remote_branch = merge.strip_prefix("refs/heads/").map(str::to_string);
    if remote != "." && refs::is_plausible_ref_name(&remote) {
        info.remote_url = config_value(&repo, &format!("remote.{remote}.url"))?;
    }
    info.remote = Some(remote);

    let exists = run(
        &repo,
        os_args(["rev-parse", "--verify", "--quiet", tracking_ref.as_str()]),
    )?;
    if exists.exit_code != Some(0) {
        info.gone = true;
        return Ok(info);
    }
    if head_commit_opt(&repo)?.is_some() {
        let counted = run(
            &repo,
            os_args([
                "rev-list",
                "--left-right",
                "--count",
                &format!("HEAD...{tracking_ref}"),
            ]),
        )?;
        if counted.exit_code == Some(0) {
            if let Some((ahead, behind)) = parse_left_right_count(&stdout_text(&counted)) {
                info.ahead = ahead;
                info.behind = behind;
            }
        }
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn left_right_counts() {
        assert_eq!(parse_left_right_count("3\t1"), Some((3, 1)));
        assert_eq!(parse_left_right_count("0 0\n"), Some((0, 0)));
        assert_eq!(parse_left_right_count(""), None);
        assert_eq!(parse_left_right_count("1"), None);
        assert_eq!(parse_left_right_count("1 2 3"), None);
        assert_eq!(parse_left_right_count("a b"), None);
    }

    #[test]
    fn upstream_refs_for_remote_and_local_tracking() {
        assert_eq!(
            upstream_refs("origin", "refs/heads/feature/x"),
            Some((
                "refs/remotes/origin/feature/x".into(),
                "origin/feature/x".into()
            ))
        );
        assert_eq!(
            upstream_refs(".", "refs/heads/main"),
            Some(("refs/heads/main".into(), "main".into()))
        );
        assert_eq!(upstream_refs("origin", "refs/tags/v1"), None);
        assert_eq!(upstream_refs("origin", "refs/heads/"), None);
    }

    #[test]
    fn remote_choice_prefers_origin_then_a_sole_remote() {
        let names = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            pick_remote(&names(&["fork", "origin"])).as_deref(),
            Some("origin")
        );
        assert_eq!(pick_remote(&names(&["fork"])).as_deref(), Some("fork"));
        assert_eq!(pick_remote(&names(&["a", "b"])), None);
        assert_eq!(pick_remote(&[]), None);
    }
}
