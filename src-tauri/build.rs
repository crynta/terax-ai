fn main() {
    ensure_check_sidecar();
    tauri_build::build()
}

fn ensure_check_sidecar() {
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        return;
    }
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let path = std::path::PathBuf::from("binaries").join(format!("terax-cli-{target}{extension}"));
    if path.exists() {
        return;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create sidecar check directory");
    }
    std::fs::write(&path, []).expect("create sidecar check placeholder");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("mark sidecar check placeholder executable");
    }
}
