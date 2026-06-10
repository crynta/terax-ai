//! Terax — an open-source AI-native terminal emulator.
//!
//! This crate contains the Tauri 2 Rust backend: PTY management, filesystem
//! operations, git integration, Pi AI session lifecycle, MCP tool bridge,
//! and the workspace authorization layer.

#![cfg_attr(
    not(test),
    deny(
        clippy::expect_used,
        clippy::undocumented_unsafe_blocks,
        clippy::unwrap_used
    )
)]

pub mod modules;

use modules::{
    agent, artifacts, capture, fs, git, mcp, model_compare, net, overlay, pi, pty, secrets, shell,
    workspace,
};
#[cfg(all(target_os = "macos", feature = "openclicky"))]
use modules::tray;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{PhysicalPosition, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    match state.0.lock() {
        Ok(mut launch_dir) => launch_dir.take(),
        Err(error) => {
            log::error!("launch dir lock failed: {error}");
            None
        }
    }
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
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON - no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    // macOS: skip parent() - child + always_on_top leaves the settings webview
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
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 24.0))
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag - re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    tray::set_activation_policy_accessory();

    let cli_dir = parse_launch_dir();
    workspace::init_launch_cwd(cli_dir.as_deref());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "openclicky")]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    if let Err(error) = builder
        .setup(|_app| {
            #[cfg(all(target_os = "macos", feature = "openclicky"))]
            if let Err(e) = tray::setup_tray(_app.handle()) {
                log::warn!("tray setup failed (non-fatal, continuing with dock icon): {e}");
            }

            #[cfg(target_os = "macos")]
            if let Some(main) = _app.get_webview_window("main") {
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    ) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            if let Err(e) = settings.close() {
                                log::debug!("settings window close failed: {e}");
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(pi::PiState::default())
        .manage(Arc::new(mcp::McpState::default()))
        .manage(artifacts::ArtifactsState::default())
        .manage(shell::ShellState::default())
        .manage(modules::capabilities::WorkflowCapabilityState::default())
        .manage(modules::capabilities::AppCapabilityState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .manage(overlay::OverlayState::default())
        .manage(capture::CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pi::pi_local_agents_status,
            pi::pi_status,
            pi::pi_start,
            pi::pi_stop,
            pi::pi_host_info,
            pi::pi_diagnostics,
            pi::pi_models_list,
            pi::pi_sessions_history,
            pi::pi_sessions_list,
            pi::workflow_pi_session_create,
            pi::pi_session_create,
            pi::pi_session_resume,
            pi::pi_session_send,
            pi::pi_session_tool_respond,
            pi::pi_session_rename,
            pi::pi_session_delete,
            pi::pi_session_delete_with_artifacts,
            pi::pi_session_stop,
            pi::pi_session_archive,
            pi::pi_session_restore,
            pi::pi_session_fork,
            pi::pi_session_rollback,
            pi::pi_usage_summary,
            pi::pi_store_record_session,
            pi::pi_store_record_events,
            pi::pi_store_record_transcript,
            pi::pi_store_load_transcript,
            pi::pi_store_delete_transcript,
            mcp::mcp_server_configs_list,
            mcp::mcp_server_config_save,
            mcp::mcp_server_config_remove,
            mcp::mcp_tool_preferences_list,
            mcp::mcp_tool_preference_set,
            mcp::mcp_tool_policy_set,
            mcp::mcp_env_secret_statuses,
            mcp::mcp_env_secret_set,
            mcp::mcp_env_secret_remove,
            mcp::mcp_oauth_start,
            mcp::mcp_oauth_wait_for_callback,
            mcp::mcp_oauth_complete,
            mcp::mcp_connect_saved_stdio,
            mcp::mcp_connect_stdio,
            mcp::mcp_connect_http,
            mcp::mcp_disconnect,
            mcp::mcp_tools,
            mcp::pi_capability_manifest,
            mcp::mcp_server_statuses,
            mcp::mcp_call_tool,
            artifacts::artifacts_list,
            artifacts::artifacts_list_all,
            artifacts::artifacts_list_deleted,
            artifacts::artifacts_get,
            artifacts::artifacts_compile_react,
            artifacts::artifacts_create,
            artifacts::artifacts_update,
            artifacts::artifacts_rename_title,
            artifacts::artifacts_edit,
            artifacts::artifacts_versions,
            artifacts::artifacts_export,
            artifacts::artifacts_export_many,
            artifacts::artifacts_delete,
            artifacts::artifacts_delete_many,
            artifacts::artifacts_restore_deleted,
            artifacts::artifacts_restore_deleted_many,
            artifacts::artifacts_purge_deleted,
            artifacts::artifacts_delete_for_conversation,
            model_compare::model_compare_history_get,
            model_compare::model_compare_history_put,
            model_compare::model_compare_history_clear,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::workflow_file_read,
            fs::file::fs_write_file,
            fs::file::workflow_file_write,
            fs::file::fs_write_base64_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_copy_file,
            fs::mutate::fs_open_file,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::workflow_file_delete,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
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
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::workflow_shell_bg_spawn,
            modules::capabilities::workflow_capability_audit,
            modules::capabilities::app_capability_audit,
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
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            agent::agent_enable_codex_hooks,
            agent::agent_codex_hooks_status,
            agent::agent_enable_gemini_hooks,
            agent::agent_gemini_hooks_status,
            agent::agent_enable_antigravity_hooks,
            agent::agent_antigravity_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::workflow_http_request,
            net::ai_http_request,
            net::ai_http_stream,
            #[cfg(feature = "openclicky")]
            overlay::overlay_show,
            #[cfg(feature = "openclicky")]
            overlay::overlay_hide,
            #[cfg(feature = "openclicky")]
            capture::capture_screen,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("error while running tauri application: {error}");
        std::process::exit(1);
    }
}
