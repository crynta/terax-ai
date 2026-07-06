use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl};
use tauri::{LogicalPosition, LogicalSize, Url};

/// State tracking active browser webview labels so we can clean up on tab
/// close without leaking native webviews.
pub struct BrowserState(pub Mutex<Vec<String>>);

impl Default for BrowserState {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

/// Create a child webview inside the main window. Used for public URLs that
/// cannot be embedded in an iframe due to X-Frame-Options.
///
/// The child webview is a native top-level browsing context: it is not subject
/// to X-Frame-Options or frame-ancestors CSP directives.
///
/// Position and size are in logical pixels relative to the window origin.
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Destroy existing webview with the same label if it exists (e.g. tab
    // reuse after navigation).
    browser_close_inner(&app, &label);

    let parsed_url: Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;

    let app_handle = app.clone();
    let label_clone = label.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .incognito(true)
        .focused(false)
        // Emit navigation events so the frontend address bar stays in sync
        // when the user clicks links inside the native webview.
        .on_navigation(move |nav_url| {
            let url_str = nav_url.to_string();
            if let Err(e) = app_handle.emit(
                "browser:navigation",
                serde_json::json!({ "label": label_clone, "url": url_str }),
            ) {
                log::warn!("failed to emit browser:navigation: {e}");
            }
            true
        });

    let app_handle_for_title = app.clone();
    let label_for_title = label.clone();
    let builder = builder.on_document_title_changed(move |_, title| {
        if let Err(e) = app_handle_for_title.emit(
            "browser:title",
            serde_json::json!({ "label": label_for_title, "title": title }),
        ) {
            log::warn!("failed to emit browser:title: {e}");
        }
    });

    let app_handle_for_load = app.clone();
    let label_for_load = label.clone();
    let builder = builder.on_page_load(move |_webview, payload| {
        let event_name = match payload.event() {
            tauri::webview::PageLoadEvent::Started => "browser:load-started",
            tauri::webview::PageLoadEvent::Finished => "browser:load-finished",
        };
        if let Err(e) = app_handle_for_load.emit(
            event_name,
            serde_json::json!({ "label": label_for_load, "url": payload.url().to_string() }),
        ) {
            log::warn!("failed to emit {event_name}: {e}");
        }
    });

    // get_window returns a Window (not WebviewWindow). add_child is on Window.
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width, height);

    window
        .add_child(builder, position, size)
        .map_err(|e| format!("failed to create child webview: {e}"))?;

    // Track the label for cleanup.
    {
        let state = app.state::<BrowserState>();
        let mut active = state.0.lock().map_err(|e| format!("state lock: {e}"))?;
        if !active.contains(&label) {
            active.push(label);
        }
    }

    Ok(())
}

/// Close (destroy) a child browser webview by label.
#[tauri::command]
pub fn browser_close(app: AppHandle, label: String) -> Result<(), String> {
    browser_close_inner(&app, &label);

    // Remove from tracking.
    if let Ok(mut active) = app.state::<BrowserState>().0.lock() {
        active.retain(|l| l != &label);
    }

    Ok(())
}

fn browser_close_inner(app: &AppHandle, label: &str) {
    if let Some(_wv) = app.get_webview(label) {
        let app_handle = app.clone();
        let label_owned = label.to_string();
        // `browser_close` is a synchronous command, so there is no ambient Tokio
        // reactor here; `tokio::spawn` would panic and abort the app. Spawn on
        // Tauri's managed runtime instead (callable from any thread).
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            if let Some(wv) = app_handle.get_webview(&label_owned) {
                if let Err(e) = wv.close() {
                    log::warn!("failed to close child webview '{label_owned}': {e}");
                }
            }
        });
    }
}

/// Navigate an existing child webview to a new URL.
#[tauri::command]
pub fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let parsed: Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    wv.navigate(parsed)
        .map_err(|e| format!("navigate failed: {e}"))?;
    Ok(())
}

/// Reload the current page in a child webview.
#[tauri::command]
pub fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    wv.reload().map_err(|e| format!("reload failed: {e}"))?;
    Ok(())
}

/// Resize and reposition a child webview in one call.
#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("set_size failed: {e}"))?;
    Ok(())
}

/// Hide a child webview (used when switching away from a preview tab).
#[tauri::command]
pub fn browser_hide(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    wv.hide().map_err(|e| format!("hide failed: {e}"))?;
    Ok(())
}

/// Show a previously hidden child webview (used when switching back to a
/// preview tab).
#[tauri::command]
pub fn browser_show(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    wv.show().map_err(|e| format!("show failed: {e}"))?;
    Ok(())
}
