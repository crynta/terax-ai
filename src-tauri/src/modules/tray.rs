use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID_SHOW: &str = "tray_show";
const TRAY_ID_QUIT: &str = "tray_quit";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(TRAY_ID_SHOW, "Show Terax").build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_ID_QUIT, "Quit Terax").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    if let Some(icon) = app.default_window_icon() {
        let app_handle = app.handle().clone();
        let app_handle_click = app_handle.clone();

        TrayIconBuilder::new()
            .icon(icon.clone())
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(move |_tray, event| {
                if let TrayIconEvent::DoubleClick { .. } = event {
                    if let Err(err) = toggle_main_window(&app_handle_click) {
                        log::error!("failed to toggle window on tray double-click: {err}");
                    }
                }
            })
            .on_menu_event(move |_tray, event| match event.id().as_ref() {
                TRAY_ID_SHOW => {
                    if let Err(err) = show_main_window(&app_handle) {
                        log::error!("failed to show main window from tray: {err}");
                    }
                }
                TRAY_ID_QUIT => {
                    app_handle.exit(0);
                }
                _ => {}
            })
            .build(app)?;
    } else {
        log::warn!("tray icon skipped: default window icon is missing");
    }

    Ok(())
}

pub fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_focus();
        window.hide()?;
    }
    Ok(())
}

pub fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        window.show()?;
        let _ = window.set_focus();
    }
    Ok(())
}

pub fn toggle_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            hide_main_window(app)?
        } else {
            show_main_window(app)?
        }
    }
    Ok(())
}

pub fn toggle_quake_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_fullscreen().unwrap_or(false) {
            window.set_fullscreen(false)?;
            hide_main_window(app)?
        } else {
            window.set_fullscreen(true)?;
            show_main_window(app)?
        }
    }
    Ok(())
}
