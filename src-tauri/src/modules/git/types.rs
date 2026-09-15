use serde::Serialize;

pub(crate) const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub(crate) const NETWORK_TIMEOUT_SECS: u64 = 120;
pub(crate) const MAX_TIMEOUT_SECS: u64 = 180;
pub(crate) const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const MIN_GIT_VERSION: &str = "2.23";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub is_detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub status_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub truncated: bool,
    pub changed_files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPanelSnapshot {
    pub repo: Option<GitRepoInfo>,
    pub status: Option<GitStatusSnapshot>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardEntry {
    pub path: String,
    pub untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff_text: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContentResult {
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub fallback_patch: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit_sha: String,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_email: String,
    pub timestamp_secs: i64,
    pub parents: Vec<String>,
    pub subject: String,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub pushed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    pub kind: String, // "local" | "worktree"
    pub worktree_path: Option<String>,
    pub is_head: bool,
    pub is_detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchListResult {
    pub branches: Vec<GitBranchEntry>,
}

pub(crate) struct GitOutput {
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) timed_out: bool,
    pub(crate) truncated: bool,
}

pub(crate) enum TextSource {
    Missing,
    Binary,
    Text(String),
}

impl TextSource {
    pub(crate) fn into_text(self) -> String {
        match self {
            TextSource::Text(text) => text,
            TextSource::Missing | TextSource::Binary => String::new(),
        }
    }
}

#[cfg(test)]
mod serde_shape_tests {
    use super::*;

    #[test]
    fn repo_info_serializes_camel_case() {
        let info = GitRepoInfo {
            repo_root: "/repo".into(),
            branch: "main".into(),
            upstream: Some("origin/main".into()),
            is_detached: false,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "repoRoot": "/repo",
                "branch": "main",
                "upstream": "origin/main",
                "isDetached": false,
            })
        );
    }

    #[test]
    fn changed_file_serializes_all_fields_camel_case() {
        let file = GitChangedFile {
            path: "src/a.ts".into(),
            original_path: Some("src/old.ts".into()),
            index_status: "R".into(),
            worktree_status: " ".into(),
            staged: true,
            unstaged: false,
            untracked: false,
            status_label: "renamed".into(),
        };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "path": "src/a.ts",
                "originalPath": "src/old.ts",
                "indexStatus": "R",
                "worktreeStatus": " ",
                "staged": true,
                "unstaged": false,
                "untracked": false,
                "statusLabel": "renamed",
            })
        );
    }

    #[test]
    fn status_snapshot_nests_changed_files() {
        let snapshot = GitStatusSnapshot {
            repo_root: "/repo".into(),
            branch: "main".into(),
            upstream: None,
            ahead: 2,
            behind: 1,
            is_detached: true,
            truncated: false,
            changed_files: vec![],
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "repoRoot": "/repo",
                "branch": "main",
                "upstream": null,
                "ahead": 2,
                "behind": 1,
                "isDetached": true,
                "truncated": false,
                "changedFiles": [],
            })
        );
    }

    #[test]
    fn panel_snapshot_allows_null_repo_and_status() {
        let panel = GitPanelSnapshot {
            repo: None,
            status: None,
        };
        let json = serde_json::to_value(&panel).unwrap();
        assert_eq!(json, serde_json::json!({ "repo": null, "status": null }));
    }

    #[test]
    fn diff_content_result_keys_stay_camel_case() {
        let diff = GitDiffContentResult {
            original_content: "a".into(),
            modified_content: "b".into(),
            is_binary: false,
            fallback_patch: "".into(),
            truncated: true,
        };
        let json = serde_json::to_value(&diff).unwrap();
        for key in [
            "originalContent",
            "modifiedContent",
            "isBinary",
            "fallbackPatch",
            "truncated",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }

    #[test]
    fn commit_result_and_file_change_keep_their_contract() {
        let commit = GitCommitResult {
            commit_sha: "abc123".into(),
            summary: "msg".into(),
        };
        assert_eq!(
            serde_json::to_value(&commit).unwrap(),
            serde_json::json!({ "commitSha": "abc123", "summary": "msg" })
        );

        let change = GitCommitFileChange {
            path: "f.rs".into(),
            original_path: None,
            status: "M".into(),
            status_label: "modified".into(),
            added: 3,
            removed: 4,
            is_binary: false,
        };
        let json = serde_json::to_value(&change).unwrap();
        assert_eq!(json["originalPath"], serde_json::Value::Null);
        for key in ["path", "status", "statusLabel", "added", "removed", "isBinary"] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }

    #[test]
    fn log_entry_stats_use_camel_case_names() {
        let entry = GitLogEntry {
            sha: "deadbeef".into(),
            short_sha: "deadbee".into(),
            author: "A".into(),
            author_email: "a@example.com".into(),
            timestamp_secs: 1_700_000_000,
            parents: vec!["p0".into()],
            subject: "s".into(),
            files_changed: 2,
            insertions: 10,
            deletions: 5,
        };
        let json = serde_json::to_value(&entry).unwrap();
        for key in [
            "shortSha",
            "authorEmail",
            "timestampSecs",
            "filesChanged",
            "insertions",
            "deletions",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
        assert_eq!(json["parents"], serde_json::json!(["p0"]));
    }

    #[test]
    fn push_and_branch_results_serialize_as_named() {
        let push = GitPushResult {
            remote: Some("origin".into()),
            branch: None,
            pushed: true,
        };
        assert_eq!(
            serde_json::to_value(&push).unwrap(),
            serde_json::json!({ "remote": "origin", "branch": null, "pushed": true })
        );

        let branch = GitBranchEntry {
            name: "feature".into(),
            kind: "local".into(),
            worktree_path: None,
            is_head: false,
            is_detached: false,
        };
        let list = GitBranchListResult {
            branches: vec![branch],
        };
        assert_eq!(
            serde_json::to_value(&list).unwrap(),
            serde_json::json!({
                "branches": [{
                    "name": "feature",
                    "kind": "local",
                    "worktreePath": null,
                    "isHead": false,
                    "isDetached": false,
                }],
            })
        );
    }

    #[test]
    fn discard_entry_deserializes_from_camel_case_json() {
        let entry: DiscardEntry =
            serde_json::from_str(r#"{ "path": "x.txt", "untracked": true }"#).unwrap();
        assert_eq!(entry.path, "x.txt");
        assert!(entry.untracked);
    }
}
