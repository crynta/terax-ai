use std::path::Path;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;
use tauri::State;

use super::index::{FileIndexState, IndexKey, Packed};
use super::supersede::Supersede;
use super::{blocking, display_path};
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize, Clone)]
pub struct SearchHit {
    /// Absolute path of the matched file.
    pub path: String,
    /// Path relative to the search root, for display.
    pub rel: String,
    /// File name only.
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// True if the scan stopped early (entry budget or hit cap reached).
    pub truncated: bool,
    /// A newer query from the same caller replaced this one; `hits` is empty.
    pub cancelled: bool,
}

impl SearchResult {
    fn empty() -> Self {
        Self {
            hits: Vec::new(),
            truncated: false,
            cancelled: false,
        }
    }

    fn cancelled() -> Self {
        Self {
            cancelled: true,
            ..Self::empty()
        }
    }
}

/// Ranking checks for supersession this often; a full pass over 50k entries is
/// a few milliseconds, so this only matters for pathological roots.
const CANCEL_CHECK_EVERY: usize = 2048;
const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 1000;

/// Fuzzy file search over the cached file list of `root`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_search(
    index: State<'_, FileIndexState>,
    supersede: State<'_, Supersede>,
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
    request_key: Option<String>,
) -> Result<SearchResult, String> {
    let ticket = request_key.as_deref().map(|key| supersede.begin(key));
    let index = index.inner().clone();
    blocking(move || {
        let cancelled = || ticket.as_ref().is_some_and(|t| t.is_superseded());
        run_search(
            &index,
            root,
            query,
            limit,
            workspace,
            show_hidden,
            &cancelled,
        )
    })
    .await
}

pub fn run_search(
    index: &FileIndexState,
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
    cancelled: &dyn Fn() -> bool,
) -> Result<SearchResult, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchResult::empty());
    }
    let cap = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    if cancelled() {
        return Ok(SearchResult::cancelled());
    }

    let key = IndexKey {
        root: root_path.clone(),
        show_hidden: show_hidden.unwrap_or(false),
        max_depth: None,
    };
    let file_index = index.get_or_build(&key);
    let Some(ranked) = rank_fuzzy(&file_index.entries, q, cap, cancelled) else {
        return Ok(SearchResult::cancelled());
    };

    let hits = ranked
        .into_iter()
        .map(|i| {
            let (rel, is_dir) = file_index.entries.get(i);
            SearchHit {
                path: abs_path(rel, &root_path, &root, &workspace),
                rel: rel.to_string(),
                name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
                is_dir,
            }
        })
        .collect();
    Ok(SearchResult {
        hits,
        truncated: file_index.truncated,
        cancelled: false,
    })
}

fn abs_path(rel: &str, root_path: &Path, root_display: &str, workspace: &WorkspaceEnv) -> String {
    display_path(&root_path.join(rel), root_path, root_display, workspace)
}

/// Fuzzy-rank candidates against the query (path-aware, smart-case), returning
/// the indices of the top `cap`. Ties break toward shorter relative paths, then
/// walk order. `None` means the query was superseded while ranking.
fn rank_fuzzy(
    entries: &Packed,
    query: &str,
    cap: usize,
    cancelled: &dyn Fn() -> bool,
) -> Option<Vec<usize>> {
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut buf = Vec::new();

    let mut scored: Vec<(u32, usize)> = Vec::new();
    for (i, (rel, _)) in entries.iter().enumerate() {
        if i % CANCEL_CHECK_EVERY == 0 && cancelled() {
            return None;
        }
        if let Some(score) = pattern.score(Utf32Str::new(rel, &mut buf), &mut matcher) {
            scored.push((score, i));
        }
    }
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| entries.get(a.1).0.len().cmp(&entries.get(b.1).0.len()))
    });
    Some(scored.into_iter().take(cap).map(|(_, i)| i).collect())
}

