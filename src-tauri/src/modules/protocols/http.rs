//! HTTP protocol implementation using curl CLI

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

#[derive(Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    follow_redirects: Option<bool>,
) -> Result<HttpResponse, String> {
    let mut cmd = Command::new("curl");
    cmd.arg("-s");
    cmd.arg("-w").arg("\n%{http_code}");
    cmd.arg("-o").arg("/tmp/terax_http_body.tmp");

    if follow_redirects.unwrap_or(true) {
        cmd.arg("-L");
    }

    if let Some(h) = headers {
        for (k, v) in h {
            cmd.arg("-H").arg(format!("{}: {}", k, v));
        }
    }

    if let Some(b) = body {
        cmd.arg("-d").arg(b);
    }

    cmd.arg("-X").arg(&method);
    cmd.arg(&url);

    let start = std::time::Instant::now();
    let output = cmd.output().map_err(|e| format!("curl failed: {}", e))?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    let body = std::fs::read_to_string("/tmp/terax_http_body.tmp")
        .unwrap_or_default();

    let output_str = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = output_str.lines().collect();
    let status: u16 = lines.last()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    Ok(HttpResponse {
        status,
        headers: HashMap::new(),
        body,
        elapsed_ms,
    })
}

#[derive(Serialize, Deserialize)]
pub struct FuzzHit {
    pub word: String,
    pub status: u16,
    pub length: u64,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct FuzzResult {
    pub hits: Vec<FuzzHit>,
    pub total_tested: u32,
}

#[tauri::command]
pub async fn http_fuzz(
    url: String,
    wordlist_path: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    match_codes: Option<Vec<u16>>,
    filter_codes: Option<Vec<u16>>,
    threads: Option<u8>,
) -> Result<FuzzResult, String> {
    let wordlist = std::fs::read_to_string(&wordlist_path)
        .map_err(|e| format!("Failed to read wordlist: {}", e))?;

    let words: Vec<&str> = wordlist.lines().collect();
    let total = words.len() as u32;
    let _max_threads = threads.unwrap_or(10).min(50) as usize;

    let method = method.unwrap_or_else(|| "GET".to_string());
    let match_codes = match_codes.unwrap_or_default();
    let filter_codes = filter_codes.unwrap_or_default();

    let mut hits = Vec::new();

    for word in words {
        let fuzz_url = url.replace("FUZZ", word);

        let mut curl = Command::new("curl");
        curl.args(["-s", "-o", "/dev/null", "-w", "%{http_code},%{size_download}", "-X", &method]);
        if let Some(h) = &headers {
            for (k, v) in h {
                curl.arg("-H").arg(format!("{}: {}", k, v));
            }
        }
        curl.arg(&fuzz_url);
        let output = curl.output().map_err(|e| format!("curl failed: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = output_str.trim().split(',').collect();
        if parts.len() >= 2 {
            let status: u16 = parts[0].parse().unwrap_or(0);
            let length: u64 = parts[1].parse().unwrap_or(0);

            let should_include = if !match_codes.is_empty() {
                match_codes.contains(&status)
            } else if !filter_codes.is_empty() {
                !filter_codes.contains(&status)
            } else {
                (200..400).contains(&status)
            };

            if should_include {
                hits.push(FuzzHit {
                    word: word.to_string(),
                    status,
                    length,
                    elapsed_ms: 0,
                });
            }
        }
    }

    Ok(FuzzResult { hits, total_tested: total })
}