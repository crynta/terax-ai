// src-tauri/src/bootstrap.rs
//
// Android-only. Called once from the frontend on first launch.
// Extracts the proot binary and Alpine Linux rootfs from the app's
// bundled assets to internal storage so the PTY backend can use them.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn files_dir(app: &AppHandle) -> PathBuf {
    // On Android, app_data_dir() resolves to /data/data/<pkg>/files
    app.path()
        .app_data_dir()
        .expect("app_data_dir unavailable on Android")
}

/// Returns true if bootstrap has already been completed.
#[tauri::command]
pub fn bootstrap_status(app: AppHandle) -> bool {
    let base = files_dir(&app);
    base.join("proot").exists() && base.join("rootfs").exists()
}

/// Extracts proot and Alpine rootfs from bundled assets to internal storage.
/// Safe to call multiple times — skips if already complete.
#[tauri::command]
pub async fn bootstrap_android(app: AppHandle) -> Result<String, String> {
    let base = files_dir(&app);
    let proot_dest = base.join("proot");
    let rootfs_dest = base.join("rootfs");

    if proot_dest.exists() && rootfs_dest.exists() {
        log::info!("bootstrap_android: already complete, skipping");
        return Ok("already_bootstrapped".into());
    }

    log::info!("bootstrap_android: starting first-run bootstrap");
    fs::create_dir_all(&base).map_err(|e| format!("create files dir: {e}"))?;

    // ── 1. Copy proot binary from bundled resources ───────────────────────────
    let proot_src = app
        .path()
        .resolve(
            "assets/android/proot-aarch64",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve proot asset: {e}"))?;

    fs::copy(&proot_src, &proot_dest)
        .map_err(|e| format!("copy proot binary: {e}"))?;

    // Make executable
    fs::set_permissions(&proot_dest, fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("chmod proot: {e}"))?;

    log::info!("bootstrap_android: proot binary installed at {}", proot_dest.display());

    // ── 2. Extract Alpine rootfs tarball ─────────────────────────────────────
    let tarball_src = app
        .path()
        .resolve(
            "assets/android/alpine-rootfs.tar.gz",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve rootfs asset: {e}"))?;

    fs::create_dir_all(&rootfs_dest)
        .map_err(|e| format!("create rootfs dir: {e}"))?;

    // Android ships `tar` since API 21 (Android 5). Using it avoids pulling
    // a Rust tar crate into the binary.
    let status = std::process::Command::new("tar")
        .args([
            "xzf",
            tarball_src.to_str().unwrap(),
            "-C",
            rootfs_dest.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| format!("spawn tar: {e}"))?;

    if !status.success() {
        return Err(format!(
            "tar extraction failed with exit code: {:?}",
            status.code()
        ));
    }

    log::info!("bootstrap_android: rootfs extracted to {}", rootfs_dest.display());

    // ── 3. Write /etc/resolv.conf for DNS inside proot ────────────────────────
    let resolv_path = rootfs_dest.join("etc/resolv.conf");
    if let Some(parent) = resolv_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut resolv = fs::File::create(&resolv_path)
        .map_err(|e| format!("create resolv.conf: {e}"))?;
    writeln!(resolv, "nameserver 8.8.8.8").map_err(|e| e.to_string())?;
    writeln!(resolv, "nameserver 1.1.1.1").map_err(|e| e.to_string())?;

    // ── 4. Write /etc/profile.d/terax.sh to set useful env vars ─────────────
    let profile_d = rootfs_dest.join("etc/profile.d");
    let _ = fs::create_dir_all(&profile_d);
    let terax_profile = profile_d.join("terax.sh");
    let mut pf = fs::File::create(&terax_profile)
        .map_err(|e| format!("create terax profile: {e}"))?;
    writeln!(pf, "export TERM=xterm-256color").map_err(|e| e.to_string())?;
    writeln!(pf, "export COLORTERM=truecolor").map_err(|e| e.to_string())?;
    writeln!(pf, "export TERAX_TERMINAL=1").map_err(|e| e.to_string())?;
    writeln!(pf, "export LANG=C.UTF-8").map_err(|e| e.to_string())?;

    log::info!("bootstrap_android: complete");
    Ok("bootstrapped".into())
}
