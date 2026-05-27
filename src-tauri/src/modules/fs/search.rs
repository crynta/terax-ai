use ignore::WalkBuilder;
use serde::Serialize;
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use super::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
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
    pub scanned: usize,
    pub elapsed_ms: u64,
    pub budget_exhausted: bool,
    pub partial_reason: Option<String>,
}

fn build_globset(patterns: Option<&[String]>) -> Result<Option<GlobSet>, String> {
    let Some(patterns) = patterns else {
        return Ok(None);
    };
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        b.add(g);
    }
    let set = b.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

/// Hard cap on entries for fast mode to keep UI responsive on huge roots.
const FAST_MAX_SCANNED: usize = 20_000;
const FAST_TIMEOUT_MS: u64 = 250;

/// Directory names pruned unconditionally — they're rarely useful in a
/// file-explorer search and they dominate scan time when present.
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

static LATEST_SEARCH_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn fs_search(
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
    include_paths: Option<Vec<String>>,
    exclude_paths: Option<Vec<String>>,
    pass_mode: Option<String>,
    prune_heavy: Option<bool>,
    deep_budget_profile: Option<String>,
    request_id: Option<u64>,
) -> Result<SearchResult, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            truncated: false,
            scanned: 0,
            elapsed_ms: 0,
            budget_exhausted: false,
            partial_reason: None,
        });
    }
    let cap = limit.unwrap_or(200).min(1000);
    let request_id = request_id.unwrap_or(0);
    if request_id > 0 {
        LATEST_SEARCH_REQUEST_ID.fetch_max(request_id, Ordering::Relaxed);
    }
    let show_hidden = show_hidden.unwrap_or(false);
    let mode = pass_mode.unwrap_or_else(|| "fast".to_string());
    let deep = mode.eq_ignore_ascii_case("deep");
    let deep_budget_profile = deep_budget_profile.unwrap_or_else(|| "strict".to_string());
    let (deep_max_scanned, deep_timeout_ms): (usize, u64) =
        if deep_budget_profile.eq_ignore_ascii_case("wide") {
            (250_000, 3_000)
        } else {
            (60_000, 700)
        };
    let prune_heavy = prune_heavy.unwrap_or(!deep);
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let include_set = build_globset(include_paths.as_deref())?;
    let exclude_set = build_globset(exclude_paths.as_deref())?;

    let mut out: Vec<SearchHit> = Vec::with_capacity(cap.min(64));
    let mut scanned: usize = 0;
    let mut truncated = false;
    let mut budget_exhausted = false;
    let mut partial_reason: Option<String> = None;
    let started = Instant::now();

    let walker = WalkBuilder::new(&root_path)
        .hidden(!(show_hidden || deep))
        .git_ignore(!deep)
        .git_global(!deep)
        .git_exclude(!deep)
        .ignore(!deep)
        .parents(true)
        .follow_links(false)
        .filter_entry(move |dent| {
            if !prune_heavy || dent.depth() == 0 {
                return true;
            }
            match dent.file_name().to_str() {
                Some(name) => !PRUNE_DIRS.contains(&name),
                None => true,
            }
        })
        .build();

    for dent in walker.flatten() {
        if request_id > 0 && LATEST_SEARCH_REQUEST_ID.load(Ordering::Relaxed) != request_id {
            truncated = true;
            budget_exhausted = true;
            partial_reason = Some("cancelled".to_string());
            break;
        }
        scanned += 1;
        if deep {
            if scanned > deep_max_scanned {
                truncated = true;
                budget_exhausted = true;
                partial_reason = Some("budget_scanned".to_string());
                break;
            }
            if started.elapsed().as_millis() as u64 > deep_timeout_ms {
                truncated = true;
                budget_exhausted = true;
                partial_reason = Some("budget_timeout".to_string());
                break;
            }
        }
        if !deep && scanned > FAST_MAX_SCANNED {
            truncated = true;
            partial_reason = Some("max_scanned".to_string());
            break;
        }
        if !deep && started.elapsed().as_millis() as u64 > FAST_TIMEOUT_MS {
            truncated = true;
            partial_reason = Some("fast_timeout".to_string());
            break;
        }
        if out.len() >= cap {
            truncated = true;
            partial_reason = Some("max_hits".to_string());
            break;
        }
        let path = dent.path();
        if path == root_path {
            continue;
        }
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        let abs = display_path(path, &root_path, &root, &workspace);
        if let Some(set) = include_set.as_ref() {
            if !set.is_match(&rel) && !set.is_match(&abs) {
                continue;
            }
        }
        if let Some(set) = exclude_set.as_ref() {
            if set.is_match(&rel) || set.is_match(&abs) {
                continue;
            }
        }
        if !rel.to_lowercase().contains(&q) && !abs.to_lowercase().contains(&q) {
            continue;
        }
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(SearchHit {
            path: abs,
            rel,
            name,
            is_dir,
        });
    }

    // Rank: filename matches first, then shorter relative paths.
    out.sort_by(|a, b| {
        let an = a.name.to_lowercase().contains(&q);
        let bn = b.name.to_lowercase().contains(&q);
        bn.cmp(&an).then(a.rel.len().cmp(&b.rel.len()))
    });

    Ok(SearchResult {
        hits: out,
        truncated,
        scanned,
        elapsed_ms: started.elapsed().as_millis() as u64,
        budget_exhausted,
        partial_reason,
    })
}

#[derive(Serialize)]
pub struct ListFilesResult {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[tauri::command]
pub fn fs_list_files(
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
    let show_hidden = show_hidden.unwrap_or(false);
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let walker = WalkBuilder::new(&root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .max_depth(Some(depth))
        .filter_entry(|dent| {
            if dent.depth() == 0 {
                return true;
            }
            match dent.file_name().to_str() {
                Some(name) => !PRUNE_DIRS.contains(&name),
                None => true,
            }
        })
        .build();

    let mut files: Vec<String> = Vec::with_capacity(cap.min(256));
    let mut scanned: usize = 0;
    let mut truncated = false;

    for dent in walker.flatten() {
        scanned += 1;
        if scanned > FAST_MAX_SCANNED {
            truncated = true;
            break;
        }
        let is_file = dent.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if rel.is_empty() {
            continue;
        }
        files.push(rel);
        if files.len() >= cap {
            truncated = true;
            break;
        }
    }

    files.sort_by_key(|a| a.to_lowercase());
    Ok(ListFilesResult { files, truncated })
}

fn display_path(
    path: &std::path::Path,
    root_path: &std::path::Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
) -> String {
    if workspace.is_wsl() {
        if let Ok(rel) = path.strip_prefix(root_path) {
            let rel = to_canon(rel);
            return if rel.is_empty() {
                root_display.to_string()
            } else if root_display.ends_with('/') {
                format!("{root_display}{rel}")
            } else {
                format!("{root_display}/{rel}")
            };
        }
    }
    to_canon(path)
}
