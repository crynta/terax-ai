use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

fn label(tab_id: u32) -> String {
    format!("preview-{tab_id}")
}

/// Open or navigate the native child webview for a preview tab.
///
/// If the webview already exists it is navigated to the new URL and
/// repositioned; otherwise a new child webview is created inside the main
/// window.  The `on_navigation` hook emits `preview:url-changed` to the
/// main webview so the address bar stays in sync across redirects (e.g.
/// OAuth flows that land on localhost).
#[tauri::command]
pub async fn preview_open(
    app: AppHandle,
    tab_id: u32,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    visible: bool,
) -> Result<(), String> {
    let lbl = label(tab_id);

    if let Some(wv) = app.get_webview(&lbl) {
        let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
        wv.navigate(parsed).map_err(|e: tauri::Error| e.to_string())?;
        wv.set_position(LogicalPosition::new(x, y))
            .map_err(|e: tauri::Error| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h))
            .map_err(|e: tauri::Error| e.to_string())?;
        if !visible {
            wv.set_size(LogicalSize::new(0.0_f64, 0.0_f64))
                .map_err(|e: tauri::Error| e.to_string())?;
        }
        return Ok(());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let app2 = app.clone();

    let wv = main
        .add_child(
            WebviewBuilder::new(&lbl, WebviewUrl::External(parsed)).on_navigation(
                move |nav_url: &url::Url| {
                    let _ = app2.emit(
                        "preview:url-changed",
                        serde_json::json!({
                            "tabId": tab_id,
                            "url": nav_url.to_string(),
                        }),
                    );
                    true
                },
            ),
            LogicalPosition::new(x, y),
            LogicalSize::new(w, h),
        )
        .map_err(|e: tauri::Error| e.to_string())?;

    if !visible {
        wv.set_size(LogicalSize::new(0.0_f64, 0.0_f64))
            .map_err(|e: tauri::Error| e.to_string())?;
    }

    Ok(())
}

/// Update the position and size of an existing preview webview.
#[tauri::command]
pub async fn preview_set_bounds(
    app: AppHandle,
    tab_id: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let lbl = label(tab_id);
    if let Some(wv) = app.get_webview(&lbl) {
        wv.set_position(LogicalPosition::new(x, y))
            .map_err(|e: tauri::Error| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h))
            .map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

/// Hide the preview webview by collapsing it to 0×0. When showing, the
/// caller always follows up with `preview_set_bounds` which restores the
/// correct dimensions (see PreviewPane.tsx visibility effect).
#[tauri::command]
pub async fn preview_set_visible(
    app: AppHandle,
    tab_id: u32,
    visible: bool,
) -> Result<(), String> {
    let lbl = label(tab_id);
    if !visible {
        if let Some(wv) = app.get_webview(&lbl) {
            wv.set_size(LogicalSize::new(0.0_f64, 0.0_f64))
                .map_err(|e: tauri::Error| e.to_string())?;
        }
    }
    // visible=true: the frontend immediately calls preview_set_bounds which
    // restores full dimensions — no extra call needed here.
    Ok(())
}

/// Reload the current page in the preview webview.
#[tauri::command]
pub async fn preview_reload(app: AppHandle, tab_id: u32) -> Result<(), String> {
    let lbl = label(tab_id);
    if let Some(wv) = app.get_webview(&lbl) {
        wv.eval("window.location.reload()").map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

/// Destroy the preview webview for a tab (called on tab close).
#[tauri::command]
pub async fn preview_close(app: AppHandle, tab_id: u32) -> Result<(), String> {
    let lbl = label(tab_id);
    if let Some(wv) = app.get_webview(&lbl) {
        wv.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
