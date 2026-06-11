#[cfg(all(target_os = "macos", feature = "openclicky"))]
use tauri::Runtime;

#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub fn apply_transparency_shim<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::runtime::AnyObject;
    use objc2::msg_send;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(e) => {
            log::error!("overlay: failed to get ns_window: {e}");
            return;
        }
    };

    unsafe {
        let ns_window: &AnyObject = &*ns_window_ptr.cast();

        let () = msg_send![ns_window, setOpaque: false];
        let () = msg_send![ns_window, setHasShadow: false];
        let () = msg_send![ns_window, setBackgroundColor: {
            let cls = objc2::runtime::AnyClass::get(c"NSColor")
                .expect("NSColor class");
            let color: &AnyObject = msg_send![cls, clearColor];
            color
        }];
    }
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub fn size_to_screen<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use objc2::runtime::AnyObject;
    use objc2::msg_send;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(_) => return,
    };

    unsafe {
        let ns_window: &AnyObject = &*ns_window_ptr.cast();

        let screen: Option<&AnyObject> = msg_send![ns_window, screen];
        let screen = match screen {
            Some(s) => s,
            None => {
                let cls = objc2::runtime::AnyClass::get(c"NSScreen")
                    .expect("NSScreen class");
                let main: Option<&AnyObject> = msg_send![cls, mainScreen];
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
