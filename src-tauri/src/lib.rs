mod modules;

use modules::{fs, pty, shell};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(720.0, 520.0)
        .min_inner_size(720.0, 520.0)
        .max_inner_size(720.0, 520.0)
        .resizable(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar and window controls,
    // so drop the native chrome entirely.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// Batch-read multiple keyring entries in a single IPC call. The plugin's
/// per-key `get_password` command costs one round-trip each; on cold boot
/// we fan that out across every provider we know about, even unconfigured
/// ones — which shows up as a wave of `plugin:keyring|get_password` rows.
/// This collapses the wave into one command.
#[tauri::command]
async fn keyring_get_all(service: String, accounts: Vec<String>) -> Vec<Option<String>> {
    accounts
        .into_iter()
        .map(|a| {
            keyring::Entry::new(&service, &a)
                .ok()
                .and_then(|e| e.get_password().ok())
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(not(target_os = "macos"))]
    let builder = builder.setup(|app| {
        // Main window is built from tauri.conf.json with default chrome.
        // On Linux/Windows we render our own titlebar — strip the native one.
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_decorations(false);
        }
        Ok(())
    });

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_keyring::init())
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
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
            keyring_get_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
