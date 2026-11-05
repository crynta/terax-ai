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
    /// Matcher score; only comparable within one result set.
    pub score: u32,
    /// Matched character positions in `rel` (char offsets), when requested.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub indices: Vec<u32>,
}

#[derive(Clone, Copy, Default)]
pub struct SearchOptions {
    /// Leave directories out so they do not take result slots.
    pub files_only: bool,
    /// Report which characters of `rel` matched, for highlighting.
    pub with_indices: bool,
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
    files_only: Option<bool>,
    with_indices: Option<bool>,
) -> Result<SearchResult, String> {
    let options = SearchOptions {
        files_only: files_only.unwrap_or(false),
        with_indices: with_indices.unwrap_or(false),
    };
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
            options,
            &cancelled,
        )
    })
    .await
}

#[allow(clippy::too_many_arguments)]
pub fn run_search(
    index: &FileIndexState,
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
    options: SearchOptions,
    cancelled: &dyn Fn() -> bool,
) -> Result<SearchResult, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchResult::empty());
    }
    let cap = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = search_root(&root, &workspace)?;
    if cancelled() {
        return Ok(SearchResult::cancelled());
    }

    let file_index = index.get_or_build(&search_key(&root_path, show_hidden));
    let Some(ranked) = rank_fuzzy(&file_index.entries, q, cap, options.files_only, cancelled)
    else {
        return Ok(SearchResult::cancelled());
    };

    let indices = options.with_indices.then(|| IndexFinder::new(q));
    let hits = ranked
        .into_iter()
        .map(|(score, i)| {
            let (rel, is_dir) = file_index.entries.get(i);
            SearchHit {
                path: abs_path(rel, &root_path, &root, &workspace),
                rel: rel.to_string(),
                name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
                is_dir,
                score,
                indices: indices
                    .as_ref()
                    .map(|finder| finder.indices(rel))
                    .unwrap_or_default(),
            }
        })
        .collect();
    Ok(SearchResult {
        hits,
        truncated: file_index.truncated,
        cancelled: false,
    })
}

/// Resolves and validates the root a search runs over; shared by every entry
/// point that reads the index so none of them can reach a different root.
fn search_root(root: &str, workspace: &WorkspaceEnv) -> Result<std::path::PathBuf, String> {
    let root_path = resolve_path(root, workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    Ok(root_path)
}

fn search_key(root_path: &Path, show_hidden: Option<bool>) -> IndexKey {
    IndexKey {
        root: root_path.to_path_buf(),
        show_hidden: show_hidden.unwrap_or(false),
        max_depth: None,
    }
}

/// Builds (or reuses) the file index of `root` without ranking anything, so
/// the first real query does not pay for the walk.
#[tauri::command]
pub async fn fs_warm_index(
    index: State<'_, FileIndexState>,
    root: String,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<(), String> {
    let index = index.inner().clone();
    blocking(move || run_warm_index(&index, root, workspace, show_hidden)).await
}

pub fn run_warm_index(
    index: &FileIndexState,
    root: String,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = search_root(&root, &workspace)?;
    index.get_or_build(&search_key(&root_path, show_hidden));
    Ok(())
}

fn abs_path(rel: &str, root_path: &Path, root_display: &str, workspace: &WorkspaceEnv) -> String {
    display_path(&root_path.join(rel), root_path, root_display, workspace)
}

/// Recovers match positions for the few hits that are returned, with the same
/// matcher configuration the ranking used.
struct IndexFinder {
    pattern: Pattern,
}

impl IndexFinder {
    fn new(query: &str) -> Self {
        Self {
            pattern: Pattern::parse(query, CaseMatching::Smart, Normalization::Smart),
        }
    }

    fn indices(&self, rel: &str) -> Vec<u32> {
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let mut buf = Vec::new();
        let mut out = Vec::new();
        self.pattern
            .indices(Utf32Str::new(rel, &mut buf), &mut matcher, &mut out);
        out.sort_unstable();
        out.dedup();
        out
    }
}

/// Fuzzy-rank candidates against the query (path-aware, smart-case), returning
/// `(score, index)` of the top `cap`. Ties break toward shorter relative paths,
/// then walk order. `None` means the query was superseded while ranking.
fn rank_fuzzy(
    entries: &Packed,
    query: &str,
    cap: usize,
    files_only: bool,
    cancelled: &dyn Fn() -> bool,
) -> Option<Vec<(u32, usize)>> {
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut buf = Vec::new();

    let mut scored: Vec<(u32, usize)> = Vec::new();
    for (i, (rel, is_dir)) in entries.iter().enumerate() {
        if i % CANCEL_CHECK_EVERY == 0 && cancelled() {
            return None;
        }
        if files_only && is_dir {
            continue;
        }
        if let Some(score) = pattern.score(Utf32Str::new(rel, &mut buf), &mut matcher) {
            scored.push((score, i));
        }
    }
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| entries.get(a.1).0.len().cmp(&entries.get(b.1).0.len()))
    });
    scored.truncate(cap);
    Some(scored)
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
        rank_fuzzy(&entries, query, cap, false, &|| false)
            .unwrap()
            .into_iter()
            .map(|(_, i)| entries.get(i).0.to_string())
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
        assert!(rank_fuzzy(&entries, "rs", 10, false, &|| true).is_none());
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
            SearchOptions::default(),
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
            run_search(
                &state,
                root.clone(),
                q.into(),
                None,
                None,
                None,
                SearchOptions::default(),
                &|| false,
            )
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

    #[test]
    fn rank_fuzzy_can_leave_directories_out() {
        let mut entries = Packed::default();
        assert!(entries.push("src", true));
        assert!(entries.push("src/lib.rs", false));
        let all = rank_fuzzy(&entries, "src", 10, false, &|| false).unwrap();
        let files = rank_fuzzy(&entries, "src", 10, true, &|| false).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(files.len(), 1);
        assert_eq!(entries.get(files[0].1).0, "src/lib.rs");
    }

    #[test]
    fn hits_carry_scores_and_sorted_match_indices_only_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("config.rs"), "").unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let state = FileIndexState::default();
        let search = |with_indices| {
            run_search(
                &state,
                root.clone(),
                "cfg".into(),
                None,
                None,
                None,
                SearchOptions {
                    files_only: true,
                    with_indices,
                },
                &|| false,
            )
            .unwrap()
            .hits
        };
        let plain = search(false);
        assert_eq!(plain.len(), 1);
        assert!(plain[0].score > 0);
        assert!(plain[0].indices.is_empty());

        let marked = search(true);
        assert_eq!(marked[0].indices, vec![0, 3, 5]);
    }

    #[test]
    fn warming_builds_the_index_once_so_the_first_search_reuses_it() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("alpha.rs"), "").unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let state = FileIndexState::default();
        run_warm_index(&state, root.clone(), None, None).unwrap();

        // A file added after the warm-up is invisible: the search reused the cache.
        std::fs::write(dir.path().join("alphabet.rs"), "").unwrap();
        let hits = run_search(
            &state,
            root,
            "alpha".into(),
            None,
            None,
            None,
            SearchOptions::default(),
            &|| false,
        )
        .unwrap()
        .hits;
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn warming_rejects_roots_that_are_not_directories() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "").unwrap();
        let state = FileIndexState::default();
        let err = run_warm_index(&state, file.to_string_lossy().into_owned(), None, None);
        assert!(err.unwrap_err().starts_with("not a directory"));
        assert!(run_warm_index(&state, "/definitely/not/here".into(), None, None).is_err());
    }
}
