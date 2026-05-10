//! HackTricks local knowledge base indexing and search.
//!
//! Provides commands to:
//! 1. Clone and index the HackTricks wiki for offline search
//! 2. Search the indexed content using an inverted index

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const HACKTRICKS_DIR: &str = ".mr-robot/hacktricks";
const INDEX_FILE: &str = ".mr-robot/hacktricks-index.json";

#[derive(Serialize, Deserialize)]
pub struct SearchResult {
    pub results: Vec<SearchHit>,
}

#[derive(Serialize, Deserialize)]
pub struct SearchHit {
    pub file: String,
    pub title: String,
    pub excerpt: String,
    pub line: usize,
    pub score: f64,
}

#[derive(Serialize, Deserialize, Default)]
struct InvertedIndex(HashMap<String, Vec<(String, usize)>>);

fn get_mr_robot_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not find home directory")?;
    Ok(home.join(HACKTRICKS_DIR))
}

fn get_index_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not find home directory")?;
    Ok(home.join(INDEX_FILE))
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() >= 3)
        .map(String::from)
        .collect()
}

#[tauri::command]
pub async fn hacktricks_index(app: AppHandle) -> Result<serde_json::Value, String> {
    let base_dir = get_mr_robot_dir()?;
    let index_path = get_index_path()?;

    if !base_dir.exists() {
        log::info!("Cloning HackTricks repository...");
        let output = std::process::Command::new("git")
            .args([
                "clone",
                "--depth",
                "1",
                "https://github.com/HackTricks-wiki/hacktricks",
                base_dir.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("failed to clone HackTricks: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git clone failed: {}", stderr));
        }
    }

    let mut index = InvertedIndex::default();
    let mut md_files: Vec<PathBuf> = Vec::new();

    log::info!("Scanning for markdown files...");
    for entry in WalkDir::new(&base_dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            md_files.push(path.to_path_buf());
        }
    }

    let total = md_files.len();
    log::info!("Indexing {} files...", total);

    for (i, file_path) in md_files.iter().enumerate() {
        if i % 50 == 0 {
            let _ = app.emit(
                "hacktricks:progress",
                serde_json::json!({
                    "done": i,
                    "total": total,
                    "file": file_path.file_name().and_then(|n| n.to_str()).unwrap_or("")
                }),
            );
        }

        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let rel_path = file_path
            .strip_prefix(&base_dir)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        for (line_num, line) in content.lines().enumerate() {
            let tokens = tokenize(line);
            for token in tokens {
                index.0.entry(token).or_default().push((rel_path.clone(), line_num));
            }
        }
    }

    let index_json = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("failed to serialize index: {}", e))?;

    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create index dir: {}", e))?;
    }

    fs::write(&index_path, index_json).map_err(|e| format!("failed to write index: {}", e))?;

    let _ = app.emit(
        "hacktricks:progress",
        serde_json::json!({ "done": total, "total": total, "file": "complete" }),
    );

    log::info!("HackTricks indexing complete: {} files", total);

    Ok(serde_json::json!({ "ok": true, "files_indexed": total }))
}

#[tauri::command]
pub async fn hacktricks_search(
    query: String,
    max_results: Option<u32>,
) -> Result<SearchResult, String> {
    let index_path = get_index_path()?;

    if !index_path.exists() {
        return Ok(SearchResult {
            results: vec![],
        });
    }

    let index_json = fs::read_to_string(&index_path)
        .map_err(|e| format!("failed to read index: {}", e))?;

    let index: InvertedIndex = serde_json::from_str(&index_json)
        .map_err(|e| format!("failed to parse index: {}", e))?;

    let query_tokens = tokenize(&query);
    if query_tokens.is_empty() {
        return Ok(SearchResult { results: vec![] });
    }

    let mut file_scores: HashMap<String, (f64, Vec<(String, usize)>)> = HashMap::new();

    for token in &query_tokens {
        if let Some(hits) = index.0.get(token) {
            for (file, line) in hits {
                let entry = file_scores.entry(file.clone()).or_insert((0.0, Vec::new()));
                entry.0 += 1.0;
                if !entry.1.iter().any(|(f, l)| f == file && *l == *line) {
                    entry.1.push((file.clone(), *line));
                }
            }
        }
    }

    let mut sorted_files: Vec<_> = file_scores.into_iter().collect();
    sorted_files.sort_by(|a, b| b.1 .0.partial_cmp(&a.1 .0).unwrap_or(std::cmp::Ordering::Equal));

    let max = max_results.unwrap_or(20) as usize;
    let base_dir = get_mr_robot_dir()?;
    let mut results = Vec::new();

    for (file_path, (score, _lines)) in sorted_files.into_iter().take(max) {
        let full_path = base_dir.join(&file_path);
        let content = fs::read_to_string(&full_path).unwrap_or_default();

        let mut best_line = 0;
        let mut best_count = 0;
        for (i, line) in content.lines().enumerate() {
            let line_tokens = tokenize(line);
            let count = query_tokens.iter().filter(|t| line_tokens.contains(t)).count();
            if count > best_count {
                best_count = count;
                best_line = i;
            }
        }

        let title = content
            .lines()
            .find(|l| l.trim_start().starts_with("# "))
            .map(|l| l.trim_start().trim_start_matches("# ").to_string())
            .unwrap_or_else(|| file_path.clone());

        let excerpt = content
            .lines()
            .skip(best_line.saturating_sub(1))
            .take(3)
            .collect::<Vec<_>>()
            .join("\n");

        results.push(SearchHit {
            file: file_path,
            title,
            excerpt,
            line: best_line,
            score,
        });
    }

    Ok(SearchResult { results })
}