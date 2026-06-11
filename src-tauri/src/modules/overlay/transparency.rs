#[cfg(all(target_os = "macos", feature = "openclicky"))]
use tauri::Runtime;

#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub fn apply_transparency_shim<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(e) => {
            log::error!("overlay: failed to get ns_window: {e}");
            return;
        }
    };
    let Some(ns_color_cls) = objc2::runtime::AnyClass::get(c"NSColor") else {
        log::error!("overlay: NSColor class not found");
        return;
    };

    // SAFETY: ns_window_ptr is a valid NSWindow pointer from Tauri; the selectors
    // (setOpaque/setHasShadow/setBackgroundColor/clearColor) and their argument
    // and return types match the AppKit ABI.
    unsafe {
        let ns_window: &AnyObject = &*ns_window_ptr.cast();
        let color: &AnyObject = msg_send![ns_color_cls, clearColor];
        let () = msg_send![ns_window, setOpaque: false];
        let () = msg_send![ns_window, setHasShadow: false];
        let () = msg_send![ns_window, setBackgroundColor: color];
    }
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub fn size_to_screen<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(_) => return,
    };
    let Some(ns_screen_cls) = objc2::runtime::AnyClass::get(c"NSScreen") else {
        log::error!("overlay: NSScreen class not found");
        return;
    };

    // SAFETY: ns_window_ptr is a valid NSWindow pointer from Tauri; the screen /
    // mainScreen / frame / setFrame selectors and their types match the AppKit
    // ABI, and the optional returns are checked before use.
    unsafe {
        let ns_window: &AnyObject = &*ns_window_ptr.cast();

        let screen: Option<&AnyObject> = msg_send![ns_window, screen];
        let screen = match screen {
            Some(s) => s,
            None => {
                let main: Option<&AnyObject> = msg_send![ns_screen_cls, mainScreen];
                match main {
                    Some(s) => s,
                    None => return,
                }
            }
        };

        let frame: objc2_foundation::NSRect = msg_send![screen, frame];
        let () = msg_send![ns_window, setFrame: frame, display: true];
    }
}
