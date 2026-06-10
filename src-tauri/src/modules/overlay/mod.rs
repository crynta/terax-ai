#[cfg(all(target_os = "macos", feature = "openclicky"))]
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::Runtime;

#[derive(Default)]
pub struct OverlayState {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    visible: std::sync::Mutex<bool>,
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
fn apply_transparency_shim<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::runtime::AnyObject;
    use objc2::msg_send;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(e) => {
            log::error!("overlay: failed to get ns_window: {e}");
            return;
        }
    };

    // SAFETY: ns_window_ptr comes from Tauri's ns_window() which returns a
    // valid NSWindow pointer. cast() reinterprets as AnyObject which is safe
    // for objc2 message sending. setOpaque: and setHasShadow: are simple
    // boolean property setters with no side effects.
    unsafe {
        let ns_window: &AnyObject = &*ns_window_ptr.cast();
        let () = msg_send![ns_window, setOpaque: false];
        let () = msg_send![ns_window, setHasShadow: false];
    }
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
fn create_overlay_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::WebviewWindow<R>, String> {
    let label = "overlay";

    if let Some(existing) = app.get_webview_window(label) {
        return Ok(existing);
    }

    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("overlay.html".into()))
        .title("Terax Overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;

    apply_transparency_shim(&window);

    Ok(window)
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn overlay_show<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        let window = create_overlay_window(&app)?;
        window.show().map_err(|e| e.to_string())?;

        if let Ok(mut vis) = state.visible.lock() {
            *vis = true;
        }

        app.emit("overlay:shown", ()).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn overlay_hide<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        if let Some(window) = app.get_webview_window("overlay") {
            window.hide().map_err(|e| e.to_string())?;
        }

        if let Ok(mut vis) = state.visible.lock() {
            *vis = false;
        }

        app.emit("overlay:hidden", ()).map_err(|e| e.to_string())?;
    }

    Ok(())
}
