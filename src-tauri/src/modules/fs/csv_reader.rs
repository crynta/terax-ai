use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
pub struct CsvResult {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
}

fn detect_delimiter(line: &str) -> u8 {
    let tab_count = line.chars().filter(|&c| c == '\t').count();
    let comma_count = line.chars().filter(|&c| c == ',').count();
    let semi_count = line.chars().filter(|&c| c == ';').count();
    let pipe_count = line.chars().filter(|&c| c == '|').count();

    let mut counts = vec![
        (b'\t', tab_count),
        (b',', comma_count),
        (b';', semi_count),
        (b'|', pipe_count),
    ];
    counts.sort_by(|a, b| b.1.cmp(&a.1));

    if counts[0].1 > 0 {
        counts[0].0
    } else {
        b','
    }
}

#[tauri::command]
pub fn fs_read_csv(path: String, workspace: Option<WorkspaceEnv>) -> Result<CsvResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);

    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);

    let mut first_line = String::new();
    reader.read_line(&mut first_line).map_err(|e| e.to_string())?;
    
    let delimiter = detect_delimiter(&first_line);

    // Re-open to parse
    let file2 = File::open(&p).map_err(|e| e.to_string())?;
    let mut csv_rdr = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(file2);

    let mut iter = csv_rdr.records();
    
    let headers: Vec<String> = if let Some(first_rec) = iter.next() {
        let rec = first_rec.map_err(|e| e.to_string())?;
        rec.iter().map(|s| s.to_string()).collect()
    } else {
        return Ok(CsvResult {
            headers: vec![],
            rows: vec![],
            total_rows: 0,
        });
    };

    let mut rows = Vec::new();
    let max_rows = 10_000;
    let mut total_rows = 0;

    for result in iter {
        if rows.len() < max_rows {
            match result {
                Ok(rec) => {
                    let row: Vec<String> = rec.iter().map(|s| s.to_string()).collect();
                    rows.push(row);
                }
                Err(e) => {
                    // Stop collecting on error, but don't fail entirely
                    log::warn!("Error parsing CSV row: {}", e);
                }
            }
        }
        total_rows += 1;
    }

    Ok(CsvResult {
        headers,
        rows,
        total_rows,
    })
}
