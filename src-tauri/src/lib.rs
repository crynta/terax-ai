pub mod modules;

use modules::{
    agent, claude_code, fs, git, history, lsp, net, pty, secrets, shell, workspace,
};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

/// Tab requested while the settings webview was still booting: the emit()
/// would be lost (listener not registered yet), so the frontend also pulls
/// this once on mount.
#[derive(Default)]
struct SettingsPendingTab(Mutex<Option<String>>);

#[tauri::command]
fn settings_take_pending_tab(state: State<'_, SettingsPendingTab>) -> Option<String> {
    state.0.lock().expect("SettingsPendingTab poisoned").take()
}

/// Vertically centers the traffic lights in the custom 44px header the way
/// Safari/Xcode do it: attach an empty unified-compact NSToolbar, and AppKit
/// lays the buttons out in the taller titlebar region natively — across
/// resizes, fullscreen transitions and macOS versions (incl. Tahoe's glass
/// titlebar). No frame fighting, unlike tao's drawRect-based inset, which is
/// broken under a webview (tauri-apps/tauri#14072).
#[cfg(target_os = "macos")]
fn install_titlebar_toolbar(window: &tauri::WebviewWindow) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSToolbar, NSWindow, NSWindowToolbarStyle};

    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    unsafe {
        let ns_window = &*(ptr as *const NSWindow);
        let toolbar = NSToolbar::new(mtm);
        ns_window.setToolbar(Some(&toolbar));
        ns_window.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);
    }
}

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(crate::modules::fs::to_canon(&canon));
    }
    None
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        show_settings_window(&app, &window, tab.as_deref());
        return Ok(());
    }

    if let Err(e) = create_settings_window(&app, url_path) {
        // Lost the create race against the prewarm thread — the window
        // exists now; fall back to showing it instead of failing the open.
        if let Some(window) = app.get_webview_window("settings") {
            show_settings_window(&app, &window, tab.as_deref());
            return Ok(());
        }
        return Err(e);
    }
    Ok(())
}

fn show_settings_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, tab: Option<&str>) {
    // Re-center over the main window only when coming back from hidden —
    // never yank a window the user has already placed.
    if !window.is_visible().unwrap_or(true) {
        position_settings_window(app, window);
    }
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(t) = tab.filter(|s| !s.is_empty()) {
        if let Some(state) = app.try_state::<SettingsPendingTab>() {
            *state.0.lock().expect("SettingsPendingTab poisoned") = Some(t.to_string());
        }
        // emit() serializes via JSON — no string-escape footgun, unlike
        // eval() with format!(). Frontend listens via Tauri event API; a
        // still-booting webview misses it and pulls the stash instead.
        let _ = window.emit("terax:settings-tab", t);
    }
}

fn create_settings_window(
    app: &tauri::AppHandle,
    url_path: String,
) -> Result<tauri::WebviewWindow, String> {
    let builder = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    // macOS: skip parent() — child + always_on_top leaves the settings webview
    // behind the main window except while the parent is being dragged (#33).
    #[cfg(not(target_os = "macos"))]
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.parent(&main).map_err(|e| e.to_string())?
    } else {
        builder
    };

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

    // Closing settings only hides it: the webview stays warm, so the next
    // open is instant instead of paying webview + JS boot (~1s).
    {
        let win = window.clone();
        let handle = app.clone();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = win.hide();
                }
                // OS always-on-top is global — keep settings above Terax
                // while the app is active, but never float it over OTHER
                // applications when the whole app loses focus.
                WindowEvent::Focused(focused) => {
                    let main_focused = handle
                        .get_webview_window("main")
                        .and_then(|m| m.is_focused().ok())
                        .unwrap_or(false);
                    let _ = win.set_always_on_top(*focused || main_focused);
                }
                _ => {}
            }
        });
    }

    position_settings_window(app, &window);

    Ok(window)
}

/// Centers settings over the main window in LOGICAL coordinates — physical
/// pixels from two windows can live on monitors with different DPI.
fn position_settings_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Some(main) = app.get_webview_window("main") else {
        let _ = window.center();
        return;
    };
    let geometry = (
        main.outer_position(),
        main.outer_size(),
        window.outer_size(),
        main.scale_factor(),
        window.scale_factor(),
    );
    if let (Ok(main_pos), Ok(main_size), Ok(settings_size), Ok(main_scale), Ok(win_scale)) =
        geometry
    {
        let mx = main_pos.x as f64 / main_scale;
        let my = main_pos.y as f64 / main_scale;
        let mw = main_size.width as f64 / main_scale;
        let mh = main_size.height as f64 / main_scale;
        let sw = settings_size.width as f64 / win_scale;
        let sh = settings_size.height as f64 / win_scale;
        let x = mx + (mw - sw) / 2.0;
        let y = my + (mh - sh) / 2.0;
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    } else {
        let _ = window.center();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("__terax_notify") {
            if let (Some(agent), Some(event)) = (args.get(2), args.get(3)) {
                agent::emit_conout_marker(agent, event);
            }
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = out.write_all(b"{}");
            let _ = out.flush();
            std::process::exit(0);
        }
    }

    let cli_dir = parse_launch_dir();
    workspace::init_launch_cwd(cli_dir.as_deref());

    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                // Settings is a fixed-size utility window — always open it at
                // its declared 900x700, never a stale saved size/maximized state.
                .skip_initial_state("settings")
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            if let Some(main) = _app.get_webview_window("main") {
                install_titlebar_toolbar(&main);
            }

            // Main window closes → destroy settings on EVERY platform.
            // parent()/transient_for does not destroy the child on Linux, so
            // the hidden prewarmed settings window would keep the process
            // alive with zero visible windows.
            if let Some(main) = _app.get_webview_window("main") {
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    match event {
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                            if let Some(settings) = handle.get_webview_window("settings") {
                                // destroy(), not close(): close would hit the
                                // hide-on-close hook and keep the process
                                // alive with zero visible windows.
                                let _ = settings.destroy();
                            }
                        }
                        // App became active again → restore settings-on-top
                        // (its own Focused handler drops it when the app
                        // deactivates).
                        WindowEvent::Focused(true) => {
                            if let Some(settings) = handle.get_webview_window("settings") {
                                if settings.is_visible().unwrap_or(false) {
                                    let _ = settings.set_always_on_top(true);
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }

            // Pre-warm the settings window hidden shortly after startup so
            // even the first open is instant. The frontend skips its
            // auto-show when the URL carries ?prewarm.
            {
                let handle = _app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if handle.get_webview_window("settings").is_none() {
                        let _ =
                            create_settings_window(&handle, "settings.html?prewarm".to_string());
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(claude_code::ClaudeCodeState::default())
        .manage(SettingsPendingTab::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(lsp::LspState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            pty::pty_list_shells,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::ssh_list_hosts,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            open_settings_window,
            settings_take_pending_tab,
            agent::agent_enable_hooks,
            claude_code::cli_agent_run,
            claude_code::cli_agent_kill,
            claude_code::cli_agent_available,
            agent::agent_disable_hooks,
            agent::agent_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Servers exit on stdin EOF, but destructors are not guaranteed
            // on process exit; kill explicitly.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<lsp::LspState>() {
                    state.kill_all();
                }
                if let Some(state) = app.try_state::<claude_code::ClaudeCodeState>() {
                    state.kill_all();
                }
            }
        });
}
