use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub owner_name: String,
    pub window_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = xcap::Window::all().map_err(|e| format!("window list failed: {e}"))?;
    Ok(windows
        .into_iter()
        .filter_map(|w| {
            Some(WindowInfo {
                id: w.id().ok()?,
                owner_name: w.app_name().ok()?,
                window_name: w.title().ok()?,
                x: w.x().ok()?,
                y: w.y().ok()?,
                width: w.width().ok()?,
                height: w.height().ok()?,
            })
        })
        .collect())
}

#[cfg(not(all(target_os = "macos", feature = "openclicky")))]
pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    Err("window enumeration not available on this platform".to_string())
}
