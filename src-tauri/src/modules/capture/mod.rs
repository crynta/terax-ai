#[cfg(all(target_os = "macos", feature = "openclicky"))]
use base64::Engine;
#[cfg(all(target_os = "macos", feature = "openclicky"))]
use tauri::Manager;
use tauri::Runtime;

#[derive(Default)]
pub struct CaptureState {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    last_capture: std::sync::Mutex<Option<Vec<u8>>>,
}

#[derive(serde::Serialize)]
pub struct ScreenshotResult {
    width: u32,
    height: u32,
    base64: String,
}

#[tauri::command]
#[allow(unused_imports, unused_variables)]
pub async fn capture_screen<R: Runtime>(
    app: tauri::AppHandle<R>,
    _state: tauri::State<'_, CaptureState>,
    focused_only: bool,
) -> Result<ScreenshotResult, String> {
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        let monitor = if focused_only {
            let main_window = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            let pos = main_window.outer_position().map_err(|e| e.to_string())?;
            xcap::Monitor::from_point(pos.x, pos.y).map_err(|e| e.to_string())?
        } else {
            xcap::Monitor::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .next()
                .ok_or("no monitors found")?
        };

        let rgba_image = monitor.capture_image().map_err(|e| e.to_string())?;
        let width = rgba_image.width();
        let height = rgba_image.height();

        let mut png_bytes = Vec::new();
        rgba_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                xcap::image::ImageFormat::Png,
            )
            .map_err(|e| e.to_string())?;

        if let Ok(mut last) = _state.last_capture.lock() {
            *last = Some(png_bytes.clone());
        }

        let base64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

        Ok(ScreenshotResult {
            width,
            height,
            base64,
        })
    }

    #[cfg(not(all(target_os = "macos", feature = "openclicky")))]
    {
        let _ = (app, _state, focused_only);
        Err("screen capture not available on this platform".into())
    }
}
