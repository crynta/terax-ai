mod modules;

use modules::{agents, fs, net, pty, secrets, shell};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(720.0, 520.0)
        .min_inner_size(720.0, 520.0)
        .max_inner_size(720.0, 520.0)
        .resizable(false)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }
    let _ = window;
    Ok(())
}

// WebKitGTK's DMA-BUF (hardware) renderer fails to create an EGL display on
// wlroots compositors (#105), NVIDIA's proprietary driver, and minimal sessions
// (#126). It's fine and faster on Mesa-backed GNOME/KDE/COSMIC, so only fall
// back to the safe path where trouble is likely. Override:
//   WEBKIT_DISABLE_DMABUF_RENDERER=1  force safe path   =0  force hardware path
#[cfg(target_os = "linux")]
fn configure_linux_rendering() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }

    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    if !wayland {
        return;
    }

    match wayland_dmabuf_fallback_reason() {
        Some(reason) => {
            eprintln!(
                "terax: Wayland session, {reason}; disabling WebKitGTK DMA-BUF renderer \
                 (override: WEBKIT_DISABLE_DMABUF_RENDERER=0)"
            );
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
        None => eprintln!(
            "terax: Wayland session on a known-good compositor; keeping WebKitGTK DMA-BUF renderer \
             (set WEBKIT_DISABLE_DMABUF_RENDERER=1 if the window stays blank)"
        ),
    }
}

#[cfg(target_os = "linux")]
fn wayland_dmabuf_fallback_reason() -> Option<&'static str> {
    if has_nvidia_gpu() {
        return Some("NVIDIA proprietary driver detected");
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("XDG_SESSION_DESKTOP"))
        .unwrap_or_default()
        .to_lowercase();
    const KNOWN_GOOD: [&str; 6] = ["gnome", "kde", "plasma", "cosmic", "unity", "pantheon"];
    if !desktop.is_empty() && KNOWN_GOOD.iter().any(|d| desktop.contains(d)) {
        return None;
    }
    if desktop.is_empty() {
        Some("compositor not advertised (XDG_CURRENT_DESKTOP unset)")
    } else {
        Some("wlroots / unrecognised compositor")
    }
}

#[cfg(target_os = "linux")]
fn has_nvidia_gpu() -> bool {
    std::path::Path::new("/dev/nvidia0").exists()
        || matches!(
            std::env::var("__GLX_VENDOR_LIBRARY_NAME").as_deref(),
            Ok("nvidia")
        )
        || matches!(
            std::env::var("__NV_PRIME_RENDER_OFFLOAD").as_deref(),
            Ok("1")
        )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_rendering();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(agents::AgentsState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::search::fs_search,
            fs::grep::fs_grep,
            fs::grep::fs_glob,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            open_settings_window,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::http_ping,
            agents::agent_backends_list,
            agents::agent_session_start,
            agents::agent_session_prompt,
            agents::agent_session_cancel,
            agents::agent_session_close,
            agents::agent_permission_respond,
            agents::probe::agent_backend_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
