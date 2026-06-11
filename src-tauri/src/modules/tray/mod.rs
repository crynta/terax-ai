#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};

#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "macos")]
pub fn set_activation_policy_accessory() {
    let Some(mtm) = MainThreadMarker::new() else {
        log::error!("tray: set_activation_policy called off main thread");
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn tray_set_icon(app: AppHandle, status: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Err("tray not found".to_string());
    };

    let tooltip = match status.as_str() {
        "thinking" => "Terax - Thinking...",
        "speaking" => "Terax - Speaking...",
        _ => "Terax",
    };

    tray.set_tooltip(Some(tooltip))
        .map_err(|e| format!("set tooltip failed: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn tray_set_icon(_app: tauri::AppHandle, _status: String) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show Terax").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("app icon missing for tray")?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("Terax")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
