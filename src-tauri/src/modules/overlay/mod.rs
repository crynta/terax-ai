pub mod drawing;
pub mod transparency;

use drawing::AnnotationItem;

use tauri::Runtime;
#[cfg(all(target_os = "macos", feature = "openclicky"))]
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct OverlayState {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    visible: std::sync::Mutex<bool>,
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    annotations: std::sync::Mutex<Vec<AnnotationItem>>,
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

    transparency::apply_transparency_shim(&window);
    transparency::size_to_screen(&window);

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

        let mut vis = state.visible.lock().map_err(|e| e.to_string())?;
        *vis = true;

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

        let mut vis = state.visible.lock().map_err(|e| e.to_string())?;
        *vis = false;

        app.emit("overlay:hidden", ()).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn overlay_draw<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, OverlayState>,
    items: Vec<AnnotationItem>,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        let serialized = serde_json::to_string(&items).map_err(|e| format!("serialize: {e}"))?;
        let mut annotations = state.annotations.lock().map_err(|e| format!("lock: {e}"))?;
        annotations.extend(items);
        app.emit("overlay:draw", serialized)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn overlay_clear<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        let mut annotations = state.annotations.lock().map_err(|e| format!("lock: {e}"))?;
        annotations.clear();
        app.emit("overlay:clear", ()).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(unused_variables)]
pub fn overlay_get_annotations(
    state: tauri::State<'_, OverlayState>,
) -> Result<Vec<AnnotationItem>, String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        let annotations = state.annotations.lock().map_err(|e| e.to_string())?;
        Ok(annotations.clone())
    }

    #[cfg(not(all(target_os = "macos", feature = "openclicky")))]
    {
        Ok(Vec::new())
    }
}