#[derive(Serialize)]
pub struct ListFilesResult {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn fs_list_files(
    index: State<'_, FileIndexState>,
    root: String,
    limit: Option<usize>,
    max_depth: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<ListFilesResult, String> {
    let index = index.inner().clone();
    blocking(move || run_list_files(&index, root, limit, max_depth, workspace, show_hidden)).await
}

pub fn run_list_files(
    index: &FileIndexState,
    root: String,
    limit: Option<usize>,
    max_depth: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<ListFilesResult, String> {
    const DEFAULT_LIMIT: usize = 2_000;
    const HARD_LIMIT: usize = 10_000;
    const DEFAULT_DEPTH: usize = 8;
    const HARD_DEPTH: usize = 16;

    let cap = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, HARD_LIMIT);
    let depth = max_depth.unwrap_or(DEFAULT_DEPTH).clamp(1, HARD_DEPTH);
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let key = IndexKey {
        root: root_path,
        show_hidden: show_hidden.unwrap_or(false),
        max_depth: Some(depth),
    };
    let file_index = index.get_or_build(&key);
    let mut files = file_index.entries.iter().filter(|(_, is_dir)| !is_dir);
    let mut listed: Vec<String> = files
        .by_ref()
        .take(cap)
        .map(|(rel, _)| rel.to_string())
        .collect();
    let truncated = file_index.truncated || files.next().is_some();
    listed.sort_by_cached_key(|rel| rel.to_lowercase());
    Ok(ListFilesResult {
        files: listed,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packed(paths: &[&str]) -> Packed {
        let mut out = Packed::default();
        for path in paths {
            assert!(out.push(path, false));
        }
        out
    }

    fn ranked(paths: &[&str], query: &str, cap: usize) -> Vec<String> {
        let entries = packed(paths);
        rank_fuzzy(&entries, query, cap, &|| false)
            .unwrap()
            .into_iter()
            .map(|i| entries.get(i).0.to_string())
            .collect()
    }

    #[test]
    fn rank_fuzzy_prefers_name_and_shorter_path() {
        let out = ranked(
            &["src/deeply/nested/config.rs", "config.rs", "src/main.rs"],
            "config",
            10,
        );
        assert_eq!(out[0], "config.rs");
        assert!(!out.iter().any(|h| h == "src/main.rs"));
    }

    #[test]
    fn rank_fuzzy_matches_subsequence() {
        let out = ranked(&["CommandPalette.tsx", "readme.md"], "cmdp", 10);
        assert_eq!(out, vec!["CommandPalette.tsx".to_string()]);
    }

    #[test]
    fn rank_fuzzy_stops_when_superseded() {
        let entries = packed(&["a.rs", "b.rs"]);
        assert!(rank_fuzzy(&entries, "rs", 10, &|| true).is_none());
    }

    #[test]
    fn a_superseded_search_returns_a_cancelled_marker_without_walking() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "").unwrap();
        let state = FileIndexState::default();
        let out = run_search(
            &state,
            dir.path().to_string_lossy().into_owned(),
            "a".into(),
            None,
            None,
            None,
            &|| true,
        )
        .unwrap();
        assert!(out.cancelled);
        assert!(out.hits.is_empty());
    }

    #[test]
    fn repeated_queries_reuse_one_walk_and_see_new_files_after_a_change_event() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("alpha.rs"), "").unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let state = FileIndexState::default();
        let search = |q: &str| {
            run_search(&state, root.clone(), q.into(), None, None, None, &|| false)
                .unwrap()
                .hits
                .len()
        };
        assert_eq!(search("alpha"), 1);

        std::fs::write(dir.path().join("alphabet.rs"), "").unwrap();
        assert_eq!(
            search("alpha"),
            1,
            "cached list does not see the new file yet"
        );

        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        state.note_change(&crate::modules::fs::to_canon(canonical));
        assert_eq!(search("alpha"), 2);
    }
}
