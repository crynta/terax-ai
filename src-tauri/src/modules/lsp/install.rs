use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use flate2::read::GzDecoder;
use tauri::ipc::Channel;
use zip::ZipArchive;

use super::local::{
    bin_dir, go_executable, node_executable, node_runtime_dir, npm_executable, root,
    server_prefix, set_manifest_entry,
};
use super::resolve::{binary_stem, find_system_go, resolve_lsp};

const NODE_VERSION: &str = "22.16.0";
const GO_VERSION: &str = "1.23.4";

fn emit(progress: &Channel<String>, message: &str) {
    let _ = progress.send(message.to_string());
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Terax-LSP-Installer")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed ({}) for {url}", response.status()));
    }
    response.bytes().map_err(|e| e.to_string()).map(|b| b.to_vec())
}

fn github_latest_asset_url(repo: &str, asset_contains: &str) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = reqwest::blocking::Client::builder()
        .user_agent("Terax-LSP-Installer")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub API error ({})", response.status()));
    }
    let json: serde_json::Value = response.json().map_err(|e| e.to_string())?;
    let assets = json
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "release has no assets".to_string())?;
    for asset in assets {
        let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if name.contains(asset_contains) {
            if let Some(url) = asset.get("browser_download_url").and_then(|u| u.as_str()) {
                return Ok(url.to_string());
            }
        }
    }
    Err(format!("asset not found: {asset_contains}"))
}

fn extract_zip(data: &[u8], dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let reader = Cursor::new(data);
    let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = file.enclosed_name().map(|p| p.to_owned()) else {
            continue;
        };
        let out = dest.join(name);
        if file.name().ends_with('/') {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                if mode & 0o111 != 0 {
                    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
                }
            }
        }
    }
    Ok(())
}

fn extract_tar_gz(data: &[u8], dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let gz = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(gz);
    archive.unpack(dest).map_err(|e| e.to_string())
}

