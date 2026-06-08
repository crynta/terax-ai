//! Embedded web preview backed by a native child webview.
//!
//! The preview used to be an HTML `<iframe>`, but framed pages that set
//! `X-Frame-Options`/CSP `frame-ancestors` (auth/login redirects, security
//! middleware) refuse to render cross-origin and show blank. A native child
//! webview loads the URL as a *top-level* navigation — exactly like a browser
//! tab — so those framing rules never apply.
//!
//! Every webview is created and driven from Rust via the commands below. The
//! preview webview is deliberately given no Tauri capability, so the embedded
//! page has zero access to the IPC / `window.__TAURI__` surface.

use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Label of the host window the preview webviews are attached to.
const MAIN_WINDOW: &str = "main";
/// Event carrying the live URL of a preview webview (initial load + redirects +
/// in-page navigations) so the address bar can stay in sync.
const NAV_EVENT: &str = "preview://navigated";

#[derive(Clone, Serialize)]
struct PreviewNav {
    label: String,
    url: String,
}

/// Custom scheme used by the injected key-forwarding script as a one-way
/// channel to the host (the preview has no IPC). Navigations to it are
/// intercepted and cancelled in `on_navigation`.
const SHORTCUT_SCHEME: &str = "terax-shortcut";
/// Event carrying an app-shell keystroke (Ctrl+Tab, etc.) pressed while the
/// preview webview had focus, so the host can act on it.
const KEY_EVENT: &str = "preview://shortcut-key";

#[derive(Clone, Serialize)]
struct PreviewKey {
    key: String,
    code: String,
    #[serde(rename = "ctrlKey")]
    ctrl: bool,
    #[serde(rename = "metaKey")]
    meta: bool,
    #[serde(rename = "shiftKey")]
    shift: bool,
    #[serde(rename = "altKey")]
    alt: bool,
}

/// Injected into the preview page: forwards a curated allow-list of app-shell
/// shortcuts (tab cycling/management, palette, settings) to the host via the
/// sentinel scheme. A focused webview otherwise swallows these keys. Keys the
/// web content needs (copy/paste/find/...) are intentionally left alone.
const SHORTCUT_SCRIPT: &str = r#"(function () {
  var IS_MAC = __IS_MAC__;
  function mod(e) { return IS_MAC ? e.metaKey : e.ctrlKey; }
  function other(e) { return IS_MAC ? e.ctrlKey : e.metaKey; }
  function isShell(e) {
    if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) return true;
    if (!mod(e) || e.altKey || other(e)) return false;
    if (/^[1-9]$/.test(e.key)) return true;
    var k = e.key.toLowerCase();
    if (k === "t" || k === "w" || k === ",") return true;
    if (k === "p" && e.shiftKey) return true;
    return false;
  }
  window.addEventListener("keydown", function (e) {
    if (!isShell(e)) return;
    e.preventDefault();
    e.stopPropagation();
    var p = new URLSearchParams();
    p.set("key", e.key);
    p.set("code", e.code);
    p.set("ctrl", e.ctrlKey ? "1" : "0");
    p.set("meta", e.metaKey ? "1" : "0");
    p.set("shift", e.shiftKey ? "1" : "0");
    p.set("alt", e.altKey ? "1" : "0");
    try { window.location.href = "terax-shortcut://k?" + p.toString(); } catch (err) {}
  }, true);
})();"#;

fn shortcut_script() -> String {
    SHORTCUT_SCRIPT.replace(
        "__IS_MAC__",
        if cfg!(target_os = "macos") {
            "true"
        } else {
            "false"
        },
    )
}

fn emit_shortcut_key(app: &AppHandle, url: &tauri::Url) {
    let mut key = String::new();
    let mut code = String::new();
    let mut ctrl = false;
    let mut meta = false;
    let mut shift = false;
    let mut alt = false;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "key" => key = v.into_owned(),
            "code" => code = v.into_owned(),
            "ctrl" => ctrl = v == "1",
            "meta" => meta = v == "1",
            "shift" => shift = v == "1",
            "alt" => alt = v == "1",
            _ => {}
        }
    }
    if key.is_empty() {
        return;
    }
    let _ = app.emit(
        KEY_EVENT,
        PreviewKey {
            key,
            code,
            ctrl,
            meta,
            shift,
            alt,
        },
    );
}

fn parse_url(url: &str) -> Result<tauri::Url, String> {
    url.parse::<tauri::Url>()
        .map_err(|e| format!("invalid preview url '{url}': {e}"))
}

fn logical_pos(x: f64, y: f64) -> LogicalPosition<f64> {
    LogicalPosition::new(x, y)
}

fn logical_size(width: f64, height: f64) -> LogicalSize<f64> {
    // A zero/negative size makes the platform webview misbehave; clamp to >= 1.
    LogicalSize::new(width.max(1.0), height.max(1.0))
}

/// Create the preview webview if missing (navigating to `url`), otherwise just
/// reposition + show the existing one.
#[tauri::command]
pub fn preview_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.set_position(logical_pos(x, y));
        let _ = webview.set_size(logical_size(width, height));
        let _ = webview.show();
        return Ok(());
    }

    let parent = app
        .get_webview(MAIN_WINDOW)
        .ok_or_else(|| "main webview not found".to_string())?;
    let window = parent.window();

    let parsed = parse_url(&url)?;
    let handle = app.clone();
    let nav_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .on_navigation(move |next| {
            if next.scheme() == SHORTCUT_SCHEME {
                // Sentinel from the injected key-forwarding script — not a real
                // navigation. Forward the keystroke and cancel the navigation.
                emit_shortcut_key(&handle, next);
                return false;
            }
            let _ = handle.emit(
                NAV_EVENT,
                PreviewNav {
                    label: nav_label.clone(),
                    url: next.to_string(),
                },
            );
            true
        })
        .initialization_script(shortcut_script())
        // Devtools/Web Inspector is allowed only on the preview (it's a browser-
        // like surface); the app's own webviews disable it.
        .devtools(true);

    window
        .add_child(builder, logical_pos(x, y), logical_size(width, height))
        .map(|_| ())
        .map_err(|e| format!("failed to create preview webview: {e}"))
}

/// Move/resize an existing preview webview to track its host element. No-op when
/// the webview hasn't been created yet (avoids races during mount/teardown).
#[tauri::command]
pub fn preview_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.set_position(logical_pos(x, y));
        let _ = webview.set_size(logical_size(width, height));
    }
    Ok(())
}

#[tauri::command]
pub fn preview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let parsed = parse_url(&url)?;
        webview.navigate(parsed).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_show(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.show();
    }
    Ok(())
}

#[tauri::command]
pub fn preview_hide(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        // The Web Inspector docks to the window and would otherwise stay open
        // over the app after leaving the preview tab; close it with the view.
        webview.close_devtools();
        let _ = webview.hide();
        // Hiding the WKWebView drops it from the responder chain without moving
        // keyboard focus back, so keys would fall through to the native window
        // (Cmd+W => close app) and the app's global shortcuts would go dead.
        // Hand focus back to the main webview.
        if let Some(main) = app.get_webview(MAIN_WINDOW) {
            let _ = main.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn preview_reload(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.reload();
    }
    Ok(())
}

#[tauri::command]
pub fn preview_close(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
        // Closing drops keyboard focus to the native window; hand it back to the
        // main webview so shortcuts keep working and Cmd+W doesn't close the app.
        if let Some(main) = app.get_webview(MAIN_WINDOW) {
            let _ = main.set_focus();
        }
    }
    Ok(())
}
