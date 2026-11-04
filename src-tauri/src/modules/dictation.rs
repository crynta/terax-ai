//! Starts macOS system Dictation in the focused text field, for the Session
//! Reader's mic button when the webview has no speech recognition of its own.

/// Sends AppKit's `startDictation:` action up the responder chain from the
/// first responder (the focused field). Resolves to whether a responder took
/// it; false off macOS, or when Dictation is unavailable.
#[tauri::command]
pub async fn app_start_dictation(window: tauri::WebviewWindow) -> Result<bool, String> {
    start(&window)
}

#[cfg(target_os = "macos")]
fn start(window: &tauri::WebviewWindow) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(send_start_dictation());
        })
        .map_err(|e| format!("dictation: {e}"))?;
    rx.recv_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "dictation: the main thread didn't answer".to_string())?
}

#[cfg(target_os = "macos")]
fn send_start_dictation() -> Result<bool, String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};

    let class = AnyClass::get(c"NSApplication").ok_or("NSApplication is not loaded")?;
    // An exception from AppKit must not unwind through Rust frames.
    objc2::exception::catch(|| unsafe {
        let app: *mut AnyObject = msg_send![class, sharedApplication];
        if app.is_null() {
            return false;
        }
        let action = Sel::register(c"startDictation:");
        let nil: *mut AnyObject = std::ptr::null_mut();
        let handled: Bool = msg_send![app, sendAction: action, to: nil, from: nil];
        handled.as_bool()
    })
    .map_err(|e| format!("dictation raised an exception: {e:?}"))
}

#[cfg(not(target_os = "macos"))]
fn start(_window: &tauri::WebviewWindow) -> Result<bool, String> {
    Ok(false)
}