fn find_file_named(dir: &Path, name: &str) -> Option<PathBuf> {
    if dir.join(name).is_file() {
        return Some(dir.join(name));
    }
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

fn platform_rust_analyzer_asset() -> Result<&'static str, String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Ok("rust-analyzer-x86_64-pc-windows-msvc.zip");
    #[cfg(all(windows, target_arch = "aarch64"))]
    return Ok("rust-analyzer-aarch64-pc-windows-msvc.zip");
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok("rust-analyzer-aarch64-apple-darwin.gz");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok("rust-analyzer-x86_64-apple-darwin.gz");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok("rust-analyzer-x86_64-unknown-linux-gnu.gz");
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok("rust-analyzer-aarch64-unknown-linux-gnu.gz");
    #[cfg(not(any(
        all(windows, target_arch = "x86_64"),
        all(windows, target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    Err("unsupported platform for rust-analyzer".into())
}

fn platform_go_archive() -> Result<String, String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Ok(format!("go{GO_VERSION}.windows-amd64.zip"));
    #[cfg(all(windows, target_arch = "aarch64"))]
    return Ok(format!("go{GO_VERSION}.windows-arm64.zip"));
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok(format!("go{GO_VERSION}.darwin-arm64.tar.gz"));
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok(format!("go{GO_VERSION}.darwin-amd64.tar.gz"));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok(format!("go{GO_VERSION}.linux-amd64.tar.gz"));
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok(format!("go{GO_VERSION}.linux-arm64.tar.gz"));
    #[cfg(not(any(
        all(windows, target_arch = "x86_64"),
        all(windows, target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    Err("unsupported platform for Go toolchain".into())
}

fn ensure_go_runtime(progress: &Channel<String>) -> Result<(), String> {
    if go_executable().is_some() {
        return Ok(());
    }
    emit(progress, "Downloading Go toolchain for Terax…");
    let archive = platform_go_archive()?;
    let url = format!("https://go.dev/dl/{archive}");
    let data = http_get(&url)?;
    let staging = root().join("runtime").join("_go-staging");
    let _ = fs::remove_dir_all(&staging);
    if archive.ends_with(".zip") {
        extract_zip(&data, &staging)?;
    } else {
        extract_tar_gz(&data, &staging)?;
    }
    let extracted = fs::read_dir(&staging)
        .map_err(|e| e.to_string())?
        .flatten()
        .find(|e| e.path().is_dir())
        .map(|e| e.path())
        .ok_or_else(|| "Go archive layout unexpected".to_string())?;
    relocate_dir(&extracted, &super::local::go_runtime_dir())?;
    let _ = fs::remove_dir_all(&staging);
    if go_executable().is_none() {
        return Err("Go toolchain install failed".into());
    }
    Ok(())
}

fn go_for_install(progress: &Channel<String>) -> Result<PathBuf, String> {
    if let Some(go) = find_system_go() {
        return Ok(go);
    }
    ensure_go_runtime(progress)?;
    go_executable().ok_or_else(|| "Go toolchain not available".into())
}

fn install_gopls(progress: &Channel<String>) -> Result<PathBuf, String> {
    emit(progress, "Installing gopls…");
    let go = go_for_install(progress)?;
    let binary_name = if cfg!(windows) { "gopls.exe" } else { "gopls" };
    let dest = bin_dir().join(binary_name);
    let mut cmd = Command::new(&go);
    cmd.args([
        "install",
        "-o",
        &dest.to_string_lossy(),
        "golang.org/x/tools/gopls@latest",
    ])
    .env("GOTOOLCHAIN", "auto")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    super::local::apply_lsp_environment(&mut cmd);
    crate::modules::proc::hide_console(&mut cmd);
    let output = cmd.output().map_err(|e| format!("failed to run go: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("go install gopls failed: {stderr}"));
    }
    if !dest.is_file() {
        return Err(format!("gopls binary missing: {}", dest.display()));
    }
    set_manifest_entry("gopls", dest.clone(), None)?;
    Ok(dest)
}

fn platform_node_archive() -> Result<String, String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Ok(format!("node-v{NODE_VERSION}-win-x64.zip"));
    #[cfg(all(windows, target_arch = "aarch64"))]
    return Ok(format!("node-v{NODE_VERSION}-win-arm64.zip"));
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok(format!("node-v{NODE_VERSION}-darwin-arm64.tar.gz"));
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok(format!("node-v{NODE_VERSION}-darwin-x64.tar.gz"));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok(format!("node-v{NODE_VERSION}-linux-x64.tar.gz"));
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok(format!("node-v{NODE_VERSION}-linux-arm64.tar.gz"));
    #[cfg(not(any(
        all(windows, target_arch = "x86_64"),
        all(windows, target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    Err("unsupported platform for Node.js runtime".into())
}

fn install_rust_analyzer(progress: &Channel<String>) -> Result<PathBuf, String> {
    emit(progress, "Downloading rust-analyzer…");
    let asset = platform_rust_analyzer_asset()?;
    let url = github_latest_asset_url("rust-lang/rust-analyzer", asset)?;
    let data = http_get(&url)?;
    let staging = bin_dir().join("_staging-ra");
    let _ = fs::remove_dir_all(&staging);
    if asset.ends_with(".zip") {
        extract_zip(&data, &staging)?;
    } else {
        extract_tar_gz(&data, &staging)?;
    }
    let binary_name = if cfg!(windows) {
        "rust-analyzer.exe"
    } else {
        "rust-analyzer"
    };
    let found = find_file_named(&staging, binary_name)
        .ok_or_else(|| "rust-analyzer binary missing in archive".to_string())?;
    let dest = bin_dir().join(binary_name);
    fs::copy(&found, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    set_manifest_entry("rust-analyzer", dest.clone(), None)?;
    Ok(dest)
}

fn install_clangd(progress: &Channel<String>) -> Result<PathBuf, String> {
    emit(progress, "Downloading clangd…");
    #[cfg(windows)]
    let asset_hint = "clangd-windows";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let asset_hint = "clangd-mac-aarch64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let asset_hint = "clangd-mac";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    let asset_hint = "clangd-linux";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    let asset_hint = "clangd-linux-aarch64";
    let url = github_latest_asset_url("clangd/clangd", asset_hint)?;
    let data = http_get(&url)?;
    let staging = bin_dir().join("_staging-clangd");
    let _ = fs::remove_dir_all(&staging);
    extract_zip(&data, &staging)?;
    let binary_name = if cfg!(windows) { "clangd.exe" } else { "clangd" };
    let found = find_file_named(&staging, binary_name)
        .ok_or_else(|| "clangd binary missing in archive".to_string())?;
    let dest = bin_dir().join(binary_name);
    fs::copy(&found, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    set_manifest_entry("clangd", dest.clone(), None)?;
    Ok(dest)
}

fn relocate_dir(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() {
        fs::remove_dir_all(to).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if fs::rename(from, to).is_err() {
        copy_dir_recursive(from, to)?;
        fs::remove_dir_all(from).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dest = to.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ensure_node_runtime(progress: &Channel<String>) -> Result<(), String> {
    if node_executable().is_some() {
        return Ok(());
    }
    emit(progress, "Downloading Node.js runtime for Terax…");
    let archive = platform_node_archive()?;
    let url = format!("https://nodejs.org/dist/v{NODE_VERSION}/{archive}");
    let data = http_get(&url)?;
    // Staging must live outside node_runtime_dir — remove_dir_all(node) would delete it otherwise.
    let staging = root().join("runtime").join("_node-staging");
    let _ = fs::remove_dir_all(&staging);
    if archive.ends_with(".zip") {
        extract_zip(&data, &staging)?;
    } else {
        extract_tar_gz(&data, &staging)?;
    }
    let extracted = fs::read_dir(&staging)
        .map_err(|e| e.to_string())?
        .flatten()
        .find(|e| e.path().is_dir())
        .map(|e| e.path())
        .ok_or_else(|| "Node.js archive layout unexpected".to_string())?;
    relocate_dir(&extracted, &node_runtime_dir())?;
    let _ = fs::remove_dir_all(&staging);
    if node_executable().is_none() {
        return Err("Node.js runtime install failed".into());
    }
    Ok(())
}

fn npm_command() -> Result<Command, String> {
    let npm = npm_executable().ok_or_else(|| "npm not found in Terax runtime".to_string())?;
    Ok(crate::modules::proc::command_for_executable(&npm))
}

fn npm_bin_path(prefix: &Path, stem: &str) -> PathBuf {
    #[cfg(windows)]
    {
        return prefix
            .join("node_modules")
            .join(".bin")
            .join(format!("{stem}.cmd"));
    }
    #[cfg(not(windows))]
    {
        prefix
            .join("node_modules")
            .join(".bin")
            .join(stem)
    }
}

fn install_npm_server(
    progress: &Channel<String>,
    server_id: &str,
    stem: &str,
    packages: &[&str],
) -> Result<PathBuf, String> {
    ensure_node_runtime(progress)?;
    let prefix = server_prefix(server_id);
    let _ = fs::remove_dir_all(&prefix);
    fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    emit(
        progress,
        &format!(
            "Installing {} via npm (local to Terax)…",
            packages.join(", ")
        ),
    );
    let mut cmd = npm_command()?;
    cmd.args([
        "install",
        "--prefix",
        &prefix.to_string_lossy(),
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
    ])
    .args(packages)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    super::local::apply_lsp_environment(&mut cmd);
    crate::modules::proc::hide_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run npm at {}: {e}", npm_executable().map(|p| p.display().to_string()).unwrap_or_else(|| "?".into())))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {stderr}"));
    }
    let bin = npm_bin_path(&prefix, stem);
    if !bin.is_file() {
        return Err(format!("expected binary missing: {}", bin.display()));
    }
    set_manifest_entry(stem, bin.clone(), None)?;
    Ok(bin)
}

fn platform_deps_lsp_asset() -> Result<&'static str, String> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Ok("deps-lsp-x86_64-pc-windows-msvc");
    #[cfg(all(windows, target_arch = "aarch64"))]
    return Ok("deps-lsp-aarch64-pc-windows-msvc");
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok("deps-lsp-aarch64-apple-darwin");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok("deps-lsp-x86_64-apple-darwin");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok("deps-lsp-x86_64-unknown-linux-gnu");
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok("deps-lsp-aarch64-unknown-linux-gnu");
    #[cfg(not(any(
        all(windows, target_arch = "x86_64"),
        all(windows, target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    Err("unsupported platform for deps-lsp".into())
}

fn install_deps_lsp(progress: &Channel<String>) -> Result<PathBuf, String> {
    emit(progress, "Downloading deps-lsp…");
    let asset = platform_deps_lsp_asset()?;
    let url = github_latest_asset_url("bug-ops/deps-lsp", asset)?;
    let data = http_get(&url)?;
    let staging = bin_dir().join("_staging-deps-lsp");
    let _ = fs::remove_dir_all(&staging);
    if asset.contains("windows") {
        extract_zip(&data, &staging)?;
    } else {
        extract_tar_gz(&data, &staging)?;
    }
    let binary_name = if cfg!(windows) {
        "deps-lsp.exe"
    } else {
        "deps-lsp"
    };
    let found = find_file_named(&staging, binary_name)
        .ok_or_else(|| "deps-lsp binary missing in archive".to_string())?;
    let dest = bin_dir().join(binary_name);
    fs::copy(&found, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    set_manifest_entry("deps-lsp", dest.clone(), None)?;
    Ok(dest)
}

pub fn install_server(command: &str, progress: &Channel<String>) -> Result<PathBuf, String> {
    if let Ok(existing) = resolve_lsp(command) {
        emit(progress, "Using existing installation.");
        return Ok(PathBuf::from(existing.display_path()));
    }
    let stem = binary_stem(command);
    match stem {
        "rust-analyzer" => install_rust_analyzer(progress),
        "gopls" => install_gopls(progress),
        "clangd" => install_clangd(progress),
        "typescript-language-server" => install_npm_server(
            progress,
            "typescript",
            stem,
            &["typescript", "typescript-language-server"],
        ),
        "pyright-langserver" => install_npm_server(progress, "pyright", stem, &["pyright"]),
        "json-languageserver" | "vscode-json-language-server" => install_npm_server(
            progress,
            "json",
            "vscode-json-language-server",
            &["vscode-langservers-extracted"],
        ),
        "bash-language-server" => {
            install_npm_server(progress, "shell", stem, &["bash-language-server"])
        }
        "deps-lsp" => install_deps_lsp(progress),
        "intelephense" => install_npm_server(progress, "php", stem, &["intelephense"]),
        other => Err(format!("no Terax installer for {other}")),
    }
}
